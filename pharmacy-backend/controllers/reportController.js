exports.list = async (req,res,next) => {
  try {
    const { today, filters } = require('../validators/purchasing');
    const parsed = filters({ ...req.query, from: req.query.from || today(), to: req.query.to || today() }, 'reports');
    res.set('Cache-Control','no-store');
    res.json({ data: await require('../models/Report').run(req.query.type || 'transactions',parsed) });
  } catch(error) { next(error); }
};
