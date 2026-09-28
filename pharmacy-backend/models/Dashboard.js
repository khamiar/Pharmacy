const pool = require('../config/db');
const Catalog = require('./Catalog');
module.exports = {
  notifications: user => require('./Notification').list(user,{limit:5}),
  async operationsSummary() {
    const [[row]]=await pool.query("SELECT (SELECT COUNT(*) FROM customers) totalCustomers,(SELECT COUNT(*) FROM prescriptions WHERE status IN ('PENDING','PARTIALLY_DISPENSED')) pendingPrescriptions");
    return row;
  },
  salesSummary: () => require('./Sale').summary(),
  purchasingSummary: () => require('./Purchase').summary(),
  catalogSummary: () => Catalog.summary(),
  async lowStockMedicines() {
    const { items } = await Catalog.list('medicines', { page: 1, limit: 8, sort: 'quantity', direction: 'asc', status: 'ACTIVE', stock: 'low' });
    return items.map(item => ({ id: item.id, medicine: item.name, category: item.category_name || 'Uncategorized', currentStock: Number(item.quantity), minimumStock: item.minimum_stock, status: Number(item.quantity) === 0 ? 'Out of stock' : 'Low stock' }));
  },
  async recentRegistrations() {
    const [rows]=await pool.query('SELECT id,action,entity,entity_id,created_at FROM audit_logs ORDER BY id DESC LIMIT 8');
    return rows.map(row=>({id:'audit-'+row.id,action:row.action.replaceAll('_',' '),entity:row.entity,entityId:row.entity_id,occurredAt:row.created_at,description:row.entity+' record updated.'}));
  },
};
