const router = require('express').Router();
const authenticate = require('../middleware/authMiddleware');
const { authorize } = require('../config/permissions');
const { getDashboard } = require('../controllers/dashboardController');
router.get('/', authenticate, authorize('dashboard'), getDashboard);
module.exports = router;
