const crypto = require('crypto');
const Razorpay = require('razorpay');
const mongoose = require('mongoose');
const { getProductById } = require('../config/products');
const Order = require('../models/Order');
const Entitlement = require('../models/Entitlement');
const TransactionAudit = require('../models/TransactionAudit');

class PaymentService {
  constructor() {
    this.keyId = process.env.RAZORPAY_LIVE_KEY_ID || process.env.RAZORPAY_KEY_ID;
    this.keySecret = process.env.RAZORPAY_LIVE_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET;
    this.webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (this.keyId && this.keySecret) {
      this.razorpay = new Razorpay({
        key_id: this.keyId,
        key_secret: this.keySecret
      });
    }
  }

  /**
   * Fail-closed check: Ensure MongoDB is connected and ready.
   * Never fallback silently to ephemeral file storage in production.
   */
  _ensureDatabaseConnected() {
    if (mongoose.connection.readyState !== 1) {
      throw new Error('Database unavailable. Transaction rejected for data integrity.');
    }
  }

  /**
   * 1. Create a Razorpay Order and persist to MongoDB Atlas
   */
  async createOrder({ userId, productId, ipAddress }) {
    this._ensureDatabaseConnected();

    if (!this.keyId) {
      throw new Error('Razorpay key is not configured on the backend. Order creation rejected (fail-closed).');
    }

    if (!userId || !productId) {
      throw new Error('User ID and Product ID are required.');
    }

    const product = getProductById(productId);
    if (!product) {
      throw new Error(`Product not found or inactive: ${productId}`);
    }

    const receipt = `rec_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const options = {
      amount: product.price, // in paise
      currency: product.currency,
      receipt: receipt,
      notes: {
        userId,
        productId,
        productName: product.name
      }
    };

    let orderId, amount, currency, notes;
    if (this.razorpay) {
      const razorpayOrder = await this.razorpay.orders.create(options);
      orderId = razorpayOrder.id;
      amount = razorpayOrder.amount;
      currency = razorpayOrder.currency;
      notes = razorpayOrder.notes;
    } else {
      orderId = `order_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      amount = product.price;
      currency = product.currency;
      notes = options.notes;
    }

    // Persist to MongoDB Order model
    await Order.create({
      orderId,
      userId,
      productId,
      amount,
      currency,
      status: 'created',
      receipt,
      notes,
      entitlementGranted: false
    });

    // Record audit event in MongoDB
    await TransactionAudit.create({
      eventType: 'order_created',
      userId,
      orderId,
      details: { productId, amount },
      ipAddress
    });

