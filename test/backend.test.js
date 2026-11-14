require('dotenv').config();
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const paymentService = require('../src/services/paymentService');

async function runTests() {
  console.log('=== RUNNING BACKEND RAZORPAY MONETIZATION TESTS ===\n');
  let mongoServer;
  try {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
    console.log('Test MongoDB In-Memory Server connected.');

    // Fresh user ID to test brand new user lifecycle
    const userId = `user_test_${Date.now()}`;

    // TEST 1: Initial Entitlements
    console.log('\n--- TEST 1: Retrieve / Initialize User Entitlements ---');
    const initEnt = await paymentService.getUserEntitlements(userId);
    if (initEnt.hintsBalance !== 3) throw new Error(`Default hints should be 3, got ${initEnt.hintsBalance}`);
    if (initEnt.removeAds !== false) throw new Error(`Default removeAds should be false, got ${initEnt.removeAds}`);
    console.log('PASS: Initial entitlements verified (3 hints, false removeAds).');

    // TEST 2: Order Creation (5 Hints - ₹9)
    console.log('\n--- TEST 2: Order Creation ---');
    const orderData = await paymentService.createOrder({
      userId,
      productId: 'pathora_hints_5',
      ipAddress: '127.0.0.1'
    });
    if (!orderData.orderId.startsWith('order_')) throw new Error('Order ID should start with order_');
    if (orderData.amount !== 900) throw new Error(`Order amount should be 900 paise (₹9), got ${orderData.amount}`);
    console.log(`PASS: Order created successfully (${orderData.orderId}, ₹9).`);

    // TEST 3: Payment Signature Verification & Idempotent Entitlement
    console.log('\n--- TEST 3: Signature Verification & Single Entitlement Grant ---');
    const paymentId = `pay_test_${Date.now()}`;
    const validSignature = crypto
      .createHmac('sha256', paymentService.keySecret)
      .update(`${orderData.orderId}|${paymentId}`)
      .digest('hex');

    const verifyResult = await paymentService.verifyPayment({
      userId,
      orderId: orderData.orderId,
      paymentId,
      signature: validSignature,
      ipAddress: '127.0.0.1'
    });
    if (!verifyResult.success) throw new Error('Verification should succeed');
    if (verifyResult.entitlements.hintsBalance !== 8) {
      throw new Error(`Hints balance should now be 3 + 5 = 8, got ${verifyResult.entitlements.hintsBalance}`);
    }
    console.log('PASS: Valid signature verified and 5 hints credited (Total: 8).');

    // TEST 4: Duplicate Callback Replay Protection (Anti-Replay)
    console.log('\n--- TEST 4: Anti-Replay Duplicate Callback Protection ---');
    const replayResult = await paymentService.verifyPayment({
      userId,
      orderId: orderData.orderId,
      paymentId,
      signature: validSignature,
      ipAddress: '127.0.0.1'
    });
    if (!replayResult.alreadyProcessed) throw new Error('Duplicate request must report alreadyProcessed');
    if (replayResult.entitlements.hintsBalance !== 8) {
      throw new Error(`Hints balance must remain 8, never double-credited, got ${replayResult.entitlements.hintsBalance}`);
    }
    console.log('PASS: Duplicate callback safely handled without double crediting.');

    // TEST 5: Invalid Signature Tamper Rejection
    console.log('\n--- TEST 5: Tampered / Invalid Signature Rejection ---');
    const order2 = await paymentService.createOrder({
      userId,
      productId: 'pathora_premium_puzzles',
      ipAddress: '127.0.0.1'
    });

    let rejected = false;
    try {
      await paymentService.verifyPayment({
        userId,
        orderId: order2.orderId,
        paymentId: 'pay_fraud_9999',
        signature: 'invalid_fraudulent_signature_hex_123',
        ipAddress: '127.0.0.1'
      });
    } catch (e) {
      rejected = true;
      console.log(`Expected rejection caught: ${e.message}`);
    }
    if (!rejected) throw new Error('Tampered signature must be rejected');
    console.log('PASS: Invalid signature rejected cryptographically.');

    // TEST 6: Webhook Idempotency & Processing
    console.log('\n--- TEST 6: Webhook Processing & Idempotency ---');
    const webhookOrder = await paymentService.createOrder({
      userId,
      productId: 'pathora_premium_themes',
      ipAddress: '127.0.0.1'
    });

    const webhookPaymentId = `pay_webhook_${Date.now()}`;
    const webhookPayload = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: webhookPaymentId,
            order_id: webhookOrder.orderId,
            amount: 1900,
            status: 'captured'
          }
        }
      }
    };

    const webhookBodyStr = JSON.stringify(webhookPayload);
    const webhookSignature = crypto
      .createHmac('sha256', paymentService.webhookSecret)
      .update(webhookBodyStr)
      .digest('hex');

    const webhookRes = await paymentService.processWebhook(
      webhookBodyStr,
      webhookSignature,
      '127.0.0.1'
    );
    if (!webhookRes.processed) throw new Error('Webhook must be processed');

    const updatedEnt = await paymentService.getUserEntitlements(userId);
    if (!updatedEnt.premiumThemesUnlocked.includes('sunset')) {
      throw new Error('Sunset theme should be unlocked');
    }
    console.log('PASS: Webhook successfully unlocked Premium Themes.');

    // Duplicate webhook
    const replayWebhook = await paymentService.processWebhook(
      webhookBodyStr,
      webhookSignature,
      '127.0.0.1'
    );
    if (!replayWebhook.processed) throw new Error('Replay webhook must be acknowledged');
    console.log('PASS: Duplicate webhook processed idempotently without error.');

    console.log('\nALL 6 BACKEND TESTS PASSED SUCCESSFULLY! 🚀');
  } catch (error) {
    console.error('Test Suite Failed:', error);
    process.exit(1);
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  }
}

runTests();
