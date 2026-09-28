const pool = require('../config/db');
const {
  permissionsFor
} = require('../config/permissions');
const Settings = require('./Settings');
exports.list = async (user, f = {}) => {
  const settings = await Settings.get();
  const permissions = permissionsFor(user.role),
    items = [];
  if (permissions.includes('stock') || permissions.includes('medicines')) {

    const [stock] = await pool.query("SELECT m.id,m.name,m.minimum_stock,COALESCE(SUM(CASE WHEN b.expiry_date>=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 3 HOUR)) THEN b.quantity ELSE 0 END),0) quantity FROM medicines m LEFT JOIN medicine_batches b ON b.medicine_id=m.id WHERE m.status='ACTIVE' GROUP BY m.id HAVING quantity<=GREATEST(m.minimum_stock,?) ORDER BY quantity,m.id LIMIT 100",[settings.alert_stock_quantity]);
    for (const row of stock) items.push({
      key: `stock-${row.id}-${row.quantity}-${row.minimum_stock}`,
      type: Number(row.quantity) ? 'LOW_STOCK' : 'OUT_OF_STOCK',
      title: row.name,
      message: `${row.quantity} usable units in stock; minimum ${row.minimum_stock}.`,
      path: permissions.includes('stock') ? '/stock' : '/medicines'
    });
    const [batches] = await pool.query("SELECT b.id,m.name,b.batch_number,b.quantity,DATE_FORMAT(b.expiry_date,'%Y-%m-%d') expiry_date,b.expiry_date<DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 3 HOUR)) expired FROM medicine_batches b JOIN medicines m ON m.id=b.medicine_id WHERE b.quantity>0 AND b.expiry_date<=DATE_ADD(DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 3 HOUR)),INTERVAL ? DAY) ORDER BY b.expiry_date,b.id LIMIT 100", [Math.max(settings.expiry_warning_days,settings.alert_expiry_days)]);
    for (const row of batches) items.push({
      key: `expiry-${row.id}-${row.expiry_date}-${row.expired}`,
      type: row.expired ? 'EXPIRED' : 'EXPIRING',
      title: row.name,
      message: `Batch ${row.batch_number}: ${row.quantity} units, expiry ${row.expiry_date}.`,
      path: permissions.includes('stock') ? '/stock' : '/medicines'
    });
  }
  if (permissions.includes('purchases')) {
    const [rows] = await pool.query('SELECT id,purchase_number,created_at FROM purchases ORDER BY id DESC LIMIT 30');
    for (const row of rows) items.push({
      key: 'purchase-' + row.id,
      type: 'PURCHASE',
      title: 'Purchase completed',
      message: row.purchase_number,
      path: '/purchases',
      date: row.created_at
    });
  }
  if (permissions.includes('users')) {
    const [rows] = await pool.query("SELECT u.id,u.full_name FROM users u JOIN user_access a ON a.user_id=u.id WHERE a.status='PENDING' ORDER BY u.id DESC LIMIT 30");
    for (const row of rows) items.push({
      key: 'approval-' + row.id,
      type: 'APPROVAL',
      title: 'Staff approval required',
      message: row.full_name,
      path: '/users'
    });
    const [events] = await pool.query("SELECT id,action,entity,created_at FROM audit_logs ORDER BY id DESC LIMIT 30");
    for (const row of events) items.push({
      key: 'audit-' + row.id,
      type: 'SYSTEM',
      title: row.action.replaceAll('_', ' '),
      message: row.entity,
      path: '/settings',
      date: row.created_at
    });
  }
  const keys = items.map(item => item.key);
  const [reads] = keys.length ? await pool.query('SELECT notification_key FROM notification_reads WHERE user_id=? AND notification_key IN (?)', [user.id, keys]) : [[]];
  const read = new Set(reads.map(row => row.notification_key));
  const all = items.map(item => ({
    ...item,
    read: read.has(item.key)
  }));
  const filtered = all.filter(item => (!f.type || item.type === f.type) && (!f.unread || !item.read));
  const page = f.page || 1,
    limit = f.limit || 10;
  const alerts={enabled:!!settings.alerts_enabled,intervalMinutes:settings.alert_interval_minutes,expiryDays:settings.alert_expiry_days,stockQuantity:settings.alert_stock_quantity,expiredBatches:0,expiringBatches:0,lowStockMedicines:0,outOfStockMedicines:0};
  if(permissions.includes('stock')||permissions.includes('medicines')){
    const [[stock]]=await pool.query("SELECT COALESCE(SUM(usable_quantity=0),0) outOfStockMedicines,COALESCE(SUM(usable_quantity>0 AND usable_quantity<=?),0) lowStockMedicines FROM (SELECT m.id,COALESCE(SUM(CASE WHEN b.expiry_date>=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 3 HOUR)) THEN b.quantity ELSE 0 END),0) usable_quantity FROM medicines m LEFT JOIN medicine_batches b ON b.medicine_id=m.id WHERE m.status='ACTIVE' GROUP BY m.id) inventory",[settings.alert_stock_quantity]);
    const [[expiry]]=await pool.query("SELECT COALESCE(SUM(expiry_date<DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 3 HOUR))),0) expiredBatches,COALESCE(SUM(expiry_date BETWEEN DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 3 HOUR)) AND DATE_ADD(DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 3 HOUR)),INTERVAL ? DAY)),0) expiringBatches FROM medicine_batches WHERE quantity>0",[settings.alert_expiry_days]);
    for(const [key,value] of Object.entries({...stock,...expiry}))alerts[key]=Number(value);
  }
  return {
    alerts,
    items: filtered.slice((page - 1) * limit, page * limit),
    unread: all.filter(item => !item.read).length,
    pagination: {
      total: filtered.length,
      page,
      pages: Math.max(1, Math.ceil(filtered.length / limit))
    }
  };
};
exports.read = async (user, key) => {
  // Only keys visible to the current role can be marked.
  const all = await exports.list(user, {
    limit: 1000
  });
  if (!all.items.some(item => item.key === key)) require('../validators/catalog').fail('Notification is no longer available.', 404);
  await pool.query('INSERT IGNORE INTO notification_reads(user_id,notification_key) VALUES(?,?)', [user.id, key]);
  return {
    key,
    read: true
  };
};
