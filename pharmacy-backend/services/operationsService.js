const transaction = require('../utilities/transaction');
const {
  fail
} = require('../validators/catalog');
const crypto = require('node:crypto');
const Customer = require('../models/Customer');
const Prescription = require('../models/Prescription');
const Settings = require('../models/Settings');
async function audit(connection, user, action, entity, id, description) {
  await connection.query('INSERT INTO audit_logs(user_id,action,entity,entity_id,description) VALUES(?,?,?,?,?)', [user, action, entity, id, description]);
}
exports.customer = async (data, user, id) => {
  const saved = await transaction(async connection => {
    const {
      version,
      ...fields
    } = data;
    if (id) {
      const [[row]] = await connection.query('SELECT version FROM customers WHERE id=? FOR UPDATE', [id]);
      if (!row) fail('Customer not found.', 404);
      if (row.version !== version) fail('Customer changed. Reload before saving.', 409);
      await connection.query('UPDATE customers SET ?,version=version+1 WHERE id=?', [{
        ...fields,
        updated_by: user
      }, id]);
    } else {
      const [result] = await connection.query('INSERT INTO customers SET ?', [{
        ...fields,
        created_by: user,
        updated_by: user
      }]);
      id = result.insertId;
    }
    await audit(connection, user, version ? 'UPDATED_CUSTOMER' : 'CREATED_CUSTOMER', 'Customer', id, 'Customer record saved.');
    return id;
  });
  return Customer.find(saved);
};
exports.prescription = async (data, user, id) => {
  const saved = await transaction(async connection => {
    const {
      items,
      version,
      ...fields
    } = data;
    if (id) {
      const [[row]] = await connection.query('SELECT status,version FROM prescriptions WHERE id=? FOR UPDATE', [id]);
      if (!row) fail('Prescription not found.', 404);
      if (row.version !== version || row.status !== 'PENDING') fail('Only an unchanged pending prescription can be edited.', 409);
    }
    const [[customer]] = await connection.query('SELECT id FROM customers WHERE id=?', [data.customer_id]);
    if (!customer) fail('Select an existing customer.', 400);
    for (const item of items) {
      const [[medicine]] = await connection.query("SELECT id FROM medicines WHERE id=? AND status='ACTIVE'", [item.medicine_id]);
      if (!medicine) fail('Select active medicines.', 400);
    }
    if (id) {
      await connection.query('UPDATE prescriptions SET ?,version=version+1 WHERE id=?', [{
        ...fields,
        updated_by: user
      }, id]);
      await connection.query('DELETE FROM prescription_items WHERE prescription_id=?', [id]);
    } else {
      const [result] = await connection.query('INSERT INTO prescriptions SET ?', [{
        ...fields,
        prescription_number: 'RX-' + crypto.randomUUID().toUpperCase(),
        created_by: user,
        updated_by: user
      }]);
      id = result.insertId;
    }
    for (const item of items) await connection.query('INSERT INTO prescription_items SET ?', [{
      ...item,
      prescription_id: id
    }]);
    await audit(connection, user, version ? 'UPDATED_PRESCRIPTION' : 'CREATED_PRESCRIPTION', 'Prescription', id, 'Prescription saved.');
    return id;
  });
  return Prescription.find(saved);
};
exports.cancel = async (id, version, user) => {
  await transaction(async connection => {
    const [[row]] = await connection.query('SELECT status,version FROM prescriptions WHERE id=? FOR UPDATE', [id]);
    if (!row) fail('Prescription not found.', 404);
    if (row.version !== version || !['PENDING', 'PARTIALLY_DISPENSED'].includes(row.status)) fail('This prescription cannot be cancelled. Reload its current status.', 409);
    await connection.query("UPDATE prescriptions SET status='CANCELLED',version=version+1,updated_by=? WHERE id=?", [user, id]);
    await audit(connection, user, 'CANCELLED_PRESCRIPTION', 'Prescription', id, 'Remaining dispensing cancelled. Existing sales retained.');
  });
  return Prescription.find(id);
};
exports.settings = async (data, user) => {
  await transaction(async connection => {
    const [[row]] = await connection.query('SELECT version FROM pharmacy_settings WHERE id=1 FOR UPDATE');
    if (row.version !== data.version) fail('Settings changed. Reload before saving.', 409);
    const {
      version,
      ...values
    } = data;
    const preferenceKeys=['alerts_enabled','alert_expiry_days','alert_stock_quantity','alert_interval_minutes','invoice_title','invoice_terms','invoice_show_logo','website','business_hours'];
    const preferences={};
    for(const key of preferenceKeys) if(values[key]!==undefined){preferences[key]=values[key];delete values[key];}
    const Media=require('../models/Media');
    if(Media.idFromUrl(values.logo_url)) await Media.reference(connection,values.logo_url,'logo');
    await connection.query('UPDATE pharmacy_settings SET ?,version=version+1 WHERE id=1', [values]);
    if(Object.keys(preferences).length) await connection.query('UPDATE pharmacy_preferences SET ? WHERE id=1',[preferences]);
    await audit(connection, user, 'CHANGED_SETTINGS', 'Settings', 1, 'Updated pharmacy profile and system settings.');
  });
  return Settings.get();
};
exports.audit = audit;
