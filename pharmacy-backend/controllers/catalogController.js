const Catalog = require('../models/Catalog');
const service = require('../services/catalogService');
const validate = require('../validators/catalog');
const wrap = handler => async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    await handler(req, res);
  } catch (error) {
    next(error);
  }
};
exports.forResource = resource => ({
  list: wrap(async (req, res) => res.json({
    data: await Catalog.list(resource, validate.filters(req.query, resource))
  })),
  detail: wrap(async (req, res) => res.json({
    data: await service.find(resource, validate.integer(req.params.id, 'ID', 1))
  })),
  create: wrap(async (req, res) => res.status(201).json({
    data: await service.save(resource, validate.body(req.body, resource), req.user.id, undefined, req.user.role)
  })),
  update: wrap(async (req, res) => res.json({
    data: await service.save(resource, validate.body(req.body, resource, true), req.user.id, validate.integer(req.params.id, 'ID', 1))
  })),
  status: active => wrap(async (req, res) => {
    if (!req.body || Object.keys(req.body).some(key => key !== 'version')) validate.fail('Only the record version may be submitted for this action.');
    res.json({
      data: await service.changeStatus(resource, validate.integer(req.params.id, 'ID', 1), validate.integer(req.body.version, 'Version', 1), active, req.user.id)
    });
  })
});
exports.options = wrap(async (req, res) => res.json({
  data: {
    categories: await Catalog.options(),
    medicineTypes: validate.types,
    defaults: await require("../models/Settings").profile()
  }
}));
