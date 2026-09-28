const pool = require('../config/db');
const transaction = require('../utilities/transaction');
const publicFields = `u.id, u.full_name, u.email, u.phone, u.role, u.created_at,
  COALESCE(a.status, 'PENDING') AS status, COALESCE(a.version, 1) AS version,
  a.reviewed_by, a.reviewed_at`;
const from = 'FROM users u LEFT JOIN user_access a ON a.user_id = u.id';
// During a staged upgrade, preserve access for existing accounts until the approval
// migration is installed. Registration still fails atomically without the new tables.
async function findAccount(where, values, withPassword = false) {
  try {
    const [rows] = await pool.query(`SELECT ${publicFields}${withPassword ? ', u.password' : ''} ${from} WHERE ${where}`, values);
    return rows[0] || null;
  } catch (error) {
    if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
    const [rows] = await pool.query(`SELECT u.id, u.full_name, u.email, u.phone, u.role, u.created_at${withPassword ? ', u.password' : ''}, 'ACTIVE' AS status, 1 AS version FROM users u WHERE ${where}`, values);
    return rows[0] ? { ...rows[0], approval_setup_required: true } : null;
  }
}
const UserModel = {
  async findByEmail(email) {
    return findAccount('u.email = ?', [email], true);
  },
  async findById(id) {
    return findAccount('u.id = ?', [id]);
  },
  async create({ fullName, email, phone, hashedPassword }) {
    return transaction(async connection => {
      const [result] = await connection.query("INSERT INTO users (full_name, email, phone, password, role) VALUES (?, ?, ?, ?, 'staff')", [fullName, email, phone, hashedPassword]);
      await connection.query("INSERT INTO user_access (user_id, status) VALUES (?, 'PENDING')", [result.insertId]);
      await connection.query("INSERT INTO audit_logs (user_id, action, entity, entity_id, description) VALUES (?, 'STAFF_REGISTERED', 'User', ?, 'Staff account registered; awaiting administrator approval.')", [result.insertId, result.insertId]);
      return result.insertId;
    });
  },
  async list({ search, status, role, page, limit }) {
    const conditions = []; const values = [];
    if (search) { conditions.push('(u.full_name LIKE ? OR u.email LIKE ?)'); values.push(`%${search}%`, `%${search}%`); }
    if (status) { conditions.push("COALESCE(a.status, 'PENDING') = ?"); values.push(status); }
    if (role) { conditions.push('u.role = ?'); values.push(role); }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from}${where}`, values);
    const [items] = await pool.query(`SELECT ${publicFields} ${from}${where} ORDER BY (COALESCE(a.status, 'PENDING') = 'PENDING') DESC, u.created_at DESC, u.id DESC LIMIT ? OFFSET ?`, [...values, limit, (page - 1) * limit]);
    return { items, pagination: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) } };
  },
  async administrationLock(connection) {
    const [rows] = await connection.query('SELECT id FROM administration_lock WHERE id = 1 FOR UPDATE');
    if (rows.length !== 1) throw new Error('Administration lock is not initialized');
  },
  async lock(connection, id) {
    const [[user]] = await connection.query(`SELECT ${publicFields} ${from} WHERE u.id = ? FOR UPDATE`, [id]);
    return user;
  },
  async activeAdmins(connection) {
    const [[row]] = await connection.query("SELECT COUNT(*) AS total FROM users u JOIN user_access a ON a.user_id = u.id WHERE u.role = 'admin' AND a.status = 'ACTIVE'");
    return Number(row.total);
  },
  async updateAccess(connection, id, { role, status, actorId }) {
    await connection.query('UPDATE users SET role = ? WHERE id = ?', [role, id]);
    await connection.query('INSERT INTO user_access (user_id, status, version, reviewed_by, reviewed_at) VALUES (?, ?, 2, ?, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE status = VALUES(status), version = version + 1, reviewed_by = VALUES(reviewed_by), reviewed_at = CURRENT_TIMESTAMP', [id, status, actorId]);
  },
  async audit(connection, actorId, id, action, before, after) {
    await connection.query("INSERT INTO audit_logs (user_id, action, entity, entity_id, description) VALUES (?, ?, 'User', ?, ?)", [actorId, action, id, JSON.stringify({ before: { role: before.role, status: before.status }, after: { role: after.role, status: after.status } })]);
  },
};
module.exports = UserModel;
