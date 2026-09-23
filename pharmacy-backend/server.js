require("dotenv").config();
const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/authRoutes");

const app = express();

// Middleware
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
  })
);
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/dashboard", require("./routes/dashboardRoutes"));

app.use('/api/medicines', require('./routes/catalogRoutes')('medicines'));
app.use('/api/categories', require('./routes/catalogRoutes')('categories'));

app.use('/api/suppliers', require('./routes/supplierRoutes'));
app.use('/api/purchases', require('./routes/purchaseRoutes'));

// Health check
app.get("/", (req, res) => {
  res.send("Pharmacy System API is running successfully.");
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: "Route not found." });
});

app.use(require("./middleware/errorHandler"));

const PORT = process.env.PORT || 5000;
if (require.main === module) app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

module.exports = app;
