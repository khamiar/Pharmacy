const Stock = require('../models/Stock');
const validate = require('../validators/catalog');
const wrap = handler => async (req, res, next) => {
  try { res.set('Cache-Control', 'no-store'); res.json({ data: await handler(req) }); } catch (error) { next(error); }
};
exports.list = wrap(req => Stock.list({
  ...validate.filters(req.query, 'medicines'),
  supplier: req.query.supplier ? validate.integer(req.query.supplier, 'Supplier', 1) : null
}));
exports.movements = wrap(req => {
  const type = req.query.type || '';
  if (!['', 'PURCHASE', 'SALE', 'RETURN', 'ADJUSTMENT', 'DAMAGE', 'EXPIRED'].includes(type)) validate.fail('Invalid movement type.');
  return Stock.movements({ ...validate.filters(req.query, 'medicines'), type });
});
exports.options = wrap(() => Stock.options());
exports.batches = wrap(req => Stock.batches(validate.integer(req.params.id, 'Medicine', 1)));
