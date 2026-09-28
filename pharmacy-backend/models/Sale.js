const pool = require('../config/db');
const { fail } = require('../validators/catalog');
exports.byRequest = async key => {
  const [[row]] = await pool.query('SELECT id, request_hash, created_by FROM sales WHERE request_key = ?', [key]);
  return row;
};
exports.find = async id => {
  const [[row]] = await pool.query("SELECT s.id, s.invoice_number, s.customer_name, DATE_FORMAT(s.sale_date,'%Y-%m-%d') sale_date, s.subtotal, s.discount, s.total_amount, s.amount_paid, s.change_amount, s.payment_method, s.payment_status, u.full_name staff FROM sales s JOIN users u ON u.id=s.created_by WHERE s.id=?", [id]);
  if (!row) fail('Sale not found.', 404);
  const [items] = await pool.query('SELECT medicine_name, batch_number, quantity, unit_price, subtotal FROM sale_items WHERE sale_id=? ORDER BY id', [id]);
  const [[details]]=await pool.query('SELECT customer_id,prescription_id,pharmacy_profile FROM sale_details WHERE sale_id=?',[id]);
  const profile=typeof details?.pharmacy_profile==='string'?JSON.parse(details.pharmacy_profile):details?.pharmacy_profile;
  return { ...row, items, customer_id:details?.customer_id||null, prescription_id:details?.prescription_id||null, pharmacy_profile:profile||null };
};
exports.list = async f => {
  const where = ['1=1'], values = [];
  if (f.search) { where.push('(s.invoice_number LIKE ? OR s.customer_name LIKE ?)'); values.push(...Array(2).fill(`%${f.search}%`)); }
  if (f.from) { where.push('s.sale_date >= ?'); values.push(f.from); }
  if (f.to) { where.push('s.sale_date <= ?'); values.push(f.to); }
  const clause = where.join(' AND ');
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total FROM sales s WHERE ${clause}`, values);
  const [items] = await pool.query(`SELECT s.id, s.invoice_number, s.customer_name, DATE_FORMAT(s.sale_date,'%Y-%m-%d') sale_date, s.total_amount, s.payment_status, u.full_name staff FROM sales s JOIN users u ON u.id=s.created_by WHERE ${clause} ORDER BY s.id DESC LIMIT ? OFFSET ?`, [...values, f.limit, (f.page-1)*f.limit]);
  return { items, pagination: { total, page: f.page, pages: Math.max(1, Math.ceil(total/f.limit)) } };
};
exports.medicines = async search => {
  const [rows] = await pool.query(`SELECT m.id,m.name,m.barcode,m.selling_price, COALESCE(SUM(CASE WHEN b.expiry_date >= DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 HOUR)) THEN b.quantity ELSE 0 END),0) usable_quantity
    FROM medicines m LEFT JOIN medicine_batches b ON b.medicine_id=m.id WHERE m.status='ACTIVE' AND (m.name LIKE ? OR m.barcode LIKE ?) GROUP BY m.id HAVING usable_quantity > 0 ORDER BY m.name,m.id LIMIT 30`, [`%${search}%`, `%${search}%`]);
  return rows;
};
exports.summary = async () => {
  const [points] = await pool.query("SELECT DATE_FORMAT(sale_date,'%Y-%m-%d') date,SUM(total_amount) amount FROM sales WHERE sale_date BETWEEN DATE_SUB(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 HOUR)), INTERVAL 29 DAY) AND DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 HOUR)) GROUP BY sale_date ORDER BY sale_date");
  const [[row]] = await pool.query("SELECT COALESCE(SUM(total_amount),0) total FROM sales WHERE sale_date=DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 HOUR))");
  const recent = await exports.list({ page:1,limit:8 });
  return { total: row.total, points, items: recent.items.map(item => ({ id:item.id,invoice:item.invoice_number,customer:item.customer_name || 'Walk-in',amount:item.total_amount,paymentStatus:item.payment_status,date:item.sale_date,staff:item.staff })) };
};
