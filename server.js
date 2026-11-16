const dns = require('dns');
// Fallback DNS resolvers for reliable MongoDB Atlas SRV connection
try {
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
} catch (_) {}

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const paymentRoutes = require('./src/routes/paymentRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Security Middlewares
app.use(cors());
// Preserve rawBody for accurate cryptographic webhook signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// 1. Root Endpoint (Independent of DB / Razorpay)
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'PATHORA Backend is running',
    status: 'healthy',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// 2. Health Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'healthy',
    service: 'PATHORA Backend',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// 3. Payment & Monetization Routes
app.use('/api/payments', paymentRoutes);

async function startServer() {
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    try {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
      console.log('Connected to MongoDB Atlas successfully.');
    } catch (err) {
      console.warn('MongoDB Atlas connection notice:', err.message);
    }
  } else {
    console.warn('Notice: MONGODB_URI environment variable not configured.');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PATHORA Monetization Backend running on port ${PORT}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = app;
