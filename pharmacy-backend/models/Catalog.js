const pool = require('../config/db');
const today = 'DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 HOUR))';
const stockJoin = `LEFT JOIN (
  SELECT medicine_id, SUM(quantity) AS quantity,
    SUM(CASE WHEN expiry_date >= ${today} THEN quantity ELSE 0 END) AS usable_quantity,
    MIN(CASE WHEN quantity > 0 THEN expiry_date END) AS expiry_date
  FROM medicine_batches GROUP BY medicine_id
) b ON b.medicine_id = m.id`;
const medicineSelect = `SELECT m.*, (SELECT CONCAT('/api/media/',mi.image_id) FROM medicine_images mi WHERE mi.medicine_id=m.id) image_url, c.name AS category_name, COALESCE(b.quantity, 0) AS quantity,
  COALESCE(b.usable_quantity, 0) AS usable_quantity, DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry_date
  FROM medicines m LEFT JOIN categories c ON c.id = m.category_id ${stockJoin}`;
const categorySelect = `SELECT c.*, (SELECT COUNT(*) FROM medicines m WHERE m.category_id = c.id AND m.status = 'ACTIVE') AS medicine_count FROM categories c`;
function table(resource) {
  if (!['medicines', 'categories'].includes(resource)) throw new Error('Invalid catalog resource');
  return resource;
}
const Catalog = {
  async creationRequest(key) {
    const [[row]] = await pool.query('SELECT medicine_id, user_id, request_hash FROM medicine_creation_requests WHERE request_key = ?', [key]);
    return row;
  },
  async saveOpeningStock(connection, medicineId, stock, purchasePrice, userId, key, hash) {
    const [batch] = await connection.query('INSERT INTO medicine_batches SET ?', [{ medicine_id: medicineId, batch_number: stock.batch_number, expiry_date: stock.expiry_date, quantity: stock.quantity, purchase_price: purchasePrice }]);
    await connection.query('INSERT INTO stock_movements SET ?', [{ medicine_id: medicineId, batch_id: batch.insertId, type: 'ADJUSTMENT', quantity: stock.quantity, previous_stock: 0, new_stock: stock.quantity, reference: `OPENING-${medicineId}`, reason: 'Opening stock: existing shelf inventory recorded when medicine was created', created_by: userId }]);
    await connection.query('INSERT INTO medicine_creation_requests SET ?', [{ request_key: key, request_hash: hash, user_id: userId, medicine_id: medicineId }]);
    await connection.query("INSERT INTO audit_logs (user_id, action, entity, entity_id, description) VALUES (?, 'OPENING_STOCK', 'Medicine', ?, ?)", [userId, medicineId, JSON.stringify({ quantity: stock.quantity, batch_number: stock.batch_number, expiry_date: stock.expiry_date, reference: `OPENING-${medicineId}` })]);
  },
  async list(resource, filters) {
    const medicine = resource === 'medicines';
    const alias = medicine ? 'm' : 'c';
    const conditions = [];
    const values = [];
    if (filters.search) {
      conditions.push(medicine ? '(m.name LIKE ? OR m.generic_name LIKE ? OR m.brand_name LIKE ? OR m.barcode LIKE ?)' : 'c.name LIKE ?');
      values.push(...Array(medicine ? 4 : 1).fill(`%${filters.search}%`));
    }
    if (filters.status) {
      conditions.push(`${alias}.status = ?`);
      values.push(filters.status);
    }
    if (medicine && filters.category) {
      conditions.push('m.category_id = ?');
      values.push(filters.category);
    }
    if (medicine && filters.stock) conditions.push({
      low: 'COALESCE(b.quantity, 0) <= m.minimum_stock',
      out: 'COALESCE(b.quantity, 0) = 0',
      in: 'COALESCE(b.quantity, 0) > m.minimum_stock'
    }[filters.stock]);
    if (medicine && filters.expiry) {
      conditions.push(`EXISTS (SELECT 1 FROM medicine_batches eb WHERE eb.medicine_id = m.id AND eb.quantity > 0 AND ${filters.expiry === 'expired' ? `eb.expiry_date < ${today}` : `eb.expiry_date BETWEEN ${today} AND DATE_ADD(${today}, INTERVAL ? DAY)`})`);
      if (filters.expiry !== 'expired') values.push(Number(filters.expiry));
    }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const from = medicine ? `medicines m ${stockJoin}` : 'categories c';
    const [[{
      total
    }]] = await pool.query(`SELECT COUNT(*) AS total FROM ${from}${where}`, values);
    // sort and direction have been validated against an allowlist.
    const order = filters.sort === 'quantity' ? 'quantity' : `${alias}.${filters.sort}`;
    const [items] = await pool.query(`${medicine ? medicineSelect : categorySelect}${where} ORDER BY ${order} ${filters.direction}, ${alias}.id ASC LIMIT ? OFFSET ?`, [...values, filters.limit, (filters.page - 1) * filters.limit]);
    return {
      items,
      pagination: {
        total,
        page: filters.page,
        limit: filters.limit,
        pages: Math.max(1, Math.ceil(total / filters.limit))
      }
    };
  },
  async find(resource, id) {
    const [rows] = await pool.query(`${resource === 'medicines' ? medicineSelect : categorySelect} WHERE ${resource === 'medicines' ? 'm' : 'c'}.id = ?`, [id]);
    if (rows[0] && resource === 'medicines') {
      const [batches] = await pool.query("SELECT id, batch_number, DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry_date, quantity, purchase_price FROM medicine_batches WHERE medicine_id = ? ORDER BY expiry_date, id", [id]);
      rows[0].batches = batches;
      const [suppliers] = await pool.query('SELECT DISTINCT s.id, s.name FROM suppliers s JOIN purchases p ON p.supplier_id = s.id JOIN purchase_items pi ON pi.purchase_id = p.id WHERE pi.medicine_id = ? ORDER BY s.name', [id]);
      rows[0].suppliers = suppliers;
      const [opening] = await pool.query("SELECT sm.quantity, sm.previous_stock, sm.new_stock, sm.reference, sm.reason, sm.created_at, u.full_name AS staff FROM stock_movements sm JOIN users u ON u.id = sm.created_by WHERE sm.medicine_id = ? AND sm.reference = ? AND sm.type = 'ADJUSTMENT' ORDER BY sm.id", [id, `OPENING-${id}`]);
      rows[0].opening_stock_movements = opening;
    }
    return rows[0] || null;
  },
  async options() {
    const [categories] = await pool.query("SELECT id, name FROM categories WHERE status = 'ACTIVE' ORDER BY name, id");
    return categories;
  },
  async lock(connection, resource, id) {
    const [[row]] = await connection.query(`SELECT * FROM ${table(resource)} WHERE id = ? FOR UPDATE`, [id]);
    return row;
  },
  async create(connection, resource, data) {
    const [result] = await connection.query(`INSERT INTO ${table(resource)} SET ?`, [data]);
    return result.insertId;
  },
  async update(connection, resource, id, data) {
    await connection.query(`UPDATE ${table(resource)} SET ?, version = version + 1 WHERE id = ?`, [data, id]);
  },
  async hasStock(connection, id) {
    const [[row]] = await connection.query('SELECT COALESCE(SUM(quantity), 0) AS quantity FROM medicine_batches WHERE medicine_id = ?', [id]);
    return Number(row.quantity) > 0;
  },
  async hasActiveMedicines(connection, id) {
    const [[row]] = await connection.query("SELECT COUNT(*) AS total FROM medicines WHERE category_id = ? AND status = 'ACTIVE'", [id]);
    return row.total > 0;
  },
  async summary() {
    const settings=await require("./Settings").get();
    const [[row]] = await pool.query(`SELECT COUNT(*) AS totalMedicines,
      COALESCE(SUM(COALESCE(b.quantity, 0) <= m.minimum_stock), 0) AS lowStockMedicines,
      COALESCE(SUM(COALESCE(b.quantity, 0) > m.minimum_stock), 0) AS inStock,
      COALESCE(SUM(COALESCE(b.quantity, 0) = 0), 0) AS outOfStock,
      COALESCE(SUM(EXISTS(SELECT 1 FROM medicine_batches eb WHERE eb.medicine_id = m.id AND eb.quantity > 0 AND eb.expiry_date < ${today})), 0) AS expiredMedicines,
      COALESCE(SUM(EXISTS(SELECT 1 FROM medicine_batches eb WHERE eb.medicine_id = m.id AND eb.quantity > 0 AND eb.expiry_date BETWEEN ${today} AND DATE_ADD(${today}, INTERVAL ? DAY))), 0) AS expiringSoon
      FROM medicines m ${stockJoin} WHERE m.status = 'ACTIVE'`,[settings.expiry_warning_days]);
    return {...Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)])),expiryWarningDays:settings.expiry_warning_days};
  }
};
module.exports = Catalog;
