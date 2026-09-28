const pool = require('../config/db');
exports.get = async (connection = pool) => {
  const [[row]] = await connection.query('SELECT s.*,p.alerts_enabled,p.alert_expiry_days,p.alert_stock_quantity,p.alert_interval_minutes,p.invoice_title,p.invoice_terms,p.invoice_show_logo,p.website,p.business_hours FROM pharmacy_settings s JOIN pharmacy_preferences p ON p.id=s.id WHERE s.id=1');
  return row;
};
exports.profile = async () => {
  const {
    id,
    version,
    ...profile
  } = await exports.get();
  return profile;
};
