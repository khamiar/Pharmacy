const express = require('express');
const authenticate = require('../middleware/authMiddleware');
const {
  authorize
} = require('../config/permissions');
const controller = require('../controllers/catalogController');
module.exports = function catalogRoutes(resource) {
  const router = express.Router();
  const handlers = controller.forResource(resource);
  router.use(authenticate, authorize(resource));
  if (resource === 'medicines') router.get('/options', controller.options);
  router.get('/', handlers.list);
  router.get('/:id', handlers.detail);
  router.post('/', authorize(`${resource}:write`), handlers.create);
  router.put('/:id', authorize(`${resource}:write`), handlers.update);
  router.patch(`/:id/${resource === 'medicines' ? 'archive' : 'deactivate'}`, authorize(`${resource}:archive`), handlers.status(false));
  router.patch(`/:id/${resource === 'medicines' ? 'restore' : 'activate'}`, authorize(`${resource}:archive`), handlers.status(true));
  return router;
};
