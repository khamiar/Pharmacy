const pool = require("../config/db");

const UserModel = {
  async findByEmail(email) {
    const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [
      email,
    ]);
    return rows[0] || null;
  },

  async findById(id) {
    const [rows] = await pool.query(
      "SELECT id, full_name, email, phone, role, created_at FROM users WHERE id = ?",
      [id]
    );
    return rows[0] || null;
  },

  async create({ fullName, email, phone, hashedPassword, role = "staff" }) {
    const [result] = await pool.query(
      "INSERT INTO users (full_name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)",
      [fullName, email, phone, hashedPassword, role]
    );
    return result.insertId;
  },
};

module.exports = UserModel;
