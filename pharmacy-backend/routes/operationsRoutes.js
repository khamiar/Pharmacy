const express = require('express');
const authenticate = require('../middleware/authMiddleware');
const {
  authorize
} = require('../config/permissions');
const c = require('../controllers/operationsController');
exports.customers = express.Router().use(authenticate, authorize('customers')).get('/', c.customers).get('/:id/history', c.history).get('/:id', c.customer).post('/', authorize('customers:write'), c.saveCustomer).put('/:id', authorize('customers:write'), c.saveCustomer);
exports.prescriptions = express.Router().use(authenticate, authorize('prescriptions')).get('/', c.prescriptions).get('/:id', c.prescription).post('/', authorize('prescriptions:write'), c.savePrescription).put('/:id', authorize('prescriptions:write'), c.savePrescription).patch('/:id/cancel', authorize('prescriptions:write'), c.cancelPrescription);
exports.settings = express.Router().use(authenticate).get('/profile', c.profile).use(authorize('settings')).get('/', c.settings).put('/', c.saveSettings);
exports.notifications = express.Router().use(authenticate, authorize('notifications')).get('/', c.notifications).post('/read', c.readNotification);
exports.audit = express.Router().use(authenticate, authorize('settings')).get('/', c.audit);
