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
      const approvalSchema = await fs.readFile(path.join(__dirname, '../migrations/004_staff_approval.sql'), 'utf8');
      for (const statement of approvalSchema.split(';').map(value => value.trim()).filter(Boolean)) await admin.query(statement);
      const openingSchema = await fs.readFile(path.join(__dirname, '../migrations/005_opening_stock.sql'), 'utf8');
      for (const statement of openingSchema.split(';').map(value => value.trim()).filter(Boolean)) await admin.query(statement);
      const salesSchema = await fs.readFile(path.join(__dirname, '../migrations/006_sales.sql'), 'utf8');
      for (const statement of salesSchema.split(';').map(value => value.trim()).filter(Boolean)) await admin.query(statement);
      const operationsSchema = await fs.readFile(path.join(__dirname, '../migrations/007_operations.sql'), 'utf8');
      for (const statement of operationsSchema.split(';').map(value => value.trim()).filter(Boolean)) await admin.query(statement);
      const mediaSchema = await fs.readFile(path.join(__dirname, '../migrations/008_media_alerts.sql'), 'utf8');
      for (const statement of mediaSchema.split(';').map(value => value.trim()).filter(Boolean)) await admin.query(statement);
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
        assert.equal(created.token, undefined);
        assert.equal(created.user.status, 'PENDING');
        assert.equal((await request('/auth/login', null, 'POST', { email: body.email, password: body.password })).status, 403);
        // Approved fixture for catalog tests; approval authorization is covered separately.
        await admin.query("UPDATE user_access SET status = 'ACTIVE' WHERE user_id = ?", [created.user.id]);
        staffToken = jwt.sign({ id: created.user.id }, process.env.JWT_SECRET);
        assert.equal((await request('/auth/register', null, 'POST', body)).status, 409);
        const login = await request('/auth/login', null, 'POST', { email: ' STAFF@example.test ', password: 'test-password' });
        assert.equal(login.status, 200);
        assert.equal((await request('/auth/login', null, 'POST', { email: body.email, password: 'incorrect' })).status, 401);
        assert.equal((await request('/auth/register', null, 'POST', { ...body, email: 'bad-email' })).status, 400);
        assert.equal((await request('/auth/register', null, 'POST', { ...body, email: 'long@example.test', password: 'é'.repeat(37) })).status, 400);
        const password = await bcrypt.hash('test-password', 4);
        for (const role of ['admin', 'pharmacist']) {
          const [result] = await admin.query('INSERT INTO users (full_name,email,phone,password,role) VALUES (?,?,?,?,?)', [role, `${role}@example.test`, '+255700000001', password, role]);
          await admin.query("INSERT INTO user_access (user_id, status) VALUES (?, 'ACTIVE')", [result.insertId]);
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
        assert.equal(Number(dashboard.stats.todaySales.value), 0);
      });
      await t.test('stock page enforces access and lists persisted inventory and expiry', async () => {
        assert.equal((await request('/stock')).status, 401);
        assert.equal((await request('/stock', staffToken)).status, 403);
        const listed = await request('/stock', pharmacistToken);
        assert.equal(listed.status, 200);
        assert.equal(listed.data.pagination.total, 2);
        const row = listed.data.items.find(item => item.id === medicine.id);
        assert.equal(Number(row.quantity), 5);
        assert.equal(Number(row.usable_quantity), 2);
        assert.equal(Number(row.expired_quantity), 3);
        assert.equal((await request('/stock?stock=low', adminToken)).data.pagination.total, 1);
        assert.equal((await request('/stock?stock=out', adminToken)).data.pagination.total, 1);
        assert.equal((await request('/stock?expiry=expired', adminToken)).data.pagination.total, 1);
        assert.equal((await request('/stock?expiry=30', adminToken)).data.pagination.total, 1);
        assert.equal((await request('/stock?search=not-present', adminToken)).data.pagination.total, 0);
        assert.equal((await request('/stock?stock=invalid', adminToken)).status, 400);
        assert.equal((await request('/stock?supplier=invalid', adminToken)).status, 400);
        assert.equal((await request('/stock/movements?type=invalid', adminToken)).status, 400);
        assert.equal((await request('/stock/' + medicine.id + '/batches', adminToken)).data.length, 2);
        assert.equal((await request('/stock/options', pharmacistToken)).status, 200);
      });
      await t.test('opening stock is authorized, atomic and safe to retry', async () => {
        const payload = { ...initialMedicine, barcode: 'OPENING-TEST', request_key: crypto.randomUUID(), opening_stock: { quantity: 20, batch_number: 'INITIAL', expiry_date: '2099-12-31' } };
        for (const token of [staffToken, pharmacistToken]) assert.equal((await request('/medicines', token, 'POST', payload)).status, 403);
        for (const stock of [{ quantity: 0 }, { quantity: 1.5 }, { batch_number: '' }, { expiry_date: '2020-01-01' }, { expiry_date: '2099-02-30' }]) {
          assert.equal((await request('/medicines', adminToken, 'POST', { ...payload, opening_stock: { ...payload.opening_stock, ...stock } })).status, 400);
        }
        const results = await Promise.all([request('/medicines', adminToken, 'POST', payload), request('/medicines', adminToken, 'POST', payload)]);
        for (const result of results) {
          assert.equal(result.status, 201, JSON.stringify(result));
          assert.equal(Number(result.data.quantity), 20);
          assert.equal(result.data.batches.length, 1);
          assert.equal(result.data.opening_stock_movements.length, 1);
          assert.equal(result.data.opening_stock_movements[0].previous_stock, 0);
          assert.equal(result.data.opening_stock_movements[0].new_stock, 20);
        }
        assert.equal(results[0].data.id, results[1].data.id);
        const movements = await request('/stock/movements?type=ADJUSTMENT&search=OPENING-', adminToken);
        assert.equal(movements.status, 200);
        assert.equal(movements.data.pagination.total, 1);
        assert.equal(movements.data.items[0].new_stock, 20);
        assert.equal((await request('/medicines', adminToken, 'POST', { ...payload, name: 'Changed' })).status, 409);
        assert.equal((await request('/medicines/' + results[0].data.id, adminToken, 'PUT', { ...payload, version: 1 })).status, 400);
        const [audit] = await admin.query("SELECT COUNT(*) AS total FROM audit_logs WHERE action = 'OPENING_STOCK' AND entity_id = ?", [results[0].data.id]);
        assert.equal(audit[0].total, 1);
        const Catalog = require('../models/Catalog');
        const original = Catalog.saveOpeningStock;
        Catalog.saveOpeningStock = async (...args) => { await original(...args); throw new Error('Injected transaction failure'); };
        try {
          assert.equal((await request('/medicines', adminToken, 'POST', { ...payload, barcode: 'ROLLBACK-TEST', request_key: crypto.randomUUID() })).status, 500);
          const [rows] = await admin.query("SELECT id FROM medicines WHERE barcode = 'ROLLBACK-TEST'");
          assert.equal(rows.length, 0);
          const [requests] = await admin.query('SELECT COUNT(*) AS total FROM medicine_creation_requests');
          assert.equal(requests[0].total, 1);
          const [movements] = await admin.query("SELECT COUNT(*) AS total FROM stock_movements WHERE type = 'ADJUSTMENT'");
          assert.equal(movements[0].total, 1);
        } finally { Catalog.saveOpeningStock = original; }
      });
      await t.test('sales enforce FEFO, server prices, atomic rollback, idempotency and reports', async () => {
        const soldMedicine = (await request('/medicines', adminToken, 'POST', { ...initialMedicine, barcode: 'SALE-FIXTURE', request_key: crypto.randomUUID(), opening_stock: { quantity: 10, batch_number: 'LATER', expiry_date: '2099-12-31' } })).data;
        await admin.query("INSERT INTO medicine_batches (medicine_id,batch_number,expiry_date,quantity,purchase_price) VALUES (?, 'EARLY', '2098-01-01', 5, 1000), (?, 'OLD', '2020-01-01', 9, 1000)", [soldMedicine.id,soldMedicine.id]);
        const payload = { request_key: crypto.randomUUID(), customer_name: 'Walk-in test', discount: '500', amount_paid: '20000', payment_method: 'CASH', items: [{ medicine_id: soldMedicine.id, quantity: 7, unit_price: '1500' }] };
        assert.equal((await request('/sales')).status,401);
        assert.equal(require('../config/permissions').permissionsFor('store_keeper').includes('sales:write'),false);
        assert.equal((await request('/reports',staffToken)).status,403);
        assert.equal((await request('/sales',staffToken,'POST',{...payload,items:[{...payload.items[0],unit_price:'1'}]})).status,409);
        assert.equal((await request('/sales',staffToken,'POST',{...payload,amount_paid:'0'})).status,400);
        assert.equal((await request('/sales',staffToken,'POST',{...payload,items:[...payload.items,{medicine_id:999999,quantity:1,unit_price:'1'}]})).status,409);
        assert.equal(Number((await request('/medicines/'+soldMedicine.id,adminToken)).data.quantity),24);
        const [first,retry] = await Promise.all([request('/sales',staffToken,'POST',payload),request('/sales',staffToken,'POST',payload)]);
        assert.equal(first.status,201,JSON.stringify(first));
        assert.equal(retry.status,201,JSON.stringify(retry));
        assert.equal(first.data.id,retry.data.id);
        assert.equal(first.data.total_amount,'10000.00');
        assert.equal(first.data.change_amount,'10000.00');
        assert.equal(first.data.items[0].batch_number,'EARLY');
        assert.equal(first.data.items[0].quantity,5);
        assert.equal(first.data.items[1].quantity,2);
        assert.equal((await request('/sales',staffToken,'POST',{...payload,discount:'0'})).status,409);
        assert.equal((await request('/sales/'+first.data.id,staffToken,'DELETE')).status,404);
        const next={...payload,discount:'0',items:[{...payload.items[0],quantity:6}]};
        const concurrent=await Promise.all([request('/sales',staffToken,'POST',{...next,request_key:crypto.randomUUID()}),request('/sales',staffToken,'POST',{...next,request_key:crypto.randomUUID()})]);
        assert.deepEqual(concurrent.map(row=>row.status).sort(),[201,409]);
        const remaining=(await request('/medicines/'+soldMedicine.id,adminToken)).data;
        assert.equal(Number(remaining.quantity),11);
        assert.equal(Number(remaining.usable_quantity),2);
        assert.equal((await request('/sales',staffToken,'POST',{...next,request_key:crypto.randomUUID()})).status,409);
        for (const type of ['sales','purchases','stock','expiry','low_stock','profit','suppliers','medicines']) {
          const report=await request('/reports?type='+type,adminToken);
          assert.equal(report.status,200,JSON.stringify(report));
          if(type==='profit') {
            assert.equal(report.data.items[0].net_sales,'19000.00');
            assert.equal(Number(report.data.items[0].cost_of_goods),15004);
            assert.equal(Number(report.data.items[0].gross_profit),3996);
          }
        }
        assert.equal((await request('/reports?type=invalid',adminToken)).status,400);
        assert.equal((await request('/reports?from=2099-01-01&to=2000-01-01',adminToken)).status,400);
        assert.equal((await request('/reports?type=sales&from=2000-01-01&to=2000-01-02',adminToken)).data.pagination.total,0);
        assert.equal(Number((await request('/dashboard',adminToken)).data.stats.todaySales.value),19000);
        const [audit]=await admin.query("SELECT COUNT(*) total FROM audit_logs WHERE action='COMPLETED_SALE'");
        assert.equal(audit[0].total,2);
        const Purchase=require('../models/Purchase'), original=Purchase.movement;
        Purchase.movement=async(...args)=>{await original(...args);throw new Error('Injected sale failure');};
        try {
          const failed={...payload,request_key:crypto.randomUUID(),discount:'0',items:[{...payload.items[0],quantity:1}]};
          assert.equal((await request('/sales',staffToken,'POST',failed)).status,500);
          assert.equal(Number((await request('/medicines/'+soldMedicine.id,adminToken)).data.quantity),11);
          const [rows]=await admin.query('SELECT COUNT(*) total FROM sales');
          assert.equal(rows[0].total,2);
        } finally {Purchase.movement=original;}
      });
    } finally {
      if (server) await new Promise(resolve => server.close(resolve));
      if (pool) await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.end();
    }
  });
}
