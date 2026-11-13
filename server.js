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
app.use(express.json());

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
    status: 'healthy'
  });
});

// 2. Health Endpoint (Independent of DB / Razorpay)
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'healthy',
    service: 'PATHORA Backend'
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
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PATHORA Monetization Backend running on port ${PORT}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = app;
