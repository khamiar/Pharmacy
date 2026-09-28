const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const UserModel = require("../models/User");
const { permissionsFor } = require("../config/permissions");

const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
};

// @route POST /api/auth/register
exports.register = async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ message: 'A JSON object is required.' });
    const { password } = req.body;
    const fullName = typeof req.body.fullName === 'string' ? req.body.fullName.trim() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';

    if (!fullName || !email || !phone || !password) {
      return res.status(400).json({ message: "Please fill in all fields." });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150 ||
        fullName.length > 150 || phone.length > 30 || typeof password !== 'string' ||
        password.length < 6 || Buffer.byteLength(password, 'utf8') > 72) {
      return res.status(400).json({ message: 'Use a valid email, a name up to 150 characters, a phone up to 30 characters, and a password of at least 6 characters (maximum 72 bytes).' });
    }
    const existingUser = await UserModel.findByEmail(email);
    if (existingUser) {
      return res
        .status(409)
        .json({ message: existingUser.status === 'PENDING' ? 'This email is already registered and is awaiting administrator approval.' : 'This email is already registered. Sign in with your existing password.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const userId = await UserModel.create({
      fullName,
      email,
      phone,
      hashedPassword,
    });

    const user = await UserModel.findById(userId);

    return res.status(201).json({
      message: "Registration submitted. An administrator must approve your account before you can sign in.",
      user,
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'This email is already registered. Sign in with your existing password.' });
    }
    if (err.code === 'ER_NO_SUCH_TABLE') return res.status(503).json({ message: 'Staff approval setup is not complete yet. Please contact the pharmacy owner before registering.' });
    console.error('Register error:', err.code || err.name);
    return res.status(500).json({ message: "Server error. Try again." });
  }
};

// @route POST /api/auth/login
exports.login = async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ message: 'A JSON object is required.' });
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const { password } = req.body;

    if (!email || typeof password !== 'string' || !password) {
      return res
        .status(400)
        .json({ message: "Please fill in all fields." });
    }

    const user = await UserModel.findByEmail(email);
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    if (user.status !== 'ACTIVE') {
      const messages = {
        PENDING: 'Your registration is awaiting administrator approval.',
        REJECTED: 'Your registration was not approved. Contact your administrator.',
        SUSPENDED: 'Your account is suspended. Contact your administrator.',
      };
      return res.status(403).json({ message: messages[user.status] || 'Your account requires administrator approval.', code: 'ACCOUNT_INACTIVE' });
    }
    const token = generateToken(user);

    // Don't send the password hash back to the client
    delete user.password;

    return res.status(200).json({
      message: "Login successful.",
      token,
      user,
    });
  } catch (err) {
    console.error('Login error:', err.code || err.name);
    return res.status(500).json({ message: "Server error. Try again." });
  }
};

// @route GET /api/auth/me  (protected)
exports.getProfile = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    res.set("Cache-Control", "no-store");
    return res.status(200).json({ user, permissions: permissionsFor(user.role) });
  } catch (err) {
    console.error("Get profile error:", err);
    return res.status(500).json({ message: "Server error. Try again." });
  }
};