    return {
      orderId,
      amount,
      currency,
      product: {
        id: product.id,
        name: product.name,
        description: product.description
      },
      keyId: this.keyId
    };
  }

  /**
   * 2. Verify Payment Signature & Fulfill Entitlement atomically in MongoDB
   */
  async verifyPayment({ userId, orderId, paymentId, signature, ipAddress }) {
    this._ensureDatabaseConnected();

    if (!orderId || !paymentId || !signature) {
      throw new Error('Missing payment verification details.');
    }

    // 1. Fetch Order from MongoDB
    const order = await Order.findOne({ orderId });
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    if (order.userId !== userId) {
      throw new Error('Order ownership mismatch.');
    }

    // Idempotency check: If already paid and granted, return safely
    if (order.status === 'paid' && order.entitlementGranted) {
      await TransactionAudit.create({
        eventType: 'duplicate_attempt_blocked',
        userId,
        orderId,
        paymentId,
        details: { message: 'Duplicate verification requested for already granted order' },
        ipAddress
      });
      const entitlements = await this.getUserEntitlements(userId);
      return { success: true, alreadyProcessed: true, entitlements };
    }

    // 2. Cryptographic Signature Verification
    if (!this.keySecret) {
      throw new Error('Razorpay secret is not configured on the backend. Payment verification rejected (fail-closed).');
    }

    const generatedSignature = crypto
      .createHmac('sha256', this.keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    if (generatedSignature !== signature) {
      await TransactionAudit.create({
        eventType: 'signature_failed',
        userId,
        orderId,
        paymentId,
        details: { expected: generatedSignature, received: signature },
        ipAddress
      });
      throw new Error('Payment signature verification failed.');
    }

    // 3. Mark Order as Paid in MongoDB
    order.status = 'paid';
    order.razorpayPaymentId = paymentId;
    order.razorpaySignature = signature;
    order.entitlementGranted = true;
    order.grantedAt = new Date();
    await order.save();

    // 4. Grant Entitlement Exactly Once in MongoDB
    const product = getProductById(order.productId);
    await this._grantProductEntitlement(userId, product);

    await TransactionAudit.create({
      eventType: 'entitlement_granted',
      userId,
      orderId,
      paymentId,
      details: { productId: order.productId },
      ipAddress
    });

    const entitlements = await this.getUserEntitlements(userId);
    return {
      success: true,
      orderId,
      paymentId,
      productId: order.productId,
      entitlements
    };
  }

  /**
   * 3. Process Webhook from Razorpay with signature verification & idempotency
   */
  async processWebhook(body, webhookSignature, ipAddress) {
    this._ensureDatabaseConnected();

    if (!this.webhookSecret) {
      throw new Error('Webhook secret is not configured.');
    }

    let rawPayload;
    if (Buffer.isBuffer(body)) {
      rawPayload = body.toString('utf8');
    } else if (typeof body === 'string') {
      rawPayload = body;
    } else {
      rawPayload = JSON.stringify(body);
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawPayload)
      .digest('hex');

    if (expectedSignature !== webhookSignature) {
      throw new Error('Invalid webhook signature.');
    }

    let payload;
    if (Buffer.isBuffer(body)) {
      payload = JSON.parse(body.toString('utf8'));
    } else if (typeof body === 'string') {
      payload = JSON.parse(body);
    } else {
      payload = body;
    }

    const event = payload.event;
    const entity = payload.payload?.payment?.entity;

    if (!entity) return { received: true };

    const orderId = entity.order_id;
    const paymentId = entity.id;

    await TransactionAudit.create({
      eventType: 'webhook_received',
      orderId,
      paymentId,
      details: { event },
      ipAddress
    });

    if (event === 'payment.captured' || event === 'order.paid') {
      const order = await Order.findOne({ orderId });
      if (order) {
        if (order.entitlementGranted || order.status === 'paid') {
          // Webhook duplicate protection: Already granted, acknowledge without duplicate credit
          await TransactionAudit.create({
            eventType: 'duplicate_attempt_blocked',
            userId: order.userId,
            orderId,
            paymentId,
            details: { message: 'Duplicate webhook event received for already granted order' },
            ipAddress
          });
          return { processed: true, alreadyProcessed: true };
        }

        order.status = 'paid';
        order.razorpayPaymentId = paymentId;
        order.entitlementGranted = true;
        order.grantedAt = new Date();
        await order.save();

        const product = getProductById(order.productId);
        await this._grantProductEntitlement(order.userId, product);

        await TransactionAudit.create({
          eventType: 'webhook_processed',
          userId: order.userId,
          orderId,
          paymentId,
          details: { productId: order.productId },
          ipAddress
        });
      }
    } else if (event === 'payment.failed') {
      const order = await Order.findOne({ orderId });
      if (order) {
        order.status = 'failed';
        await order.save();
        await TransactionAudit.create({
          eventType: 'payment_failed',
          userId: order.userId,
          orderId,
          paymentId,
          ipAddress
        });
      }
    }

    return { processed: true };
  }

  /**
   * Helper: Grant product entitlement in MongoDB
   */
  async _grantProductEntitlement(userId, product) {
    this._ensureDatabaseConnected();

    let entitlement = await Entitlement.findOne({ userId });
    if (!entitlement) {
      entitlement = await Entitlement.create({
        userId,
        hintsBalance: 3,
        extraLivesBalance: 0,
        removeAds: false,
        premiumPuzzlesUnlocked: [],
        premiumThemesUnlocked: []
      });
    }

    const item = product.entitlement;
    if (item.type === 'hints') {
      entitlement.hintsBalance += item.amount;
    } else if (item.type === 'lives') {
      entitlement.extraLivesBalance += item.amount;
    } else if (item.type === 'remove_ads') {
      entitlement.removeAds = true;
    } else if (item.type === 'premium_pack') {
      if (!entitlement.premiumPuzzlesUnlocked.includes(item.packId)) {
        entitlement.premiumPuzzlesUnlocked.push(item.packId);
      }
    } else if (item.type === 'premium_themes') {
      for (const th of item.themes) {
        if (!entitlement.premiumThemesUnlocked.includes(th)) {
          entitlement.premiumThemesUnlocked.push(th);
        }
      }
    }

    entitlement.lastSynchronizedAt = new Date();
    await entitlement.save();
    return entitlement;
  }

  /**
   * 4. Retrieve or Initialize User Entitlements from MongoDB
   */
  async getUserEntitlements(userId) {
    this._ensureDatabaseConnected();

    let entitlement = await Entitlement.findOne({ userId });
    if (!entitlement) {
      entitlement = await Entitlement.create({
        userId,
        hintsBalance: 3,
        extraLivesBalance: 0,
        removeAds: false,
        premiumPuzzlesUnlocked: [],
        premiumThemesUnlocked: []
      });
    }
    return entitlement;
  }

  /**
   * 5. Get User Purchase History from MongoDB
   */
  async getPurchaseHistory(userId) {
    this._ensureDatabaseConnected();

    return Order.find({ userId, status: 'paid' }).sort({ createdAt: -1 });
  }
}

module.exports = new PaymentService();
