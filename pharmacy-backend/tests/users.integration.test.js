const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
if (process.env.RUN_DB_TESTS !== '1') {
  test('MySQL staff approval integration (set RUN_DB_TESTS=1)', { skip: true }, () => {});
} else {
  test('Administrator bootstrap and staff approval workflow', async t => {
    require('dotenv').config({ path: path.join(__dirname, '../.env') });
    const mysql = require('mysql2/promise');
    const bcrypt = require('bcryptjs');
    const jwt = require('jsonwebtoken');
    const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    const database = `pharmacy_users_test_${crypto.randomBytes(6).toString('hex')}`;
    let pool, server;
    try {
      await connection.query(`CREATE DATABASE \`${database}\``);
      await connection.query(`USE \`${database}\``);
      const schema = await fs.readFile(path.join(__dirname, '../models/schema.sql'), 'utf8');
      await connection.query(schema.slice(schema.indexOf('CREATE TABLE')));
      const password = await bcrypt.hash('test-password', 4);
      const [owner] = await connection.query("INSERT INTO users (full_name,email,phone,password,role) VALUES ('Owner','owner@example.test','+255700000000',?,'staff')", [password]);
      process.env.DB_NAME = database; process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
      pool = require('../config/db');
      await t.test('staged upgrade preserves existing access but rolls back new registration without approval tables', async () => {
        const User = require('../models/User');
        const legacy = await User.findById(owner.insertId);
        assert.equal(legacy.approval_setup_required, true);
        assert.equal(legacy.status, 'ACTIVE');
        assert.equal(legacy.password, undefined);
        await assert.rejects(User.create({ fullName: 'Blocked signup', email: 'blocked@example.test', phone: '+255700000009', hashedPassword: password }), error => error.code === 'ER_NO_SUCH_TABLE');
        const [[count]] = await connection.query('SELECT COUNT(*) AS total FROM users');
        assert.equal(count.total, 1);
      });
      const directory = path.join(__dirname, '../migrations');
      for (const file of (await fs.readdir(directory)).filter(file => file.endsWith('.sql')).sort()) {
        const sql = await fs.readFile(path.join(directory, file), 'utf8');
        for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await connection.query(statement);
      }
      process.env.DB_NAME = database; process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
      pool = require('../config/db');
      const { bootstrapAdmin } = require('../services/userService');
      server = require('../server').listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      const base = `http://127.0.0.1:${server.address().port}/api`;
      const request = async (url, token, method = 'GET', body) => {
        const response = await fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, ...(await response.json()) };
      };
      const login = email => request('/auth/login', null, 'POST', { email, password: 'test-password' });
      const register = email => request('/auth/register', null, 'POST', { fullName: 'New Staff', email, phone: '+255700000001', password: 'test-password', role: 'admin', status: 'ACTIVE' });
      let adminToken, staffToken, staff, second;
      await t.test('existing staff requires approval; explicit bootstrap promotes one account without changing password', async () => {
        assert.equal((await login('owner@example.test')).status, 403);
        const promoted = await bootstrapAdmin(owner.insertId);
        assert.equal(promoted.role, 'admin'); assert.equal(promoted.status, 'ACTIVE');
        const [[unchanged]] = await connection.query('SELECT password FROM users WHERE id = ?', [owner.insertId]);
        assert.equal(unchanged.password, password);
        const result = await login('owner@example.test');
        assert.equal(result.status, 200); adminToken = result.token;
        await assert.rejects(bootstrapAdmin(owner.insertId), error => error.status === 409);
      });
      await t.test('registration never creates privileged or approved accounts and issues no token', async () => {
        const result = await register('staff@example.test'); staff = result.user;
        assert.equal(result.status, 201); assert.equal(staff.role, 'staff'); assert.equal(staff.status, 'PENDING'); assert.equal(result.token, undefined);
        assert.equal((await login('staff@example.test')).status, 403);
        const oldToken = jwt.sign({ id: staff.id, role: 'admin' }, process.env.JWT_SECRET);
        for (const endpoint of ['/auth/me', '/dashboard', '/medicines', '/purchases', '/users']) assert.equal((await request(endpoint, oldToken)).status, 401);
        assert.equal((await request('/users')).status, 401);
        await assert.rejects(bootstrapAdmin(staff.id), error => error.status === 409);
      });
      await t.test('only admin approves staff; listing never exposes password hashes', async () => {
        const listed = await request('/users?status=PENDING&search=staff', adminToken);
        assert.equal(listed.status, 200); assert.equal(listed.data.pagination.total, 1);
        assert.equal(listed.data.items[0].password, undefined);
        const approved = await request(`/users/${staff.id}/approve`, adminToken, 'PATCH', { version: staff.version });
        assert.equal(approved.status, 200); staff = approved.data;
        assert.equal(staff.role, 'staff'); assert.equal(staff.status, 'ACTIVE'); assert.equal(staff.reviewed_by, owner.insertId);
        const result = await login('staff@example.test'); assert.equal(result.status, 200); staffToken = result.token;
        assert.equal((await request('/users', staffToken)).status, 403);
        assert.equal((await request(`/users/${owner.insertId}/role`, staffToken, 'PATCH', { version: 2, role: 'staff' })).status, 403);
        assert.equal((await request(`/users/${staff.id}/role`, adminToken, 'PATCH', { version: 1, role: 'admin' })).status, 409);
      });
      await t.test('approved staff can become administrator; current DB role controls existing tokens', async () => {
        const result = await request(`/users/${staff.id}/role`, adminToken, 'PATCH', { version: staff.version, role: 'admin' });
        assert.equal(result.status, 200); staff = result.data;
        assert.equal((await request('/users', staffToken)).status, 200);
        const ownChange = await request(`/users/${owner.insertId}/role`, adminToken, 'PATCH', { version: 2, role: 'staff' });
        assert.equal(ownChange.status, 409);
        assert.equal((await request(`/users/${owner.insertId}/suspend`, adminToken, 'PATCH', { version: 2 })).status, 409);
        assert.equal((await request(`/users/${staff.id}/role`, adminToken, 'PATCH', { version: staff.version, role: 'superuser' })).status, 400);
      });
      await t.test('rejection, reapproval, suspension and session revocation are enforced', async () => {
        second = (await register('second@example.test')).user;
        second = (await request(`/users/${second.id}/reject`, adminToken, 'PATCH', { version: second.version })).data;
        assert.equal(second.status, 'REJECTED'); assert.equal((await login('second@example.test')).status, 403);
        assert.equal((await request(`/users/${second.id}/role`, adminToken, 'PATCH', { version: second.version, role: 'admin' })).status, 409);
        second = (await request(`/users/${second.id}/approve`, adminToken, 'PATCH', { version: second.version })).data;
        const token = (await login('second@example.test')).token;
        second = (await request(`/users/${second.id}/suspend`, adminToken, 'PATCH', { version: second.version })).data;
        assert.equal((await request('/auth/me', token)).status, 401); assert.equal((await login('second@example.test')).status, 403);
        second = (await request(`/users/${second.id}/activate`, adminToken, 'PATCH', { version: second.version })).data;
        assert.equal((await login('second@example.test')).status, 200);
      });
      await t.test('concurrent admins cannot demote each other and leave zero administrators', async () => {
        const results = await Promise.all([
          request(`/users/${staff.id}/role`, adminToken, 'PATCH', { version: staff.version, role: 'staff' }),
          request(`/users/${owner.insertId}/role`, staffToken, 'PATCH', { version: 2, role: 'staff' }),
        ]);
        assert.deepEqual(results.map(result => result.status).sort(), [200, 403]);
        const [[row]] = await connection.query("SELECT COUNT(*) AS total FROM users u JOIN user_access a ON a.user_id=u.id WHERE u.role='admin' AND a.status='ACTIVE'");
        assert.equal(row.total, 1);
      });
      await t.test('approval decisions and promotions are audited; migration rerun preserves reviewed status', async () => {
        const [events] = await connection.query('SELECT action, user_id, description FROM audit_logs ORDER BY id');
        assert.ok(events.some(event => event.action === 'INITIAL_ADMIN_SETUP' && event.user_id === null));
        assert.ok(events.some(event => event.action === 'USER_APPROVE' && event.user_id === owner.insertId));
        assert.ok(events.some(event => event.action === 'USER_ROLE'));
        assert.ok(events.every(event => !event.description.includes('test-password')));
        const sql = await fs.readFile(path.join(directory, '004_staff_approval.sql'), 'utf8');
        for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await connection.query(statement);
        const [[row]] = await connection.query('SELECT status FROM user_access WHERE user_id = ?', [second.id]);
        assert.equal(row.status, 'ACTIVE');
      });
    } finally {
      if (server) await new Promise(resolve => server.close(resolve));
      if (pool) await pool.end();
      await connection.query(`DROP DATABASE IF EXISTS \`${database}\``); await connection.end();
    }
  });
}
