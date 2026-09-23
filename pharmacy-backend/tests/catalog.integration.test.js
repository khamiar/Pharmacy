const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

if (process.env.RUN_DB_TESTS !== '1') {
  test('MySQL catalog integration (set RUN_DB_TESTS=1)', { skip: true }, () => {});
} else {
  test('Catalog and authentication against isolated MySQL database', async t => {
    require('dotenv').config({ path: path.join(__dirname, '../.env') });
    const mysql = require('mysql2/promise');
    const bcrypt = require('bcryptjs');
    const jwt = require('jsonwebtoken');
    const admin = await mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    const database = `pharmacy_test_${crypto.randomBytes(8).toString('hex')}`;
    let pool, server;
    try {
      await admin.query(`CREATE DATABASE \`${database}\``);
      await admin.query(`USE \`${database}\``);
      const userSchema = await fs.readFile(path.join(__dirname, '../models/schema.sql'), 'utf8');
      await admin.query(userSchema.slice(userSchema.indexOf('CREATE TABLE')));
      const catalogSchema = await fs.readFile(path.join(__dirname, '../migrations/002_catalog.sql'), 'utf8');
      for (const statement of catalogSchema.split(';').map(value => value.trim()).filter(Boolean)) await admin.query(statement);
      // Check migration can run twice without changing existing rows.
      for (const statement of catalogSchema.split(';').map(value => value.trim()).filter(Boolean)) await admin.query(statement);
      const purchasingSchema = await fs.readFile(path.join(__dirname, '../migrations/003_purchasing.sql'), 'utf8');
      for (const statement of purchasingSchema.split(';').map(value => value.trim()).filter(Boolean)) await admin.query(statement);
      process.env.DB_NAME = database;
      process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
      pool = require('../config/db');
      server = require('../server').listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      const base = `http://127.0.0.1:${server.address().port}/api`;
      const request = async (url, token, method = 'GET', body) => {
        const response = await fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, ...(await response.json()) };
      };
      let staffToken, pharmacistToken, adminToken, category, medicine;
      const initialMedicine = { name: 'Example medicine', medicine_type: 'Tablet', purchase_price: '1250.50', selling_price: '1500.00', minimum_stock: 10, barcode: 'TEST-001' };
      await t.test('registration, duplicate email guidance, normalized login and wrong password', async () => {
        const body = { fullName: ' Test Staff ', email: '  Staff@Example.test ', phone: '+255700000000', password: 'test-password', role: 'admin' };
        const created = await request('/auth/register', null, 'POST', body);
        assert.equal(created.status, 201);
        assert.equal(created.user.role, 'staff');
        assert.equal(created.user.email, 'staff@example.test');
        assert.equal(created.user.password, undefined);
        staffToken = created.token;
        assert.equal((await request('/auth/register', null, 'POST', body)).status, 409);
        const login = await request('/auth/login', null, 'POST', { email: ' STAFF@example.test ', password: 'test-password' });
        assert.equal(login.status, 200);
        assert.equal((await request('/auth/login', null, 'POST', { email: body.email, password: 'incorrect' })).status, 401);
        assert.equal((await request('/auth/register', null, 'POST', { ...body, email: 'bad-email' })).status, 400);
        assert.equal((await request('/auth/register', null, 'POST', { ...body, email: 'long@example.test', password: 'é'.repeat(37) })).status, 400);
        const password = await bcrypt.hash('test-password', 4);
        for (const role of ['admin', 'pharmacist']) {
          const [result] = await admin.query('INSERT INTO users (full_name,email,phone,password,role) VALUES (?,?,?,?,?)', [role, `${role}@example.test`, '+255700000001', password, role]);
          const token = jwt.sign({ id: result.insertId }, process.env.JWT_SECRET);
          if (role === 'admin') adminToken = token; else pharmacistToken = token;
        }
      });
      await t.test('authentication and role-specific catalog permissions', async () => {
        assert.equal((await request('/medicines')).status, 401);
        assert.equal((await request('/categories', staffToken)).status, 200);
        assert.equal((await request('/categories', staffToken, 'POST', { name: 'Denied' })).status, 403);
        assert.equal((await request('/medicines/options', staffToken)).status, 200);
      });
      await t.test('create category, unique names and medicines with zero stock', async () => {
        const result = await request('/categories', pharmacistToken, 'POST', { name: ' General ', description: 'General category' });
        assert.equal(result.status, 201); category = result.data;
        assert.equal(category.name, 'General');
        assert.equal((await request('/categories', adminToken, 'POST', { name: 'General' })).status, 409);
        const result2 = await request('/medicines', staffToken, 'POST', { ...initialMedicine, category_id: category.id });
        assert.equal(result2.status, 201); medicine = result2.data;
        assert.equal(Number(medicine.quantity), 0);
        assert.deepEqual(medicine.batches, []);
        assert.equal(medicine.purchase_price, '1250.50');
        assert.equal((await request('/medicines', staffToken, 'POST', { ...initialMedicine })).status, 409);
        assert.equal((await request(`/categories/${category.id}`, pharmacistToken)).data.medicine_count, 1);
      });
      await t.test('validation rejects stock edits, invalid prices, inactive categories, and SQL sort injection', async () => {
        for (const invalid of [{ quantity: 50 }, { status: 'ARCHIVED' }, { selling_price: -1 }, { purchase_price: '1.999' }, { minimum_stock: 1.5 }, { medicine_type: 'Invalid' }, { name: '  ' }]) {
          assert.equal((await request('/medicines', staffToken, 'POST', { ...initialMedicine, ...invalid, barcode: null })).status, 400);
        }
        assert.equal((await request('/medicines', staffToken, 'POST', { ...initialMedicine, barcode: null, category_id: 99999 })).status, 409);
        assert.equal((await request('/medicines?sort=name%3BDROP%20TABLE%20users', staffToken)).status, 400);
        assert.equal((await request('/medicines?limit=999', staffToken)).status, 400);
        assert.equal((await request('/medicines/not-a-number', staffToken)).status, 400);
        assert.equal((await request('/medicines/99999', staffToken)).status, 404);
      });
      await t.test('search, filtering, sorting and pagination use persisted records', async () => {
        const next = await request('/medicines', staffToken, 'POST', { ...initialMedicine, name: 'Another medicine', barcode: null });
        assert.equal(next.status, 201);
        const found = await request('/medicines?search=TEST-001', staffToken);
        assert.equal(found.data.pagination.total, 1);
        assert.equal(found.data.items[0].id, medicine.id);
        const page = await request('/medicines?sort=name&direction=asc&limit=1&page=2', staffToken);
        assert.equal(page.data.items[0].id, medicine.id);
        assert.equal(page.data.pagination.pages, 2);
        assert.equal((await request(`/medicines?category=${category.id}`, staffToken)).data.pagination.total, 1);
        assert.equal((await request('/medicines?stock=out', staffToken)).data.pagination.total, 2);
      });
      await t.test('edit is persistent and rejects stale concurrent updates', async () => {
        const payload = { ...initialMedicine, category_id: category.id, name: 'Updated medicine', version: medicine.version };
        const saved = await request(`/medicines/${medicine.id}`, staffToken, 'PUT', payload);
        assert.equal(saved.status, 200);
        assert.equal(saved.data.version, 2);
        assert.equal((await request(`/medicines/${medicine.id}`, staffToken, 'PUT', payload)).status, 409);
        medicine = saved.data;
        assert.equal((await request(`/medicines/${medicine.id}`, staffToken)).data.name, 'Updated medicine');
      });
      await t.test('archive permissions and category deactivation preserve relationships', async () => {
        assert.equal((await request(`/medicines/${medicine.id}/archive`, staffToken, 'PATCH', { version: medicine.version })).status, 403);
        assert.equal((await request(`/categories/${category.id}/deactivate`, pharmacistToken, 'PATCH', { version: category.version })).status, 409);
        const archived = await request(`/medicines/${medicine.id}/archive`, pharmacistToken, 'PATCH', { version: medicine.version });
        assert.equal(archived.status, 200); medicine = archived.data;
        const deactivated = await request(`/categories/${category.id}/deactivate`, pharmacistToken, 'PATCH', { version: category.version });
        assert.equal(deactivated.status, 200); category = deactivated.data;
        assert.equal((await request(`/medicines/${medicine.id}/restore`, pharmacistToken, 'PATCH', { version: medicine.version })).status, 409);
        assert.equal((await request('/medicines', staffToken, 'POST', { ...initialMedicine, barcode: null, category_id: category.id })).status, 409);
        category = (await request(`/categories/${category.id}/activate`, pharmacistToken, 'PATCH', { version: category.version })).data;
        medicine = (await request(`/medicines/${medicine.id}/restore`, pharmacistToken, 'PATCH', { version: medicine.version })).data;
        assert.equal(medicine.status, 'ACTIVE');
      });
      await t.test('batch expiry filters, stock safeguards and dashboard counts use real data', async () => {
        // Seed isolated fixtures directly: production APIs intentionally cannot mutate stock yet.
        await admin.query("INSERT INTO medicine_batches (medicine_id,batch_number,expiry_date,quantity) VALUES (?, 'EXPIRED', DATE_SUB(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 HOUR)), INTERVAL 1 DAY), 3), (?, 'SOON', DATE_ADD(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 HOUR)), INTERVAL 20 DAY), 2)", [medicine.id, medicine.id]);
        assert.equal((await request(`/medicines/${medicine.id}/archive`, pharmacistToken, 'PATCH', { version: medicine.version })).status, 409);
        assert.equal((await request('/medicines?expiry=expired', staffToken)).data.pagination.total, 1);
        assert.equal((await request('/medicines?expiry=30', staffToken)).data.pagination.total, 1);
        const detail = await request(`/medicines/${medicine.id}`, staffToken);
        assert.equal(Number(detail.data.quantity), 5);
        assert.equal(Number(detail.data.usable_quantity), 2);
        const dashboard = (await request('/dashboard', adminToken)).data;
        assert.equal(dashboard.stats.totalMedicines.value, 2);
        assert.equal(dashboard.stats.expiredMedicines.value, 1);
        assert.equal(dashboard.stockOverview.expiringSoon, 1);
        assert.equal(dashboard.stockOverview.lowStock, 1);
        assert.equal(dashboard.stockOverview.outOfStock, 1);
        assert.equal(dashboard.stats.todaySales.value, null);
      });
    } finally {
      if (server) await new Promise(resolve => server.close(resolve));
      if (pool) await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.end();
    }
  });
}
