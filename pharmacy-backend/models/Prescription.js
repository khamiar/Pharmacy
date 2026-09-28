const pool = require('../config/db');
exports.list = async f => {
  const where = ['p.prescription_number LIKE ?'],
    values = [`%${f.search}%`];
  if (f.status) {
    where.push('p.status=?');
    values.push(f.status);
  }
  const clause = where.join(' AND ');
  const [[{
    total
  }]] = await pool.query('SELECT COUNT(*) total FROM prescriptions p WHERE ' + clause, values);
  // General lists intentionally omit patient names, notes and medical instructions.
  const [items] = await pool.query("SELECT p.id,p.prescription_number,p.customer_id,DATE_FORMAT(p.prescription_date,'%Y-%m-%d') prescription_date,p.status,p.version FROM prescriptions p WHERE " + clause + ' ORDER BY p.id DESC LIMIT ? OFFSET ?', [...values, f.limit, (f.page - 1) * f.limit]);
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
  const [[row]] = await pool.query("SELECT p.id,p.prescription_number,p.customer_id,c.full_name customer_name,p.doctor,DATE_FORMAT(p.prescription_date,'%Y-%m-%d') prescription_date,p.notes,p.status,p.version FROM prescriptions p JOIN customers c ON c.id=p.customer_id WHERE p.id=?", [id]);
  if (!row) return null;
  const [items] = await pool.query('SELECT i.*,m.name medicine_name,m.selling_price, (SELECT COALESCE(SUM(b.quantity),0) FROM medicine_batches b WHERE b.medicine_id=i.medicine_id AND b.expiry_date>=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 3 HOUR))) usable_quantity FROM prescription_items i JOIN medicines m ON m.id=i.medicine_id WHERE prescription_id=? ORDER BY i.id', [id]);
  const [sales] = await pool.query('SELECT s.id,s.invoice_number,s.total_amount FROM sale_details d JOIN sales s ON s.id=d.sale_id WHERE d.prescription_id=? ORDER BY s.id DESC', [id]);
  return {
    ...row,
    items,
    sales
  };
};
