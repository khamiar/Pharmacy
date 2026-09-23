const Dashboard = require('../models/Dashboard');
const { getDashboard } = require('../services/dashboardService');
exports.getDashboard = async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ data: await getDashboard(req.user, Dashboard) });
  } catch (error) { next(error); }
};
