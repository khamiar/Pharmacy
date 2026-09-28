const router = require('express').Router();
const authenticate = require('../middleware/authMiddleware');
const { authorize } = require('../config/permissions');
const controller = require('../controllers/userController');
router.use(authenticate, authorize('users'));
router.get('/', controller.list);
for (const action of ['approve', 'reject', 'suspend', 'activate', 'role']) router.patch(`/:id/${action}`, controller.change(action));
module.exports = router;
