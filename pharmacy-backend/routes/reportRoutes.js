const router = require('express').Router();
router.use(require('../middleware/authMiddleware'),require('../config/permissions').authorize('reports'));
router.get('/',require('../controllers/reportController').list);
module.exports = router;
