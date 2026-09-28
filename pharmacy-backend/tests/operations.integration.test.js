const {
  test
} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  crypto = require('node:crypto');
if (process.env.RUN_DB_TESTS !== '1') test('Operations MySQL integration (set RUN_DB_TESTS=1)', {
  skip: true
}, () => {});else test('Customers, prescriptions, settings, notifications and audit integration', async t => {
  require('dotenv').config({
    path: path.join(__dirname, '../.env')
  });
  const mysql = require('mysql2/promise'),
    jwt = require('jsonwebtoken');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  });
  const database = 'pharmacy_operations_test_' + crypto.randomBytes(6).toString('hex');
  let pool, server;
  try {
    await connection.query('CREATE DATABASE ' + database);
    await connection.query('USE ' + database);
    const schema = await fs.readFile(path.join(__dirname, '../models/schema.sql'), 'utf8');
    await connection.query(schema.slice(schema.indexOf('CREATE TABLE')));
    const dir = path.join(__dirname, '../migrations');
    for (const file of (await fs.readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
      const sql = await fs.readFile(path.join(dir, file), 'utf8');
      for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await connection.query(statement);
    }
    process.env.DB_NAME = database;
    process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
    pool = require('../config/db');
    server = require('../server').listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port + '/api';
    const tokens = {};
    for (const role of ['admin', 'pharmacist', 'staff']) {
      const [result] = await connection.query('INSERT INTO users(full_name,email,phone,password,role) VALUES(?,?,?,?,?)', [role, role + '@example.test', '000', 'unused', role]);
      await connection.query("INSERT INTO user_access(user_id,status) VALUES(?,'ACTIVE')", [result.insertId]);
      tokens[role] = jwt.sign({
        id: result.insertId
      }, process.env.JWT_SECRET);
    }
    const request = async (url, role = 'admin', method = 'GET', body) => {
      const response = await fetch(base + url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(role ? {
            Authorization: 'Bearer ' + tokens[role]
          } : {})
        },
        ...(body ? {
          body: JSON.stringify(body)
        } : {})
      });
      return {
        status: response.status,
        ...(await response.json())
      };
    };
    const today = new Date(Date.now() + 10800000).toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
    let customer, medicine, rx, settings, sale;
    const customerBody = {
      full_name: 'Test Patient',
      phone: '+255700000123',
      email: 'patient@example.test',
      address: 'Zanzibar',
      date_of_birth: '1990-01-01',
      notes: 'Private customer notes'
    };
    const rxBody = () => ({
      customer_id: customer.id,
      doctor: 'Test Doctor',
      prescription_date: today,
      notes: 'Private medical notes',
      request_key: crypto.randomUUID(),
      items: [{
        medicine_id: medicine.id,
        dosage: 'As prescribed',
        frequency: 'Recorded frequency',
        duration: 'Recorded duration',
        quantity: 5,
        instructions: 'Private instructions'
      }]
    });
    const checkout = (quantity, prescription = rx.id) => ({
      request_key: crypto.randomUUID(),
      customer_id: customer.id,
      prescription_id: prescription,
      customer_name: 'Untrusted name',
      discount: '0',
      amount_paid: '10000',
      payment_method: 'CASH',
      items: [{
        medicine_id: medicine.id,
        quantity,
        unit_price: '100'
      }]
    });
    await t.test('authentication, role enforcement and customer validation', async () => {
      for (const route of ['/customers', '/prescriptions', '/settings', '/notifications', '/audit']) assert.equal((await request(route, null)).status, 401);
      for (const route of ['/prescriptions', '/settings', '/audit']) assert.equal((await request(route, 'staff')).status, 403);
      assert.equal((await request('/settings', 'pharmacist')).status, 403);
      assert.equal((await request('/settings/profile', 'staff')).status, 200);
      assert.equal((await request('/customers', 'staff', 'POST', {
        ...customerBody,
        email: 'bad'
      })).status, 400);
      assert.equal((await request('/customers', 'staff', 'POST', {
        ...customerBody,
        date_of_birth: '2099-01-01'
      })).status, 400);
      const created = await request('/customers', 'staff', 'POST', customerBody);
      assert.equal(created.status, 201);
      customer = created.data;
      const list = (await request('/customers?search=Test', 'staff')).data.items;
      assert.equal(list.length, 1);
      assert.equal(list[0].notes, undefined);
      assert.equal(list[0].date_of_birth, undefined);
      const update = {
        ...customerBody,
        phone: '+255700000124',
        version: customer.version
      };
      customer = (await request('/customers/' + customer.id, 'staff', 'PUT', update)).data;
      assert.equal((await request('/customers/' + customer.id, 'staff', 'PUT', update)).status, 409);
      assert.equal((await request('/customers/' + customer.id, 'staff', 'DELETE')).status, 404);
    });
    await t.test('settings validate, persist, guard concurrency and feed medicine defaults', async () => {
      const {
        id,
        ...initial
      } = (await request('/settings')).data;
      assert.equal(initial.currency, 'TZS');
      assert.equal((await request('/settings', 'admin', 'PUT', {
        ...initial,
        currency: 'USD'
      })).status, 400);
      assert.equal((await request('/settings', 'admin', 'PUT', {
        ...initial,
        logo_url: 'javascript:alert(1)'
      })).status, 400);
      const saved = await request('/settings', 'admin', 'PUT', {
        ...initial,
        pharmacy_name: 'Test Pharmacy Zanzibar',
        low_stock_threshold: 7,
        expiry_warning_days: 60,
        invoice_prefix: 'TEST',
        invoice_footer: 'Thank you'
      });
      assert.equal(saved.status, 200, JSON.stringify(saved));
      settings = saved.data;
      assert.equal((await request('/settings', 'admin', 'PUT', initial)).status, 409);
      assert.equal((await request('/medicines/options', 'staff')).data.defaults.low_stock_threshold, 7);
      const created = await request('/medicines', 'admin', 'POST', {
        name: 'Prescription medicine',
        medicine_type: 'Tablet',
        purchase_price: '50',
        selling_price: '100',
        minimum_stock: 20,
        request_key: crypto.randomUUID(),
        opening_stock: {
          quantity: 20,
          batch_number: 'RX-STOCK',
          expiry_date: soon
        }
      });
      assert.equal(created.status, 201);
      medicine = created.data;
    });
    await t.test('prescription lists omit clinical data; creation and edits are validated and audited', async () => {
      const body = rxBody();
      assert.equal((await request('/prescriptions', 'staff', 'POST', body)).status, 403);
      assert.equal((await request('/prescriptions', 'pharmacist', 'POST', {
        ...body,
        items: [{
          ...body.items[0],
          quantity: 0
        }]
      })).status, 400);
      const created = await request('/prescriptions', 'pharmacist', 'POST', body);
      assert.equal(created.status, 201, JSON.stringify(created));
      rx = created.data;
      assert.equal((await request('/prescriptions', 'pharmacist', 'POST', body)).status, 409);
      const list = (await request('/prescriptions', 'pharmacist')).data.items[0];
      assert.equal(list.notes, undefined);
      assert.equal(list.customer_name, undefined);
      assert.equal(list.doctor, undefined);
      assert.equal((await request('/prescriptions/' + rx.id, 'pharmacist')).data.notes, 'Private medical notes');
      const {
        request_key,
        ...edited
      } = body;
      const update = {
        ...edited,
        version: rx.version
      };
      rx = (await request('/prescriptions/' + rx.id, 'pharmacist', 'PUT', update)).data;
      assert.equal((await request('/prescriptions/' + rx.id, 'pharmacist', 'PUT', update)).status, 409);
      const dashboard = (await request('/dashboard')).data;
      assert.equal(dashboard.stats.totalCustomers.value, 1);
      assert.equal(dashboard.stats.pendingPrescriptions.value, 1);
    });
    await t.test('dispensing is atomic, role protected, partial and safe under concurrent retries', async () => {
      const payload = checkout(2);
      assert.equal((await request('/sales', 'staff', 'POST', payload)).status, 403);
      assert.equal((await request('/sales', 'pharmacist', 'POST', {
        ...checkout(6)
      })).status, 409);
      const Purchase = require('../models/Purchase'),
        original = Purchase.movement;
      Purchase.movement = async (...args) => {
        await original(...args);
        throw new Error('Injected failure');
      };
      try {
        assert.equal((await request('/sales', 'pharmacist', 'POST', payload)).status, 500);
        assert.equal((await request('/prescriptions/' + rx.id, 'pharmacist')).data.status, 'PENDING');
        assert.equal(Number((await request('/medicines/' + medicine.id)).data.quantity), 20);
        const [[count]] = await connection.query('SELECT COUNT(*) total FROM sale_details');
        assert.equal(count.total, 0);
      } finally {
        Purchase.movement = original;
      }
      const results = await Promise.all([request('/sales', 'pharmacist', 'POST', payload), request('/sales', 'pharmacist', 'POST', payload)]);
      results.forEach(result => assert.equal(result.status, 201, JSON.stringify(result)));
      assert.equal(results[0].data.id, results[1].data.id);
      sale = results[0].data;
      assert.equal(sale.customer_name, customer.full_name);
      assert.ok(sale.invoice_number.startsWith('TEST-'));
      assert.equal(sale.pharmacy_profile.pharmacy_name, settings.pharmacy_name);
      rx = (await request('/prescriptions/' + rx.id, 'pharmacist')).data;
      assert.equal(rx.status, 'PARTIALLY_DISPENSED');
      assert.equal(rx.items[0].dispensed_quantity, 2);
      const {
        request_key,
        ...edit
      } = rxBody();
      assert.equal((await request('/prescriptions/' + rx.id, 'pharmacist', 'PUT', {
        ...edit,
        version: rx.version
      })).status, 409);
      const concurrent = await Promise.all([request('/sales', 'pharmacist', 'POST', checkout(3)), request('/sales', 'pharmacist', 'POST', checkout(3))]);
      assert.deepEqual(concurrent.map(row => row.status).sort(), [201, 409]);
      rx = (await request('/prescriptions/' + rx.id, 'pharmacist')).data;
      assert.equal(rx.status, 'DISPENSED');
      assert.equal(rx.items[0].dispensed_quantity, 5);
      assert.equal(Number((await request('/medicines/' + medicine.id)).data.quantity), 15);
      assert.equal((await request('/customers/' + customer.id + '/history', 'staff')).data.pagination.total, 2);
      assert.equal((await request('/sales', 'pharmacist', 'POST', checkout(1))).status, 409);
      assert.equal((await request('/prescriptions/' + rx.id + '/cancel', 'pharmacist', 'PATCH', {
        version: rx.version
      })).status, 409);
    });
    await t.test('cancellation retains historical transactions and receipts preserve saved pharmacy profile', async () => {
      const pending = (await request('/prescriptions', 'pharmacist', 'POST', rxBody())).data;
      const cancelled = await request('/prescriptions/' + pending.id + '/cancel', 'pharmacist', 'PATCH', {
        version: pending.version
      });
      assert.equal(cancelled.status, 200);
      assert.equal(cancelled.data.status, 'CANCELLED');
      assert.equal((await request('/sales', 'pharmacist', 'POST', checkout(1, pending.id))).status, 409);
      const {
        id,
        ...values
      } = settings;
      settings = (await request('/settings', 'admin', 'PUT', {
        ...values,
        pharmacy_name: 'Changed pharmacy'
      })).data;
      assert.equal((await request('/sales/' + sale.id, 'pharmacist')).data.pharmacy_profile.pharmacy_name, 'Test Pharmacy Zanzibar');
      assert.equal((await request('/settings/profile', 'staff')).data.pharmacy_name, 'Changed pharmacy');
    });
    await t.test('notifications use real stock and per-user reads; audit is protected and searchable', async () => {
      const notifications = await request('/notifications?limit=100', 'pharmacist');
      assert.equal(notifications.status, 200);
      assert.ok(notifications.data.items.some(item => item.type === 'EXPIRING'));
      const low = notifications.data.items.find(item => item.type === 'LOW_STOCK');
      assert.ok(low);
      assert.equal((await request('/notifications/read', 'pharmacist', 'POST', {
        key: low.key
      })).status, 200);
      assert.equal((await request('/notifications?unread=true&limit=100', 'pharmacist')).data.items.some(item => item.key === low.key), false);
      assert.equal((await request('/notifications?unread=true&limit=100', 'admin')).data.items.some(item => item.key === low.key), true);
      assert.equal((await request('/notifications/read', 'staff', 'POST', {
        key: 'audit-999999'
      })).status, 404);
      const audit = await request('/audit?search=DISPENSED_PRESCRIPTION');
      assert.equal(audit.status, 200);
      assert.equal(audit.data.pagination.total, 2);
      const {
        id,
        ...values
      } = settings;
      await request('/settings', 'admin', 'PUT', {
        ...values,
        expiry_warning_days: 30
      });
      assert.equal((await request('/notifications?limit=100', 'pharmacist')).data.items.some(item => item.type === 'EXPIRING'), false);
      assert.equal((await request('/audit', 'pharmacist')).status, 403);
    });
    await t.test('uploaded images are validated, role-protected, persisted and included in PDF invoices',async()=>{
      const png=await require('sharp')({create:{width:32,height:32,channels:3,background:'#157347'}}).png().toBuffer();
      const payload={purpose:'medicine',image:'data:image/png;base64,'+png.toString('base64')};
      assert.equal((await request('/media',null,'POST',payload)).status,401);
      assert.equal((await request('/media','staff','POST',{...payload,purpose:'logo'})).status,403);
      assert.equal((await request('/media','admin','POST',{...payload,image:'data:image/png;base64,YmFk'})).status,400);
      assert.equal((await request('/media','admin','POST',{...payload,image:'data:image/svg+xml;base64,PHN2Zz4='})).status,400);
      const uploaded=await request('/media','staff','POST',payload);assert.equal(uploaded.status,201,JSON.stringify(uploaded));
      const body={name:'Photo medicine',medicine_type:'Tablet',purchase_price:'50',selling_price:'100',minimum_stock:10,image_url:uploaded.data.url,request_key:crypto.randomUUID(),opening_stock:{quantity:12,batch_number:'PHOTO',expiry_date:'2099-01-01'}};
      const photo=await request('/medicines','admin','POST',body);assert.equal(photo.status,201,JSON.stringify(photo));
      assert.equal((await request('/medicines/'+photo.data.id)).data.image_url,uploaded.data.url);
      const image=await fetch(base.replace(/\/api$/,'')+uploaded.data.url);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');
      assert.equal((await image.arrayBuffer()).byteLength>0,true);
      const logo=await request('/media','admin','POST',{...payload,purpose:'logo'});
      let {id,...profile}=(await request('/settings')).data;
      assert.equal((await request('/settings','admin','PUT',{...profile,logo_url:uploaded.data.url})).status,400);
      const saved=await request('/settings','admin','PUT',{...profile,logo_url:logo.data.url,invoice_title:'PHARMACY INVOICE',invoice_terms:'Keep your receipt.',website:'https://example.test',business_hours:'08:00–20:00',alert_expiry_days:10,alert_stock_quantity:10,alert_interval_minutes:10});
      assert.equal(saved.status,200,JSON.stringify(saved));
      const paid=await request('/sales','admin','POST',{request_key:crypto.randomUUID(),discount:'0',amount_paid:'500',payment_method:'CASH',items:[{medicine_id:photo.data.id,quantity:2,unit_price:'100'}]});
      assert.equal(paid.status,201,JSON.stringify(paid));assert.equal(paid.data.pharmacy_profile.logo_url,logo.data.url);
      const url=base+'/sales/'+paid.data.id+'/invoice';
      assert.equal((await fetch(url)).status,401);
      const response=await fetch(url,{headers:{Authorization:'Bearer '+tokens.admin}});
      assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');assert.match(response.headers.get('content-disposition'),/attachment/);
      const pdf=Buffer.from(await response.arrayBuffer());assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>1000);
      const alerts=(await request('/notifications','pharmacist')).data.alerts;
      assert.equal(alerts.intervalMinutes,10);assert.equal(alerts.stockQuantity,10);assert.equal(alerts.expiryDays,10);assert.ok(alerts.lowStockMedicines>=1);
      await connection.query("INSERT INTO medicine_batches(medicine_id,batch_number,expiry_date,quantity,purchase_price) VALUES (?,'TEN-DAYS',DATE_ADD(DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 3 HOUR)),INTERVAL 10 DAY),1,50),(?,'ELEVEN-DAYS',DATE_ADD(DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 3 HOUR)),INTERVAL 11 DAY),1,50),(?,'EXPIRED-ALERT','2020-01-01',1,50)",[photo.data.id,photo.data.id,photo.data.id]);
      const expired=(await request('/notifications','pharmacist')).data.alerts;
      assert.equal(expired.expiringBatches,1);assert.equal(expired.expiredBatches,1);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    await connection.query('DROP DATABASE IF EXISTS ' + database);
    await connection.end();
  }
});
