const pool = require('../config/db');
module.exports = {
  async list(filters) {
    const conditions = [];
    const values = [];
    if (filters.search) {
      conditions.push('(name LIKE ? OR company LIKE ? OR phone LIKE ? OR email LIKE ?)');
      values.push(...Array(4).fill(`%${filters.search}%`));
    }
    if (filters.status) {
      conditions.push('status = ?');
      values.push(filters.status);
    }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const [[{
      total
    }]] = await pool.query(`SELECT COUNT(*) AS total FROM suppliers${where}`, values);
    const [items] = await pool.query(`SELECT * FROM suppliers${where} ORDER BY name, id LIMIT ? OFFSET ?`, [...values, filters.limit, (filters.page - 1) * filters.limit]);
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
    const [[supplier]] = await pool.query('SELECT * FROM suppliers WHERE id = ?', [id]);
    if (!supplier) return null;
    const [[summary]] = await pool.query('SELECT COUNT(*) AS purchase_count, COALESCE(SUM(total_amount),0) AS total_purchases, COALESCE(SUM(total_amount - amount_paid),0) AS outstanding_balance FROM purchases WHERE supplier_id = ?', [id]);
    const [purchases] = await pool.query("SELECT id, purchase_number, DATE_FORMAT(purchase_date, '%Y-%m-%d') AS purchase_date, total_amount, payment_status FROM purchases WHERE supplier_id = ? ORDER BY purchase_date DESC, id DESC LIMIT 8", [id]);
    const [medicines] = await pool.query('SELECT m.id, m.name, SUM(pi.quantity) AS received_quantity FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id JOIN medicines m ON m.id = pi.medicine_id WHERE p.supplier_id = ? GROUP BY m.id, m.name ORDER BY m.name LIMIT 100', [id]);
    return {
      ...supplier,
      ...summary,
      recent_purchases: purchases,
      supplied_medicines: medicines
    };
  },
  async lock(connection, id) {
    const [[row]] = await connection.query('SELECT * FROM suppliers WHERE id = ? FOR UPDATE', [id]);
    return row;
  },
  async create(connection, data) {
    const [result] = await connection.query('INSERT INTO suppliers SET ?', [data]);
    return result.insertId;
  },
  async update(connection, id, data) {
    await connection.query('UPDATE suppliers SET ?, version = version + 1 WHERE id = ?', [data, id]);
  }
};
