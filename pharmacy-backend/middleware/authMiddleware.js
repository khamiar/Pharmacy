const jwt = require('jsonwebtoken');
const UserModel = require('../models/User');

module.exports = async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided. Please login first.' });
  }
  let decoded;
  try {
    decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ message: 'Token is invalid or has expired.' });
  }
  try {
    // Load the current account so deleted accounts and changed roles take effect immediately.
    const user = await UserModel.findById(decoded.id);
    if (!user) return res.status(401).json({ message: 'Your account is no longer available.' });
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};
