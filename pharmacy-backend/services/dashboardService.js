const { permissionsFor } = require('../config/permissions');

// Only implemented modules provide statistics; future modules remain explicitly unavailable.
const metrics = {
  totalMedicines: 'medicines', lowStockMedicines: 'stock', expiredMedicines: 'stock',
  totalSuppliers: 'suppliers', todaySales: 'sales', todayPurchases: 'purchases',
  totalCustomers: 'customers', pendingPrescriptions: 'prescriptions',
};

async function getDashboard(user, model) {
  const permissions = permissionsFor(user.role);
  const available = (module) => ({
    status: permissions.includes(module) ? 'not_configured' : 'restricted',
  });
  const stats = Object.fromEntries(Object.entries(metrics).map(([key, module]) => [
    key, { value: null, ...available(module) },
  ]));
  const summary = permissions.includes('medicines') || permissions.includes('stock') ? await model.catalogSummary() : null;
  if (permissions.includes('medicines')) stats.totalMedicines = { value: summary.totalMedicines, status: 'ready' };
  if (permissions.includes('stock')) {
    stats.lowStockMedicines = { value: summary.lowStockMedicines, status: 'ready' };
    stats.expiredMedicines = { value: summary.expiredMedicines, status: 'ready' };
  }
  if (permissions.includes('suppliers') || permissions.includes('purchases')) {
    const purchasing = await model.purchasingSummary();
    if (permissions.includes('suppliers')) stats.totalSuppliers = { status: 'ready', value: Number(purchasing.totalSuppliers) };
    if (permissions.includes('purchases')) stats.todayPurchases = { status: 'ready', value: purchasing.todayPurchases };
  }
  if(permissions.includes('customers') || permissions.includes('prescriptions')){
    const operations=await model.operationsSummary();
    if(permissions.includes('customers')) stats.totalCustomers={status:'ready',value:Number(operations.totalCustomers)};
    if(permissions.includes('prescriptions')) stats.pendingPrescriptions={status:'ready',value:Number(operations.pendingPrescriptions)};
  }
  const sales = permissions.includes('sales') ? await model.salesSummary() : null;
  if (sales) stats.todaySales = { status: 'ready', value: sales.total };
  const stockOverview = permissions.includes('stock')
    ? { status: 'ready', inStock: summary.inStock, lowStock: summary.lowStockMedicines - summary.outOfStock, outOfStock: summary.outOfStock, expiringSoon: summary.expiringSoon, expiryWarningDays:summary.expiryWarningDays }
    : { status: 'restricted', inStock: null, lowStock: null, outOfStock: null, expiringSoon: null };
  const lowStockMedicines = permissions.includes('stock') ? { status: 'ready', items: await model.lowStockMedicines() } : { status: 'restricted', items: [] };
  const recentActivities = permissions.includes('users')
    ? { status: 'ready', items: await model.recentRegistrations() }
    : { status: 'restricted', items: [] };
  const notifications=permissions.includes('notifications') ? await model.notifications(user) : null;
  return {
    generatedAt: new Date().toISOString(), currency: 'TZS', timezone: 'Africa/Dar_es_Salaam',
    permissions, stats,
    salesOverview: sales ? { status: 'ready', points: sales.points } : { ...available('sales'), points: [] },
    stockOverview,
    recentSales: sales ? { status: 'ready', items: sales.items } : { ...available('sales'), items: [] },
    lowStockMedicines,
    recentActivities,
    notifications: notifications ? {status:'ready',items:notifications.items,unread:notifications.unread} : {status:'restricted',items:[]},
  };
}
module.exports = { getDashboard };
