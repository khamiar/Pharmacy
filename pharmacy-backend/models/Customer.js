const pool = require('../config/db');
exports.list = async f => {
  const values = [`%${f.search}%`, `%${f.search}%`, `%${f.search}%`];
  const where = 'WHERE full_name LIKE ? OR phone LIKE ? OR email LIKE ?';
  const [[{
    total
  }]] = await pool.query('SELECT COUNT(*) total FROM customers ' + where, values);
  const [items] = await pool.query('SELECT id,full_name,phone,email,version FROM customers ' + where + ' ORDER BY full_name,id LIMIT ? OFFSET ?', [...values, f.limit, (f.page - 1) * f.limit]);
  return {
    items,
    pagination: {
      total,
      page: f.page,
      pages: Math.max(1, Math.ceil(total / f.limit))
    }
  };
};
exports.find = async id => {
  const [[row]] = await pool.query("SELECT id,full_name,phone,email,address,DATE_FORMAT(date_of_birth,'%Y-%m-%d') date_of_birth,notes,version FROM customers WHERE id=?", [id]);
  return row;
};
exports.history = async (id, f) => {
  const [[{
    total
  }]] = await pool.query('SELECT COUNT(*) total FROM sale_details WHERE customer_id=?', [id]);
  const [items] = await pool.query("SELECT s.id,s.invoice_number,DATE_FORMAT(s.sale_date,'%Y-%m-%d') date,s.total_amount,s.payment_status FROM sale_details d JOIN sales s ON s.id=d.sale_id WHERE d.customer_id=? ORDER BY s.id DESC LIMIT ? OFFSET ?", [id, f.limit, (f.page - 1) * f.limit]);
  return {
    items,
    pagination: {
      total,
      page: f.page,
      pages: Math.max(1, Math.ceil(total / f.limit))
    }
  };
};
