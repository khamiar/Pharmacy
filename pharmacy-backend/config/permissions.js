// Preserve existing database roles. Legacy `staff` has assistant permissions.
const roles = {
  admin: ['dashboard', 'medicines', 'categories', 'suppliers', 'purchases', 'stock', 'sales', 'customers', 'prescriptions', 'users', 'reports', 'notifications', 'settings'],
  pharmacist: ['dashboard', 'medicines', 'categories', 'prescriptions', 'sales', 'customers', 'stock', 'notifications'],
  staff: ['dashboard', 'medicines', 'categories', 'sales', 'customers', 'notifications'],
  pharmacy_assistant: ['dashboard', 'medicines', 'categories', 'sales', 'customers', 'notifications'],
  cashier: ['dashboard', 'sales', 'customers', 'notifications'],
  store_keeper: ['dashboard', 'stock', 'purchases', 'suppliers', 'notifications'],
};
const actions = {
  admin: ['suppliers:write', 'suppliers:archive', 'purchases:write', 'medicines:write', 'medicines:archive', 'categories:write', 'categories:archive'],
  store_keeper: ['suppliers:write', 'suppliers:archive', 'purchases:write'],
  pharmacist: ['medicines:write', 'medicines:archive', 'categories:write', 'categories:archive'],
  staff: ['medicines:write'],
  pharmacy_assistant: ['medicines:write'],
};
const permissionsFor = (role) => {
  const key = String(role).toLowerCase();
  return Object.hasOwn(roles, key) ? [...roles[key], ...(Object.hasOwn(actions, key) ? actions[key] : [])] : [];
};
const authorize = (permission) => (req, res, next) => {
  if (!permissionsFor(req.user?.role).includes(permission)) {
    return res.status(403).json({ message: 'You do not have permission to access this module.' });
  }
  next();
};
module.exports = { permissionsFor, authorize };
