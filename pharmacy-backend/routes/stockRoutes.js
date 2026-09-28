const router = require('express').Router();
const controller = require('../controllers/stockController');
router.use(require('../middleware/authMiddleware'), require('../config/permissions').authorize('stock'));
router.get('/', controller.list);
router.get('/options', controller.options);
router.get('/movements', controller.movements);
router.get('/:id/batches', controller.batches);
module.exports = router;
