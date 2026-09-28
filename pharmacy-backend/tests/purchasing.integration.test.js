const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
if (process.env.RUN_DB_TESTS !== '1') {
  test('MySQL purchasing integration (set RUN_DB_TESTS=1)', { skip: true }, () => {});
} else {
  test('Supplier and purchase transaction integration', async t => {
    require('dotenv').config({ path: path.join(__dirname, '../.env') });
    const mysql = require('mysql2/promise');
    const jwt = require('jsonwebtoken');
    const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    const database = `pharmacy_purchase_test_${crypto.randomBytes(6).toString('hex')}`;
    let pool, server;
    try {
      await connection.query(`CREATE DATABASE \`${database}\``);
      await connection.query(`USE \`${database}\``);
      const schema = await fs.readFile(path.join(__dirname, '../models/schema.sql'), 'utf8');
      await connection.query(schema.slice(schema.indexOf('CREATE TABLE')));
      for (const file of ['002_catalog.sql', '003_purchasing.sql', '003_purchasing.sql', '004_staff_approval.sql']) {
        const sql = await fs.readFile(path.join(__dirname, '../migrations', file), 'utf8');
        for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await connection.query(statement);
      }
      const salesSchema = await fs.readFile(path.join(__dirname, '../migrations/006_sales.sql'), 'utf8');
      for (const statement of salesSchema.split(';').map(value => value.trim()).filter(Boolean)) await connection.query(statement);
      const operationsSchema = await fs.readFile(path.join(__dirname, '../migrations/007_operations.sql'), 'utf8');
      for (const statement of operationsSchema.split(';').map(value => value.trim()).filter(Boolean)) await connection.query(statement);
      const mediaSchema = await fs.readFile(path.join(__dirname, '../migrations/008_media_alerts.sql'), 'utf8');
      for (const statement of mediaSchema.split(';').map(value => value.trim()).filter(Boolean)) await connection.query(statement);
      process.env.DB_NAME = database; process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
      pool = require('../config/db');
      server = require('../server').listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      const base = `http://127.0.0.1:${server.address().port}/api`;
      const request = async (url, token, method = 'GET', body) => {
        const response = await fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, ...(await response.json()) };
      };
      const tokens = {};
      for (const role of ['admin', 'staff', 'pharmacist']) {
        const [result] = await connection.query('INSERT INTO users (full_name,email,phone,password,role) VALUES (?,?,?,?,?)', [role, `${role}@example.test`, '+255700000000', 'unused-test-hash', role]);
        await connection.query("INSERT INTO user_access (user_id, status) VALUES (?, 'ACTIVE')", [result.insertId]);
        tokens[role] = jwt.sign({ id: result.insertId }, process.env.JWT_SECRET);
      }
      const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
      const future = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
      const past = '2000-01-01';
      let supplier, supplier2, medicine, medicine2, completed;
      const body = (invoice, overrides = {}) => ({ supplier_id: supplier.id, purchase_date: today, invoice_number: invoice, request_key: crypto.randomUUID(), amount_paid: '0', items: [{ medicine_id: medicine.id, batch_number: 'BATCH-01', quantity: 3, purchase_price: '0.10', selling_price: '0.20', expiry_date: future }], ...overrides });
      await t.test('staff can browse categories but cannot write categories or access purchasing', async () => {
        assert.equal((await request('/categories', tokens.staff)).status, 200);
        assert.equal((await request('/categories', tokens.staff, 'POST', { name: 'Forbidden' })).status, 403);
        for (const endpoint of ['/suppliers', '/purchases', '/purchases/medicines']) {
          assert.equal((await request(endpoint)).status, 401);
          assert.equal((await request(endpoint, tokens.staff)).status, 403);
          assert.equal((await request(endpoint, tokens.pharmacist)).status, 403);
        }
        const { permissionsFor } = require('../config/permissions');
        assert.ok(permissionsFor('store_keeper').includes('purchases:write'));
        assert.ok(!permissionsFor('cashier').includes('purchases'));
      });
      await t.test('supplier CRUD, unique registration and optimistic concurrency', async () => {
        const created = await request('/suppliers', tokens.admin, 'POST', { name: ' Zanzibar Supplier ', company: 'Trade company', email: 'CONTACT@example.test', registration_number: 'REG-001' });
        assert.equal(created.status, 201); supplier = created.data;
        assert.equal(supplier.name, 'Zanzibar Supplier');
        assert.equal(supplier.email, 'contact@example.test');
        assert.equal((await request('/suppliers', tokens.admin, 'POST', { name: 'Duplicate', registration_number: 'REG-001' })).status, 409);
        const edited = await request(`/suppliers/${supplier.id}`, tokens.admin, 'PUT', { name: 'Zanzibar Supplier', phone: '+255700000001', registration_number: 'REG-001', version: supplier.version });
        assert.equal(edited.status, 200);
        assert.equal((await request(`/suppliers/${supplier.id}`, tokens.admin, 'PUT', { name: 'Stale', version: supplier.version })).status, 409);
        supplier = edited.data;
        supplier2 = (await request('/suppliers', tokens.admin, 'POST', { name: 'Second supplier' })).data;
        assert.equal((await request('/suppliers?search=Zanzibar', tokens.admin)).data.pagination.total, 1);
        const baseMedicine = { name: 'Receipt medicine', medicine_type: 'Tablet', purchase_price: '0', selling_price: '0', minimum_stock: 10 };
        medicine = (await request('/medicines', tokens.admin, 'POST', baseMedicine)).data;
        medicine2 = (await request('/medicines', tokens.admin, 'POST', { ...baseMedicine, name: 'Other medicine' })).data;
      });
      let original;
      await t.test('receipt commits exact amounts, batches, prices and stock movements together', async () => {
        original = body('INVOICE-001', { amount_paid: '0.10' });
        const received = await request('/purchases', tokens.admin, 'POST', original);
        assert.equal(received.status, 201); completed = received.data;
        assert.equal(completed.total_amount, '0.30'); assert.equal(completed.amount_paid, '0.10');
        assert.equal(completed.payment_status, 'PARTIAL');
        assert.equal(completed.items[0].subtotal, '0.30');
        assert.equal(completed.movements[0].previous_stock, 0); assert.equal(completed.movements[0].new_stock, 3);
        const detail = (await request(`/medicines/${medicine.id}`, tokens.admin)).data;
        assert.equal(Number(detail.quantity), 3); assert.equal(detail.selling_price, '0.20');
        assert.equal(detail.suppliers[0].name, 'Zanzibar Supplier');
        const supplierDetail = (await request(`/suppliers/${supplier.id}`, tokens.admin)).data;
        assert.equal(supplierDetail.total_purchases, '0.30'); assert.equal(supplierDetail.outstanding_balance, '0.20');
        assert.equal(Number(supplierDetail.supplied_medicines[0].received_quantity), 3);
      });
      await t.test('retries and duplicate invoices never receive stock twice', async () => {
        const replay = await request('/purchases', tokens.admin, 'POST', original);
        assert.equal(replay.status, 200); assert.equal(replay.replayed, true); assert.equal(replay.data.id, completed.id);
        assert.equal((await request('/purchases', tokens.admin, 'POST', { ...original, notes: 'changed' })).status, 409);
        assert.equal((await request('/purchases', tokens.admin, 'POST', { ...original, request_key: crypto.randomUUID() })).status, 409);
        assert.equal(Number((await request(`/medicines/${medicine.id}`, tokens.admin)).data.quantity), 3);
        assert.equal((await request(`/purchases/${completed.id}`, tokens.admin, 'PUT', original)).status, 404);
        assert.equal((await request(`/purchases/${completed.id}`, tokens.admin, 'DELETE')).status, 404);
      });
      await t.test('invalid receipt data cannot mutate stock', async () => {
        for (const invalid of [{ quantity: 0 }, { quantity: -1 }, { quantity: 1.5 }, { purchase_price: '-1' }, { purchase_price: '1.234' }, { expiry_date: '2027-02-30' }, { expiry_date: past }]) {
          const payload = body(crypto.randomUUID()); payload.items[0] = { ...payload.items[0], ...invalid };
          assert.equal((await request('/purchases', tokens.admin, 'POST', payload)).status, 400);
        }
        assert.equal((await request('/purchases', tokens.admin, 'POST', body('OVERPAID', { amount_paid: '1.00' }))).status, 400);
        assert.equal((await request('/purchases', tokens.admin, 'POST', body('TOTAL', { total_amount: '0.01' }))).status, 400);
        assert.equal((await request('/purchases', tokens.admin, 'POST', body('NO-LINES', { items: [] }))).status, 400);
        const duplicate = body('DUP-LINES'); duplicate.items.push({ ...duplicate.items[0] });
        assert.equal((await request('/purchases', tokens.admin, 'POST', duplicate)).status, 400);
        assert.equal(Number((await request(`/medicines/${medicine.id}`, tokens.admin)).data.quantity), 3);
      });
      await t.test('late batch conflict rolls back earlier item, header, price and movement changes', async () => {
        const conflicting = body('ROLLBACK');
        conflicting.items = [
          { ...conflicting.items[0], medicine_id: medicine2.id, batch_number: 'NEW-BATCH', purchase_price: '1.00' },
          { ...conflicting.items[0], purchase_price: '9.00' },
        ];
        assert.equal((await request('/purchases', tokens.admin, 'POST', conflicting)).status, 409);
        const other = (await request(`/medicines/${medicine2.id}`, tokens.admin)).data;
        assert.equal(Number(other.quantity), 0); assert.equal(other.batches.length, 0); assert.equal(other.purchase_price, '0.00');
        const [[count]] = await connection.query('SELECT COUNT(*) AS total FROM stock_movements');
        assert.equal(count.total, 1);
        assert.equal((await request('/purchases?search=ROLLBACK', tokens.admin)).data.pagination.total, 0);
      });
      await t.test('concurrent receipts across suppliers serialize stock and preserve movement chain', async () => {
        const first = body('CONCURRENT-A'); const second = body('CONCURRENT-B', { supplier_id: supplier2.id });
        const results = await Promise.all([request('/purchases', tokens.admin, 'POST', first), request('/purchases', tokens.admin, 'POST', second)]);
        assert.deepEqual(results.map(result => result.status), [201, 201]);
        assert.equal(Number((await request(`/medicines/${medicine.id}`, tokens.admin)).data.quantity), 9);
        const [movements] = await connection.query('SELECT previous_stock,new_stock FROM stock_movements WHERE medicine_id = ? ORDER BY id', [medicine.id]);
        assert.deepEqual(movements.map(row => [row.previous_stock, row.new_stock]), [[0, 3], [3, 6], [6, 9]]);
        const same = body('CONCURRENT-RETRY');
        const replayResults = await Promise.all([request('/purchases', tokens.admin, 'POST', same), request('/purchases', tokens.admin, 'POST', same)]);
        assert.deepEqual(replayResults.map(result => result.status).sort(), [200, 201]);
        assert.equal(replayResults[0].data.id, replayResults[1].data.id);
        assert.equal(Number((await request(`/medicines/${medicine.id}`, tokens.admin)).data.quantity), 12);
      });
      await t.test('supplier deactivation blocks new receipts but preserves history and safe replays', async () => {
        supplier = (await request(`/suppliers/${supplier.id}/deactivate`, tokens.admin, 'PATCH', { version: supplier.version })).data;
        assert.equal((await request('/purchases', tokens.admin, 'POST', body('INACTIVE'))).status, 409);
        assert.equal((await request('/purchases', tokens.admin, 'POST', original)).status, 200);
        assert.equal((await request(`/purchases/${completed.id}`, tokens.admin)).status, 200);
        const updatedMedicine = (await request(`/medicines/${medicine.id}`, tokens.admin)).data;
        assert.equal((await request(`/medicines/${medicine.id}/archive`, tokens.admin, 'PATCH', { version: updatedMedicine.version })).status, 409);
      });
      await t.test('dashboard, filters and historical names reflect persisted receipts', async () => {
        await request(`/suppliers/${supplier.id}`, tokens.admin, 'PUT', { name: 'Renamed supplier', version: supplier.version });
        const historical = (await request(`/purchases/${completed.id}`, tokens.admin)).data;
        assert.equal(historical.supplier_name, 'Zanzibar Supplier');
        assert.equal((await request('/purchases?payment_status=PARTIAL', tokens.admin)).data.pagination.total, 1);
        assert.equal((await request(`/purchases?from=${today}&to=${today}`, tokens.admin)).data.pagination.total, 4);
        const dashboard = (await request('/dashboard', tokens.admin)).data;
        assert.equal(dashboard.stats.totalSuppliers.value, 1);
        assert.equal(dashboard.stats.todayPurchases.value, '1.20');
        assert.equal(Number(dashboard.stats.todaySales.value), 0);
      });
      await t.test('combined report includes sales and purchases with totals across pages', async () => {
        const sale = await request('/sales', tokens.admin, 'POST', {
          request_key: crypto.randomUUID(), discount: '0', amount_paid: '1', payment_method: 'CASH',
          items: [{ medicine_id: medicine.id, quantity: 1, unit_price: '0.20' }]
        });
        assert.equal(sale.status,201,JSON.stringify(sale));
        const report = await request('/reports',tokens.admin);
        assert.equal(report.status,200,JSON.stringify(report));
        assert.ok(report.data.items.some(row => row.transaction_type === 'SALE'));
        assert.ok(report.data.items.some(row => row.transaction_type === 'PURCHASE'));
        assert.equal(report.data.summary.sales.records,1);
        assert.equal(report.data.summary.sales.total_amount,'0.20');
        assert.equal(report.data.summary.purchases.records,4);
        assert.equal(report.data.summary.purchases.total_amount,'1.20');
        const page = await request('/reports?limit=1&page=2',tokens.admin);
        assert.equal(page.data.items.length,1);
        assert.deepEqual(page.data.summary,report.data.summary);
        const empty = await request('/reports?from=2000-01-01&to=2000-01-02',tokens.admin);
        assert.equal(empty.data.summary.sales.records,0);
        assert.equal(empty.data.summary.purchases.records,0);
        assert.equal((await request('/reports',tokens.staff)).status,403);
      });
    } finally {
      if (server) await new Promise(resolve => server.close(resolve));
      if (pool) await pool.end();
      await connection.query(`DROP DATABASE IF EXISTS \`${database}\``); await connection.end();
    }
  });
}
