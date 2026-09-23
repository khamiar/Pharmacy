const pool = require('../config/db');
const Catalog = require('./Catalog');
module.exports = {
  purchasingSummary: () => require('./Purchase').summary(),
  catalogSummary: () => Catalog.summary(),
  async lowStockMedicines() {
    const { items } = await Catalog.list('medicines', { page: 1, limit: 8, sort: 'quantity', direction: 'asc', status: 'ACTIVE', stock: 'low' });
    return items.map(item => ({ id: item.id, medicine: item.name, category: item.category_name || 'Uncategorized', currentStock: Number(item.quantity), minimumStock: item.minimum_stock, status: Number(item.quantity) === 0 ? 'Out of stock' : 'Low stock' }));
  },
  async recentRegistrations() {
    const [rows] = await pool.query(
      'SELECT id, created_at FROM users ORDER BY created_at DESC, id DESC LIMIT 8'
    );
    return rows.map((row) => ({
      id: `user-${row.id}`, action: 'User registered', entity: 'User',
      entityId: row.id, occurredAt: row.created_at,
      description: 'A staff account was registered.',
    }));
  },
};
