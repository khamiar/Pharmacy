const Supplier = require('../models/Supplier');
const Purchase = require('../models/Purchase');
const suppliers = require('../services/supplierService');
const purchases = require('../services/purchaseService');
const validate = require('../validators/purchasing');
const {
  integer,
  text
} = require('../validators/catalog');
const wrap = handler => async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    await handler(req, res);
  } catch (error) {
    next(error);
  }
};
exports.supplierList = wrap(async (req, res) => res.json({
  data: await Supplier.list(validate.filters(req.query, 'suppliers'))
}));
exports.supplierDetail = wrap(async (req, res) => res.json({
  data: await suppliers.find(integer(req.params.id, 'Supplier ID', 1))
}));
exports.supplierCreate = wrap(async (req, res) => res.status(201).json({
  data: await suppliers.save(validate.supplier(req.body), req.user.id)
}));
exports.supplierUpdate = wrap(async (req, res) => res.json({
  data: await suppliers.save(validate.supplier(req.body, true), req.user.id, integer(req.params.id, 'Supplier ID', 1))
}));
exports.supplierStatus = active => wrap(async (req, res) => {
  validate.object(req.body, ['version']);
  res.json({
    data: await suppliers.status(integer(req.params.id, 'Supplier ID', 1), integer(req.body.version, 'Version', 1), active, req.user.id)
  });
});
exports.purchaseList = wrap(async (req, res) => res.json({
  data: await Purchase.list(validate.filters(req.query, 'purchases'))
}));
exports.purchaseDetail = wrap(async (req, res) => res.json({
  data: await purchases.find(integer(req.params.id, 'Purchase ID', 1))
}));
exports.purchaseCreate = wrap(async (req, res) => {
  const result = await purchases.complete(validate.purchase(req.body), req.user.id);
  res.status(result.replayed ? 200 : 201).json(result);
});
exports.purchaseMedicines = wrap(async (req, res) => res.json({
  data: await Purchase.medicineOptions(text(req.query.search || '', 'Search', 150) || '')
}));
