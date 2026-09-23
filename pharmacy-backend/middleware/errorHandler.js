module.exports = (error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Request body must be valid JSON.' });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Request body is too large.' });
  }
  if ([400, 404, 409].includes(error.status)) return res.status(error.status).json({ message: error.message });
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'This category name or medicine barcode is already in use. Use a unique value.' });
  if (error.code === 'ER_NO_REFERENCED_ROW_2') return res.status(409).json({ message: 'A referenced record is no longer available. Reload and try again.' });
  if (error.code === 'ER_NO_SUCH_TABLE') return res.status(503).json({ message: 'The catalog database needs setup. Run npm run migrate in pharmacy-backend.' });
  console.error('API request failed:', error.code || error.name);
  res.status(500).json({ message: 'Unable to complete the request. Please try again.' });
};
