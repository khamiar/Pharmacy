const Sale = require('../models/Sale');
const validate = require('../validators/sales');
const { integer, text } = require('../validators/catalog');
const wrap = (handler, status=200) => async (req,res,next) => { try { res.set('Cache-Control','no-store'); res.status(status).json({ data: await handler(req) }); } catch(error) { next(error); } };
exports.list = wrap(req => Sale.list(validate.filters(req.query)));
exports.find = wrap(req => Sale.find(integer(req.params.id,'Sale',1)));
exports.medicines = wrap(req => Sale.medicines(text(req.query.search || '', 'Search',150) || ''));
exports.create = wrap(req => require('../services/saleService').complete(validate.body(req.body),req.user.id,req.user.role),201);

exports.invoice = async (req,res,next) => {
  try {
    const {buffer,filename}=await require('../services/invoiceService').generate(integer(req.params.id,'Sale',1));
    res.set({'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="'+filename+'"','Cache-Control':'no-store'}).send(buffer);
  } catch(error){next(error);}
};
