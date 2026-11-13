const crypto = require('crypto');
const Razorpay = require('razorpay');
const { getProductById } = require('../config/products');
const fileDB = require('../models/FileDB');

class PaymentService {
  constructor() {
    this.keyId = process.env.RAZORPAY_KEY_ID;
    this.keySecret = process.env.RAZORPAY_KEY_SECRET;
    this.webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (this.keyId && this.keySecret) {
      this.razorpay = new Razorpay({
        key_id: this.keyId,
        key_secret: this.keySecret
      });
    }
  }

  /**
   * 1. Create a Razorpay Order
   */
  async createOrder({ userId, productId, ipAddress }) {
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

    await fileDB.saveOrder({
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

    await fileDB.logAudit({
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
   * 2. Verify Payment Signature & Fulfill Entitlement
   */
  async verifyPayment({ userId, orderId, paymentId, signature, ipAddress }) {
    if (!orderId || !paymentId || !signature) {
      throw new Error('Missing payment verification details.');
    }

    // 1. Fetch Order
    const order = await fileDB.findOrder(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    if (order.userId !== userId) {
      throw new Error('Order ownership mismatch.');
    }

    // Idempotency check: If already paid and granted, return safely
    if (order.status === 'paid' && order.entitlementGranted) {
      await fileDB.logAudit({
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
    const generatedSignature = crypto
      .createHmac('sha256', this.keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    if (generatedSignature !== signature) {
      await fileDB.logAudit({
        eventType: 'signature_failed',
        userId,
        orderId,
        paymentId,
        details: { expected: generatedSignature, received: signature },
        ipAddress
      });
      throw new Error('Payment signature verification failed.');
    }

    // 3. Mark Order as Paid
    order.status = 'paid';
    order.razorpayPaymentId = paymentId;
    order.razorpaySignature = signature;
    order.entitlementGranted = true;
    order.grantedAt = new Date();
    await fileDB.saveOrder(order);

    // 4. Grant Entitlement Exactly Once
    const product = getProductById(order.productId);
    await this._grantProductEntitlement(userId, product);

    await fileDB.logAudit({
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
   * 3. Process Webhook from Razorpay
   */
  async processWebhook(body, webhookSignature, ipAddress) {
    if (!this.webhookSecret) {
      throw new Error('Webhook secret is not configured.');
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(typeof body === 'string' ? body : JSON.stringify(body))
      .digest('hex');

    if (expectedSignature !== webhookSignature) {
      throw new Error('Invalid webhook signature.');
    }

    const payload = typeof body === 'string' ? JSON.parse(body) : body;
    const event = payload.event;
    const entity = payload.payload?.payment?.entity;

    if (!entity) return { received: true };

    const orderId = entity.order_id;
    const paymentId = entity.id;

    await fileDB.logAudit({
      eventType: 'webhook_received',
      orderId,
      paymentId,
      details: { event },
      ipAddress
    });

    if (event === 'payment.captured' || event === 'order.paid') {
      const order = await fileDB.findOrder(orderId);
      if (order && !order.entitlementGranted) {
        order.status = 'paid';
        order.razorpayPaymentId = paymentId;
        order.entitlementGranted = true;
        order.grantedAt = new Date();
        await fileDB.saveOrder(order);

        const product = getProductById(order.productId);
        await this._grantProductEntitlement(order.userId, product);

        await fileDB.logAudit({
          eventType: 'webhook_processed',
          userId: order.userId,
          orderId,
          paymentId,
          details: { productId: order.productId },
          ipAddress
        });
      }
    } else if (event === 'payment.failed') {
      const order = await fileDB.findOrder(orderId);
      if (order) {
        order.status = 'failed';
        await fileDB.saveOrder(order);
        await fileDB.logAudit({
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
   * Helper: Grant product entitlement in DB
   */
  async _grantProductEntitlement(userId, product) {
    let entitlement = await fileDB.findEntitlement(userId);
    if (!entitlement) {
      entitlement = {
        userId,
        hintsBalance: 3,
        extraLivesBalance: 0,
        removeAds: false,
        premiumPuzzlesUnlocked: [],
        premiumThemesUnlocked: []
      };
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
    await fileDB.saveEntitlement(entitlement);
  }

  /**
   * 4. Retrieve or Initialize User Entitlements
   */
  async getUserEntitlements(userId) {
    let entitlement = await fileDB.findEntitlement(userId);
    if (!entitlement) {
      entitlement = await fileDB.saveEntitlement({
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
   * 5. Get User Purchase History
   */
  async getPurchaseHistory(userId) {
    return fileDB.getOrderHistory(userId);
  }
}

module.exports = new PaymentService();
