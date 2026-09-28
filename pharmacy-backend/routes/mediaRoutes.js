const router = require('express').Router();
const Media = require('../models/Media');
router.post('/', require('../middleware/authMiddleware'), require('express').json({
  limit: '3mb'
}), async (req, res, next) => {
  try {
    res.status(201).json({
      data: await Media.save(req.body, req.user)
    });
  } catch (error) {
    next(error);
  }
});
// Immutable product/logo images have unguessable URLs and contain re-encoded pixels only.
router.get('/:id', async (req, res, next) => {
  try {
    if (!Media.idFromUrl('/api/media/' + req.params.id)) return res.sendStatus(404);
    const image = await Media.find(req.params.id);
    if (!image) return res.sendStatus(404);
    res.set({
      'Content-Type': image.content_type,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Security-Policy': "default-src 'none'"
    }).send(image.content);
  } catch (error) {
    next(error);
  }
});
module.exports = router;
