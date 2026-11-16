const express = require('express');
const router = express.Router();
const { PRODUCTS } = require('../config/products');
const paymentService = require('../services/paymentService');

// 1. Get Product Catalog
router.get('/products', (req, res) => {
  res.json({
    success: true,
    currency: 'INR',
    products: PRODUCTS.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      price: p.price,
      currency: p.currency,
      type: p.type
    }))
  });
});

// 2. Create Razorpay Order
router.post('/create-order', async (req, res) => {
  try {
    const { userId, productId } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;

    const orderData = await paymentService.createOrder({
      userId,
      productId,
      ipAddress
    });

    res.json({
      success: true,
      order: orderData
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// 3. Verify Payment Signature & Fulfill Entitlement
router.post('/verify-payment', async (req, res) => {
  try {
    const { userId, orderId, paymentId, signature } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;

    const result = await paymentService.verifyPayment({
      userId,
      orderId,
      paymentId,
      signature,
      ipAddress
    });

    res.json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// 4. Synchronize User Entitlements
router.get('/entitlements/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const entitlements = await paymentService.getUserEntitlements(userId);
    res.json({
      success: true,
      entitlements
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// 5. Purchase History
router.get('/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const history = await paymentService.getPurchaseHistory(userId);
    res.json({
      success: true,
      history
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// 6. Razorpay Webhook Handler
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const webhookSignature = req.headers['x-razorpay-signature'];
    const ipAddress = req.ip || req.connection.remoteAddress;

    const result = await paymentService.processWebhook(
      req.rawBody || req.body,
      webhookSignature,
      ipAddress
    );

    res.json({ status: 'ok', ...result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;

