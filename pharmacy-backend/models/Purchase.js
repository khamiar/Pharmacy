const pool = require('../config/db');
const select = `SELECT p.id, p.purchase_number, p.supplier_id, p.supplier_name,
  DATE_FORMAT(p.purchase_date, '%Y-%m-%d') AS purchase_date, p.invoice_number,
  p.payment_status, p.amount_paid, p.total_amount, p.notes, p.status, p.created_by,
  p.created_at, u.full_name AS staff FROM purchases p JOIN users u ON u.id = p.created_by`;
module.exports = {
  async list(filters) {
    const conditions = [];
    const values = [];
    if (filters.search) {
      conditions.push('(p.purchase_number LIKE ? OR p.invoice_number LIKE ? OR p.supplier_name LIKE ?)');
      values.push(...Array(3).fill(`%${filters.search}%`));
    }
    if (filters.payment_status) {
      conditions.push('p.payment_status = ?');
      values.push(filters.payment_status);
    }
    if (filters.supplier_id) {
      conditions.push('p.supplier_id = ?');
      values.push(filters.supplier_id);
    }
    if (filters.from) {
      conditions.push('p.purchase_date >= ?');
      values.push(filters.from);
    }
    if (filters.to) {
      conditions.push('p.purchase_date <= ?');
      values.push(filters.to);
    }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const [[{
      total
    }]] = await pool.query(`SELECT COUNT(*) AS total FROM purchases p${where}`, values);
    const [items] = await pool.query(`${select}${where} ORDER BY p.purchase_date DESC, p.id DESC LIMIT ? OFFSET ?`, [...values, filters.limit, (filters.page - 1) * filters.limit]);
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
  async find(id) {
    const [[purchase]] = await pool.query(`${select} WHERE p.id = ?`, [id]);
    if (!purchase) return null;
    const [items] = await pool.query("SELECT id, medicine_id, medicine_name, batch_id, batch_number, quantity, purchase_price, selling_price, DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry_date, subtotal FROM purchase_items WHERE purchase_id = ? ORDER BY id", [id]);
    const [movements] = await pool.query('SELECT sm.id, sm.medicine_id, sm.batch_id, sm.type, sm.quantity, sm.previous_stock, sm.new_stock, sm.reference, sm.reason, sm.created_at, u.full_name AS staff FROM stock_movements sm JOIN purchase_items pi ON pi.id = sm.purchase_item_id JOIN users u ON u.id = sm.created_by WHERE pi.purchase_id = ? ORDER BY sm.id', [id]);
    return {
      ...purchase,
      items,
      movements
    };
  },
  async byRequest(key, connection = pool) {
    const [[row]] = await connection.query('SELECT id, request_hash, created_by FROM purchases WHERE request_key = ?', [key]);
    return row;
  },
  async create(connection, data) {
    const [result] = await connection.query('INSERT INTO purchases SET ?', [data]);
    return result.insertId;
  },
  async createItem(connection, data) {
    const [result] = await connection.query('INSERT INTO purchase_items SET ?', [data]);
    return result.insertId;
  },
  async lockMedicine(connection, id) {
    const [[row]] = await connection.query('SELECT * FROM medicines WHERE id = ? FOR UPDATE', [id]);
    return row;
  },
  async stock(connection, id) {
    // Use a current locking read, not a repeatable-read snapshot taken before medicine locks.
    const [rows] = await connection.query('SELECT quantity FROM medicine_batches WHERE medicine_id = ? FOR UPDATE', [id]);
    return rows.reduce((total, row) => total + Number(row.quantity), 0);
  },
  async batch(connection, medicineId, batchNumber) {
    const [[row]] = await connection.query("SELECT id, quantity, purchase_price, DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry_date FROM medicine_batches WHERE medicine_id = ? AND batch_number = ? FOR UPDATE", [medicineId, batchNumber]);
    return row;
  },
  async createBatch(connection, data) {
    const [result] = await connection.query('INSERT INTO medicine_batches SET ?', [data]);
    return result.insertId;
  },
  async increaseBatch(connection, id, quantity) {
    await connection.query('UPDATE medicine_batches SET quantity = quantity + ? WHERE id = ?', [quantity, id]);
  },
  async updatePrices(connection, id, purchasePrice, sellingPrice, userId) {
    await connection.query('UPDATE medicines SET purchase_price = ?, selling_price = ?, updated_by = ?, version = version + 1 WHERE id = ?', [purchasePrice, sellingPrice, userId, id]);
  },
  async movement(connection, data) {
    await connection.query('INSERT INTO stock_movements SET ?', [data]);
  },
  async medicineOptions(search) {
    const [items] = await pool.query("SELECT id, name, barcode, purchase_price, selling_price FROM medicines WHERE status = 'ACTIVE' AND (name LIKE ? OR barcode LIKE ?) ORDER BY name, id LIMIT 30", [`%${search}%`, `%${search}%`]);
    return items;
  },
  async summary() {
    const [[row]] = await pool.query("SELECT (SELECT COUNT(*) FROM suppliers WHERE status = 'ACTIVE') AS totalSuppliers, COALESCE(SUM(total_amount),0) AS todayPurchases FROM purchases WHERE purchase_date = DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 HOUR))");
    return row;
  }
};
