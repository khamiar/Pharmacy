const pool = require('../config/db');
const today = 'DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 HOUR))';
exports.list = async filters => {
  const conditions = [], values = [];
  if (filters.search) { conditions.push('(m.name LIKE ? OR m.barcode LIKE ?)'); values.push(`%${filters.search}%`, `%${filters.search}%`); }
  if (filters.category) { conditions.push('m.category_id = ?'); values.push(filters.category); }
  if (filters.supplier) {
    conditions.push('EXISTS (SELECT 1 FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id WHERE pi.medicine_id = m.id AND p.supplier_id = ?)');
    values.push(filters.supplier);
  }
  const aggregate = `LEFT JOIN (SELECT medicine_id, SUM(quantity) quantity,
    SUM(CASE WHEN expiry_date < ${today} THEN quantity ELSE 0 END) expired_quantity,
    MIN(CASE WHEN quantity > 0 THEN expiry_date END) next_expiry
    FROM medicine_batches GROUP BY medicine_id) b ON b.medicine_id = m.id`;
  const quantity = 'COALESCE(b.quantity, 0)';
  if (filters.stock) conditions.push({ in: `${quantity} > m.minimum_stock`, low: `${quantity} > 0 AND ${quantity} <= m.minimum_stock`, out: `${quantity} = 0` }[filters.stock]);
  if (filters.expiry) {
    conditions.push(`EXISTS (SELECT 1 FROM medicine_batches eb WHERE eb.medicine_id = m.id AND eb.quantity > 0 AND ${filters.expiry === 'expired' ? `eb.expiry_date < ${today}` : `eb.expiry_date BETWEEN ${today} AND DATE_ADD(${today}, INTERVAL ? DAY)`})`);
    if (filters.expiry !== 'expired') values.push(Number(filters.expiry));
  }
  const where = `WHERE m.status = 'ACTIVE'${conditions.length ? ' AND ' + conditions.join(' AND ') : ''}`;
  const from = `FROM medicines m ${aggregate} ${where}`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total ${from}`, values);
  const [items] = await pool.query(`SELECT m.id, m.name, m.barcode, m.minimum_stock,
    (SELECT name FROM categories WHERE id = m.category_id) category_name,
    ${quantity} quantity, COALESCE(b.expired_quantity, 0) expired_quantity,
    ${quantity} - COALESCE(b.expired_quantity, 0) usable_quantity,
    DATE_FORMAT(b.next_expiry, '%Y-%m-%d') next_expiry ${from}
    ORDER BY m.name, m.id LIMIT ? OFFSET ?`, [...values, filters.limit, (filters.page - 1) * filters.limit]);
  return { items, pagination: { total, page: filters.page, pages: Math.max(1, Math.ceil(total / filters.limit)) } };
};
exports.movements = async filters => {
  const conditions = [], values = [];
  if (filters.search) { conditions.push('(m.name LIKE ? OR sm.reference LIKE ? OR b.batch_number LIKE ?)'); values.push(...Array(3).fill(`%${filters.search}%`)); }
  if (filters.type) { conditions.push('sm.type = ?'); values.push(filters.type); }
  const from = `FROM stock_movements sm JOIN medicines m ON m.id = sm.medicine_id
    JOIN medicine_batches b ON b.id = sm.batch_id JOIN users u ON u.id = sm.created_by
    ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total ${from}`, values);
  const [items] = await pool.query(`SELECT sm.*, m.name medicine_name, b.batch_number, u.full_name staff ${from}
    ORDER BY sm.created_at DESC, sm.id DESC LIMIT ? OFFSET ?`, [...values, filters.limit, (filters.page - 1) * filters.limit]);
  return { items, pagination: { total, page: filters.page, pages: Math.max(1, Math.ceil(total / filters.limit)) } };
};
exports.options = async () => {
  const [categories] = await pool.query('SELECT id, name FROM categories ORDER BY name');
  const [suppliers] = await pool.query('SELECT id, name FROM suppliers ORDER BY name');
  return { categories, suppliers };
};
exports.batches = async id => {
  const [rows] = await pool.query("SELECT id, batch_number, quantity, DATE_FORMAT(expiry_date, '%Y-%m-%d') expiry_date FROM medicine_batches WHERE medicine_id = ? ORDER BY expiry_date, id", [id]);
  return rows;
};
