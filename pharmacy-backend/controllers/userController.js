const User = require('../models/User');
const { changeAccess } = require('../services/userService');
const { integer, text, fail } = require('../validators/catalog');
const roles = ['staff', 'pharmacist', 'admin'];
const statuses = ['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED'];
const wrap = handler => async (req, res, next) => {
  try { res.set('Cache-Control', 'no-store'); await handler(req, res); } catch (error) { next(error); }
};
exports.list = wrap(async (req, res) => {
  const status = req.query.status || ''; const role = req.query.role || '';
  if (status && !statuses.includes(status)) fail('Invalid approval status.');
  if (role && !roles.includes(role)) fail('Invalid role.');
  res.json({ data: await User.list({ status, role, search: text(req.query.search || '', 'Search', 150) || '', page: integer(req.query.page || 1, 'Page', 1, 1000000), limit: integer(req.query.limit || 10, 'Page size', 1, 100) }) });
});
exports.change = action => wrap(async (req, res) => {
  const allowed = action === 'role' ? ['version', 'role'] : ['version'];
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some(key => !allowed.includes(key))) fail('Invalid staff action fields.');
  if (action === 'role' && !roles.includes(req.body.role)) fail('Select a valid staff role.');
  res.json({ data: await changeAccess(req.user.id, integer(req.params.id, 'User ID', 1), integer(req.body.version, 'Version', 1), action, req.body.role) });
});
