const validate = require('../validators/operations');
const {
  integer,
  text,
  fail
} = require('../validators/catalog');
const {
  object
} = require('../validators/purchasing');
const service = require('../services/operationsService');
const Customer = require('../models/Customer'),
  Prescription = require('../models/Prescription'),
  Settings = require('../models/Settings'),
  Notification = require('../models/Notification');
const pool = require('../config/db');
const wrap = (handler, status = 200) => async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.status(typeof status === "function" ? status(req) : status).json({
      data: await handler(req)
    });
  } catch (error) {
    next(error);
  }
};
exports.customers = wrap(req => Customer.list(validate.page(req.query)));
exports.customer = wrap(async req => {
  const row = await Customer.find(integer(req.params.id, 'Customer', 1));
  if (!row) fail('Customer not found.', 404);
  return row;
});
exports.history = wrap(req => Customer.history(integer(req.params.id, 'Customer', 1), validate.page(req.query)));
exports.saveCustomer = wrap(req => service.customer(validate.customer(req.body, !!req.params.id), req.user.id, req.params.id ? integer(req.params.id, 'Customer', 1) : undefined), req => req.params.id ? 200 : 201);
exports.prescriptions = wrap(req => {
  const status = req.query.status || '';
  if (!['', 'PENDING', 'DISPENSED', 'PARTIALLY_DISPENSED', 'CANCELLED'].includes(status)) fail('Invalid prescription status.');
  return Prescription.list({
    ...validate.page(req.query),
    status
  });
});
exports.prescription = wrap(async req => {
  const row = await Prescription.find(integer(req.params.id, 'Prescription', 1));
  if (!row) fail('Prescription not found.', 404);
  return row;
});
exports.savePrescription = wrap(async req => {
  try {
    return await service.prescription(validate.prescription(req.body, !!req.params.id), req.user.id, req.params.id ? integer(req.params.id, 'Prescription', 1) : undefined);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') fail('This prescription form was already submitted. Check the prescription list.', 409);
    throw error;
  }
}, req => req.params.id ? 200 : 201);
exports.cancelPrescription = wrap(req => {
  object(req.body, ['version']);
  return service.cancel(integer(req.params.id, 'Prescription', 1), integer(req.body.version, 'Version', 1), req.user.id);
});
exports.settings = wrap(() => Settings.get());
exports.profile = wrap(() => Settings.profile());
exports.saveSettings = wrap(req => service.settings(validate.settings(req.body), req.user.id));
exports.notifications = wrap(req => {
  const type = req.query.type || '';
  if (!['', 'LOW_STOCK', 'OUT_OF_STOCK', 'EXPIRED', 'EXPIRING', 'PURCHASE', 'APPROVAL', 'SYSTEM'].includes(type)) fail('Invalid notification type.');
  if (req.query.unread !== undefined && !['true', 'false'].includes(req.query.unread)) fail('Invalid unread filter.');
  return Notification.list(req.user, {
    ...validate.page(req.query),
    type,
    unread: req.query.unread === 'true'
  });
});
exports.readNotification = wrap(req => {
  object(req.body, ['key']);
  return Notification.read(req.user, text(req.body.key, 'Notification key', 160, true));
});
exports.audit = wrap(async req => {
  const f = validate.page(req.query),
    values = [`%${f.search}%`, `%${f.search}%`];
  const clause = 'WHERE a.action LIKE ? OR a.entity LIKE ?';
  const [[{
    total
  }]] = await pool.query('SELECT COUNT(*) total FROM audit_logs a ' + clause, values);
  const [items] = await pool.query('SELECT a.id,a.action,a.entity,a.entity_id,a.description,a.created_at,u.full_name staff FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ' + clause + ' ORDER BY a.id DESC LIMIT ? OFFSET ?', [...values, f.limit, (f.page - 1) * f.limit]);
  return {
    items,
    pagination: {
      total,
      page: f.page,
      pages: Math.max(1, Math.ceil(total / f.limit))
    }
  };
});
