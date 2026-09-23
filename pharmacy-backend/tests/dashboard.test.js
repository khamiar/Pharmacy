const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
process.env.JWT_SECRET = 'phase-one-test-key-not-for-deployment';
// Isolate HTTP tests from the configured database; exercise real routes and middleware.
const dbPath = require.resolve('../config/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {} };
const User = require('../models/User');
const Dashboard = require('../models/Dashboard');
let user = { id: 1, full_name: 'Test staff', email: 'staff@example.test', role: 'staff' };
let unavailable = false;
let activitiesRead = 0;
Dashboard.purchasingSummary = async () => ({ totalSuppliers: 2, todayPurchases: '1500.00' });
Dashboard.catalogSummary = async () => ({ totalMedicines: 3, lowStockMedicines: 2, expiredMedicines: 1, inStock: 1, outOfStock: 1, expiringSoon: 1 });
Dashboard.lowStockMedicines = async () => [{ id: 1, medicine: 'Test medicine', currentStock: 0 }];
User.findById = async () => { if (unavailable) throw Object.assign(new Error('private details'), { code: 'TEST_DB_FAILURE' }); return user; };
Dashboard.recentRegistrations = async () => { activitiesRead++; return [{ id: 'user-1', action: 'User registered' }]; };
const app = require('../server');
let server, base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));
const token = (claims = {}, options = {}) => jwt.sign({ id: 1, role: 'admin', ...claims }, process.env.JWT_SECRET, { expiresIn: '1h', ...options });
const request = (path, bearer, options = {}) => fetch(`${base}${path}`, { ...options, headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...options.headers } });
test('dashboard rejects missing, malformed and expired tokens', async () => {
  for (const value of [undefined, 'invalid', token({}, { expiresIn: -1 })]) {
    assert.equal((await request('/api/dashboard', value)).status, 401);
  }
});
test('current database role overrides admin claim; operational data stays explicitly unavailable', async () => {
  const response = await request('/api/dashboard', token());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const { data } = await response.json();
  assert.equal(data.currency, 'TZS');
  assert.equal(data.stats.totalMedicines.value, 3);
  assert.equal(data.stats.totalMedicines.status, 'ready');
  assert.equal(data.stats.todayPurchases.status, 'restricted');
  assert.equal(data.recentActivities.status, 'restricted');
  assert.equal(activitiesRead, 0);
  assert.ok(!data.permissions.includes('settings'));
});
test('admin receives real model activity without fabricated totals', async () => {
  user = { ...user, role: 'admin' };
  const { data } = await (await request('/api/dashboard', token())).json();
  assert.equal(data.recentActivities.items[0].action, 'User registered');
  assert.equal(activitiesRead, 1);
  assert.equal(data.stats.totalMedicines.value, 3);
  assert.equal(data.stockOverview.lowStock, 1);
  assert.equal(data.stockOverview.outOfStock, 1);
  assert.equal(data.stats.todaySales.value, null);
});
test('profile returns current account and server permissions', async () => {
  const { user: profile, permissions } = await (await request('/api/auth/me', token())).json();
  assert.equal(profile.role, 'admin'); assert.ok(permissions.includes('users'));
  assert.equal(profile.password, undefined);
});
test('unknown roles denied and deleted accounts rejected', async () => {
  for (const role of ['unknown', 'constructor', '__proto__']) {
    user = { ...user, role };
    assert.equal((await request('/api/dashboard', token())).status, 403);
  }
  user = null;
  assert.equal((await request('/api/dashboard', token())).status, 401);
});
test('database errors are safe server errors, not auth failures', async () => {
  unavailable = true;
  const response = await request('/api/dashboard', token());
  assert.equal(response.status, 500);
  assert.ok(!(await response.text()).includes('private details'));
  unavailable = false;
});
test('malformed JSON returns 400 and unknown routes return JSON 404', async () => {
  assert.equal((await request('/api/auth/login', null, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await request('/api/no-such-route')).status, 404);
});
test('existing login still hashes/verifies credentials and omits password', async () => {
  const password = await bcrypt.hash('test-password', 4);
  User.findByEmail = async () => ({ id: 1, email: 'test@example.test', role: 'staff', password });
  const post = (body) => request('/api/auth/login', null, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ email: 'test@example.test', password: 'wrong' })).status, 401);
  const response = await post({ email: 'test@example.test', password: 'test-password' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.user.password, undefined);
  assert.equal(jwt.verify(result.token, process.env.JWT_SECRET).role, 'staff');
});
test('registration preserves default staff role even when client requests admin', async () => {
  User.findByEmail = async () => null;
  User.create = async (input) => {
    assert.equal(input.role, undefined);
    assert.ok(await bcrypt.compare('test-password', input.hashedPassword));
    return 1;
  };
  user = { id: 1, role: 'staff' };
  const response = await request('/api/auth/register', null, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullName: 'Test', email: 'test@example.test', phone: '+255700000000', password: 'test-password', role: 'admin' }) });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).user.role, 'staff');
});
