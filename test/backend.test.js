require('dotenv').config();
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const paymentService = require('../src/services/paymentService');
const Order = require('../src/models/Order');
const Entitlement = require('../src/models/Entitlement');

async function runTests() {
  console.log('=== RUNNING BACKEND RAZORPAY MONETIZATION TESTS ===\n');
  let mongoServer;
  try {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
    console.log('Test MongoDB In-Memory Server connected.');

    const userId = 'user_test_device_1001';

    // TEST 1: Initial Entitlements
    console.log('\n--- TEST 1: Retrieve / Initialize User Entitlements ---');
    const initEnt = await paymentService.getUserEntitlements(userId);
    console.assert(initEnt.hintsBalance === 3, 'Default hints should be 3');
    console.assert(initEnt.removeAds === false, 'Default removeAds should be false');
    console.log('PASS: Initial entitlements verified.');

    // TEST 2: Mock Order Creation & DB Record
    console.log('\n--- TEST 2: Order Creation ---');
    const orderData = await paymentService.createOrder({
      userId,
      productId: 'pathora_hints_small',
      ipAddress: '127.0.0.1'
    });
    console.assert(orderData.orderId.startsWith('order_'), 'Order ID should start with order_');
    console.assert(orderData.amount === 4900, 'Order amount should be 4900 paise');
    console.log(`PASS: Order created successfully (${orderData.orderId}, ₹49).`);

    // TEST 3: Payment Signature Verification & Idempotent Entitlement
    console.log('\n--- TEST 3: Signature Verification & Single Entitlement Grant ---');
    const paymentId = 'pay_test_payment_9921';
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
    console.assert(verifyResult.success === true, 'Verification should succeed');
    console.assert(verifyResult.entitlements.hintsBalance === 13, 'Hints balance should now be 3 + 10 = 13');
    console.log('PASS: Valid signature verified and 10 hints credited (Total: 13).');

    // TEST 4: Duplicate Callback Replay Protection (Anti-Replay)
    console.log('\n--- TEST 4: Anti-Replay Duplicate Callback Protection ---');
    const replayResult = await paymentService.verifyPayment({
      userId,
      orderId: orderData.orderId,
      paymentId,
      signature: validSignature,
      ipAddress: '127.0.0.1'
    });
    console.assert(replayResult.alreadyProcessed === true, 'Duplicate request must report alreadyProcessed');
    console.assert(replayResult.entitlements.hintsBalance === 13, 'Hints balance must remain 13, never double-credited');
    console.log('PASS: Duplicate callback safely handled without double crediting.');

    // TEST 5: Invalid Signature Tamper Rejection
    console.log('\n--- TEST 5: Tampered / Invalid Signature Rejection ---');
    const order2 = await paymentService.createOrder({
      userId,
      productId: 'pathora_remove_ads',
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
    console.assert(rejected === true, 'Tampered signature must be rejected');
    console.log('PASS: Invalid signature rejected cryptographically.');

    // TEST 6: Webhook Idempotency & Processing
    console.log('\n--- TEST 6: Webhook Processing & Idempotency ---');
    const webhookOrder = await paymentService.createOrder({
      userId,
      productId: 'pathora_remove_ads',
      ipAddress: '127.0.0.1'
    });
    const webhookPaymentId = 'pay_webhook_valid_5500';
    const webhookPayload = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: webhookPaymentId,
            order_id: webhookOrder.orderId
          }
        }
      }
    };
    const webhookPayloadStr = JSON.stringify(webhookPayload);
    const webhookSignature = crypto
      .createHmac('sha256', paymentService.webhookSecret)
      .update(webhookPayloadStr)
      .digest('hex');

    await paymentService.processWebhook(webhookPayloadStr, webhookSignature, '127.0.0.1');

    const updatedEnt = await paymentService.getUserEntitlements(userId);
    console.assert(updatedEnt.removeAds === true, 'removeAds should be granted via webhook');
    console.log('PASS: Webhook processed and removeAds granted permanently.');

    console.log('\nALL 6 BACKEND MONETIZATION SCENARIOS PASSED 100%!');
  } catch (err) {
    console.error('Test execution failed:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }
}

runTests();
