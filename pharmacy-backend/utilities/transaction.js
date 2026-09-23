const pool = require('../config/db');
const { fail } = require('../validators/catalog');
module.exports = async function transaction(operation) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) {
      fail('Another operation changed these records. Please retry.', 409);
    }
    throw error;
  } finally { connection.release(); }
};
