const pool = require('../config/db');
const { fail } = require('../validators/catalog');
exports.run = async (type, f) => {
  const date = (alias, column) => ({ sql: `${alias}.${column} BETWEEN ? AND ?`, values: [f.from, f.to] });
  const sales = date('s', 'sale_date'), purchases = date('p', 'purchase_date');
  const stock = `SELECT m.name medicine, COALESCE(c.name,'Uncategorized') category, COALESCE(SUM(b.quantity),0) quantity, m.minimum_stock,
    COALESCE(SUM(CASE WHEN b.expiry_date < DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 HOUR)) THEN b.quantity ELSE 0 END),0) expired_units
    FROM medicines m LEFT JOIN categories c ON c.id=m.category_id LEFT JOIN medicine_batches b ON b.medicine_id=m.id WHERE m.status='ACTIVE' GROUP BY m.id`;
  const queries = {
    transactions: { sql: `SELECT s.invoice_number reference, 'SALE' transaction_type,
      DATE_FORMAT(s.sale_date,'%Y-%m-%d') date, COALESCE(s.customer_name,'Walk-in') customer_or_supplier,
      s.total_amount, s.total_amount amount_paid, s.payment_status, u.full_name staff
      FROM sales s JOIN users u ON u.id=s.created_by WHERE ${sales.sql}
      UNION ALL
      SELECT p.purchase_number reference, 'PURCHASE' transaction_type,
      DATE_FORMAT(p.purchase_date,'%Y-%m-%d') date, p.supplier_name customer_or_supplier,
      p.total_amount, p.amount_paid, p.payment_status, u.full_name staff
      FROM purchases p JOIN users u ON u.id=p.created_by WHERE ${purchases.sql}`,
      values: [...sales.values,...purchases.values] },

    sales: { sql: `SELECT s.invoice_number, DATE_FORMAT(s.sale_date,'%Y-%m-%d') date, s.customer_name, s.subtotal,s.discount,s.total_amount,s.payment_method,u.full_name staff FROM sales s JOIN users u ON u.id=s.created_by WHERE ${sales.sql}`, values: sales.values },
    purchases: { sql: `SELECT p.purchase_number, DATE_FORMAT(p.purchase_date,'%Y-%m-%d') date,p.supplier_name,p.total_amount,p.amount_paid,p.payment_status FROM purchases p WHERE ${purchases.sql}`, values: purchases.values },
    stock: { sql: stock, values: [] },
    low_stock: { sql: stock + ' HAVING quantity <= m.minimum_stock', values: [] },
    expiry: { sql: `SELECT m.name medicine,b.batch_number,b.quantity,DATE_FORMAT(b.expiry_date,'%Y-%m-%d') expiry_date FROM medicine_batches b JOIN medicines m ON m.id=b.medicine_id WHERE b.quantity>0 AND b.expiry_date <= DATE_ADD(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 HOUR)), INTERVAL 90 DAY)`, values: [] },
    suppliers: { sql: `SELECT p.supplier_id, p.supplier_name,COUNT(*) purchases,SUM(p.total_amount) total_amount,SUM(p.total_amount-p.amount_paid) outstanding_balance FROM purchases p WHERE ${purchases.sql} GROUP BY p.supplier_id,p.supplier_name`, values: purchases.values },
    medicines: { sql: `SELECT si.medicine_id,si.medicine_name,SUM(si.quantity) quantity,SUM(si.subtotal) revenue_before_discount FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE ${sales.sql} GROUP BY si.medicine_id,si.medicine_name`, values: sales.values },
    profit: { sql: `SELECT COALESCE(SUM(s.total_amount),0) net_sales,COALESCE(SUM(cost.amount),0) cost_of_goods,COALESCE(SUM(s.total_amount-cost.amount),0) gross_profit FROM sales s JOIN (SELECT sale_id,SUM(quantity*unit_cost) amount FROM sale_items GROUP BY sale_id) cost ON cost.sale_id=s.id WHERE ${sales.sql}`, values: sales.values }
  };
  const query = Object.hasOwn(queries,type) ? queries[type] : null;
  if (!query) fail('Select a valid report.');
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total FROM (${query.sql}) report`, query.values);
  // Stable ordering across pages.
  const order = type === 'transactions' ? ' ORDER BY date DESC, transaction_type, reference' : ' ORDER BY 1';
  const [items] = await pool.query(query.sql + order + ' LIMIT ? OFFSET ?', [...query.values, f.limit, (f.page-1)*f.limit]);
  let summary;
  if (type === 'transactions') {
    const [rows] = await pool.query(`SELECT transaction_type, COUNT(*) records, COALESCE(SUM(total_amount),0) total_amount FROM (${query.sql}) transactions GROUP BY transaction_type`, query.values);
    summary = { sales: { records: 0, total_amount: '0.00' }, purchases: { records: 0, total_amount: '0.00' } };
    for (const row of rows) summary[row.transaction_type === 'SALE' ? 'sales' : 'purchases'] = { records: row.records, total_amount: row.total_amount };
  }
  return { items, ...(summary ? { summary } : {}), pagination: { total, page: f.page, pages: Math.max(1, Math.ceil(total/f.limit)) }, from: f.from, to: f.to };
};
