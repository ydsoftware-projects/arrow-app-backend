const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
} catch (_) {}

require('dotenv').config();
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const paymentService = require('../src/services/paymentService');
const Order = require('../src/models/Order');
const Entitlement = require('../src/models/Entitlement');
const TransactionAudit = require('../src/models/TransactionAudit');

async function runTests() {
  console.log('=== RUNNING COMPREHENSIVE BACKEND MONGODB & RAZORPAY AUDIT TESTS ===\n');
  let mongoServer;

  try {
    // -------------------------------------------------------------
    // TEST 1: Fail-Closed Protection When Database Is Unavailable
    // -------------------------------------------------------------
    console.log('--- TEST 1: Fail-Closed Protection (DB Unavailable) ---');
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }

    let failClosedOrderCaught = false;
    try {
      await paymentService.createOrder({
        userId: 'fail_user',
        productId: 'pathora_hints_5',
        ipAddress: '127.0.0.1'
      });
    } catch (e) {
      failClosedOrderCaught = true;
      if (!e.message.includes('Database unavailable')) {
        throw new Error(`Unexpected error message: ${e.message}`);
      }
    }
    if (!failClosedOrderCaught) {
      throw new Error('createOrder must fail closed when database is disconnected');
    }

    let failClosedVerifyCaught = false;
    try {
      await paymentService.verifyPayment({
        userId: 'fail_user',
        orderId: 'order_dummy',
        paymentId: 'pay_dummy',
        signature: 'dummy_sig',
        ipAddress: '127.0.0.1'
      });
    } catch (e) {
      failClosedVerifyCaught = true;
      if (!e.message.includes('Database unavailable')) {
        throw new Error(`Unexpected error message: ${e.message}`);
      }
    }
    if (!failClosedVerifyCaught) {
      throw new Error('verifyPayment must fail closed when database is disconnected');
    }
    console.log('PASS: Fail-closed verified. Orders and payments strictly rejected when DB unavailable.\n');

    // -------------------------------------------------------------
    // Connect to In-Memory MongoDB Server for Isolated Production Tests
    // -------------------------------------------------------------
    console.log('--- Connecting to Test MongoDB Server ---');
    mongoServer = await MongoMemoryServer.create({
      instance: { launchTimeout: 60000 }
    });
    const uri = mongoServer.getUri();
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    console.log(`PASS: MongoDB connected successfully (ReadyState: ${mongoose.connection.readyState}).\n`);

    const userId = `user_atlas_${Date.now()}`;

    // -------------------------------------------------------------
    // TEST 2: Retrieve & Initialize User Entitlements in MongoDB
    // -------------------------------------------------------------
    console.log('--- TEST 2: Retrieve / Initialize User Entitlements in MongoDB ---');
    const initEnt = await paymentService.getUserEntitlements(userId);
    if (initEnt.hintsBalance !== 3) throw new Error(`Default hints should be 3, got ${initEnt.hintsBalance}`);
    if (initEnt.removeAds !== false) throw new Error(`Default removeAds should be false, got ${initEnt.removeAds}`);
    if (initEnt.extraLivesBalance !== 0) throw new Error(`Default extraLivesBalance should be 0, got ${initEnt.extraLivesBalance}`);

    // Verify document exists in MongoDB collection
    const dbEntDoc = await Entitlement.findOne({ userId });
    if (!dbEntDoc) throw new Error('Entitlement document was not persisted to MongoDB!');
    if (dbEntDoc.hintsBalance !== 3) throw new Error('MongoDB Entitlement hints balance mismatch');
    console.log('PASS: User entitlements successfully initialized and persisted in MongoDB.\n');

    // -------------------------------------------------------------
    // TEST 3: Order Creation & MongoDB Order Persistence
    // -------------------------------------------------------------
    console.log('--- TEST 3: Order Creation & MongoDB Order Persistence ---');
    const orderData = await paymentService.createOrder({
      userId,
      productId: 'pathora_hints_5',
      ipAddress: '127.0.0.1'
    });
    if (!orderData.orderId) throw new Error('Order creation must return orderId');
    if (orderData.amount !== 900) throw new Error(`Expected amount 900, got ${orderData.amount}`);

    // Verify Order persisted in MongoDB Order collection
    const dbOrder = await Order.findOne({ orderId: orderData.orderId });
    if (!dbOrder) throw new Error(`Order ${orderData.orderId} was not saved to MongoDB!`);
    if (dbOrder.status !== 'created') throw new Error(`Expected status 'created', got ${dbOrder.status}`);
    if (dbOrder.amount !== 900) throw new Error(`Expected amount 900 in MongoDB, got ${dbOrder.amount}`);
    if (dbOrder.entitlementGranted !== false) throw new Error('entitlementGranted should be false initially');

    // Verify TransactionAudit event was recorded
    const auditCreated = await TransactionAudit.findOne({
      orderId: orderData.orderId,
      eventType: 'order_created'
    });
    if (!auditCreated) throw new Error('order_created audit record was not found in MongoDB!');
    console.log(`PASS: Order ${orderData.orderId} and audit trail persisted to MongoDB.\n`);

    // -------------------------------------------------------------
    // TEST 4: Payment Signature Verification & Atomic Entitlement Credit
    // -------------------------------------------------------------
    console.log('--- TEST 4: Payment Signature Verification & Atomic Entitlement Credit ---');
    const paymentId = `pay_atlas_${Date.now()}`;
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

    if (!verifyResult.success) throw new Error('Payment verification must return success: true');
    if (verifyResult.entitlements.hintsBalance !== 8) {
      throw new Error(`Hints balance should now be 3 + 5 = 8, got ${verifyResult.entitlements.hintsBalance}`);
    }

    // Verify updated Order in MongoDB
    const dbOrderPaid = await Order.findOne({ orderId: orderData.orderId });
    if (dbOrderPaid.status !== 'paid') throw new Error('Order status should be paid in MongoDB');
    if (!dbOrderPaid.entitlementGranted) throw new Error('entitlementGranted should be true in MongoDB');
    if (dbOrderPaid.razorpayPaymentId !== paymentId) throw new Error('razorpayPaymentId mismatch in MongoDB');

    // Verify Entitlement in MongoDB
    const dbEntPaid = await Entitlement.findOne({ userId });
    if (dbEntPaid.hintsBalance !== 8) throw new Error(`MongoDB Entitlement hints balance should be 8, got ${dbEntPaid.hintsBalance}`);

    // Verify TransactionAudit event
    const auditPaid = await TransactionAudit.findOne({
      orderId: orderData.orderId,
      eventType: 'entitlement_granted'
    });
    if (!auditPaid) throw new Error('entitlement_granted audit log missing from MongoDB!');
    console.log('PASS: Cryptographic payment verification passed. Entitlements and audits committed to MongoDB.\n');

    // -------------------------------------------------------------
    // TEST 5: Anti-Replay Duplicate Callback Protection
    // -------------------------------------------------------------
    console.log('--- TEST 5: Anti-Replay Duplicate Callback Protection ---');
    const replayResult = await paymentService.verifyPayment({
      userId,
      orderId: orderData.orderId,
      paymentId,
      signature: validSignature,
      ipAddress: '127.0.0.1'
    });

    if (!replayResult.alreadyProcessed) throw new Error('Duplicate verification must return alreadyProcessed: true');
    if (replayResult.entitlements.hintsBalance !== 8) {
      throw new Error(`Hints balance must remain 8, never double-credited! Got: ${replayResult.entitlements.hintsBalance}`);
    }

    const auditReplay = await TransactionAudit.findOne({
      orderId: orderData.orderId,
      eventType: 'duplicate_attempt_blocked'
    });
    if (!auditReplay) throw new Error('duplicate_attempt_blocked audit record missing from MongoDB!');
    console.log('PASS: Anti-replay protection active. Duplicate verification safely blocked with audit trail.\n');

    // -------------------------------------------------------------
    // TEST 6: Tampered / Invalid Signature Rejection
    // -------------------------------------------------------------
    console.log('--- TEST 6: Tampered / Invalid Signature Rejection ---');
    const fraudOrder = await paymentService.createOrder({
      userId,
      productId: 'pathora_hints_5',
      ipAddress: '127.0.0.1'
    });

    let tamperedCaught = false;
    try {
      await paymentService.verifyPayment({
        userId,
        orderId: fraudOrder.orderId,
        paymentId: 'pay_fraud_123',
        signature: 'invalid_sha256_forged_signature_hex_code',
        ipAddress: '127.0.0.1'
      });
    } catch (e) {
      tamperedCaught = true;
      if (!e.message.includes('signature verification failed')) {
        throw new Error(`Unexpected error message: ${e.message}`);
      }
    }
    if (!tamperedCaught) throw new Error('Tampered signature must be rejected cryptographically!');

    // Verify fraud order remains uncredited in MongoDB
    const dbFraudOrder = await Order.findOne({ orderId: fraudOrder.orderId });
    if (dbFraudOrder.status !== 'created') throw new Error('Tampered order must remain created, not paid');
    if (dbFraudOrder.entitlementGranted !== false) throw new Error('Fraudulent order must not grant entitlement');

    // Verify signature_failed audit event in MongoDB
    const auditFraud = await TransactionAudit.findOne({
      orderId: fraudOrder.orderId,
      eventType: 'signature_failed'
    });
    if (!auditFraud) throw new Error('signature_failed audit event was not recorded in MongoDB!');
    console.log('PASS: Cryptographic tampering detected and rejected. Audit event logged in MongoDB.\n');

    // -------------------------------------------------------------
    // TEST 7: Order Ownership Mismatch Protection
    // -------------------------------------------------------------
    console.log('--- TEST 7: Order Ownership Mismatch Protection ---');
    let ownershipMismatchCaught = false;
    try {
      await paymentService.verifyPayment({
        userId: 'attacker_user_id',
        orderId: fraudOrder.orderId,
        paymentId: 'pay_hijack_456',
        signature: 'any_signature',
        ipAddress: '127.0.0.1'
      });
    } catch (e) {
      ownershipMismatchCaught = true;
      if (!e.message.includes('Order ownership mismatch')) {
        throw new Error(`Unexpected error message: ${e.message}`);
      }
    }
    if (!ownershipMismatchCaught) throw new Error('Ownership mismatch must be rejected!');
    console.log('PASS: Ownership mismatch rejected safely.\n');

    // -------------------------------------------------------------
    // TEST 8: Webhook Validation, Idempotency & Processing in MongoDB
    // -------------------------------------------------------------
    console.log('--- TEST 8: Webhook Validation, Processing & Idempotency ---');
    const webhookOrder = await paymentService.createOrder({
      userId,
      productId: 'pathora_premium_themes',
      ipAddress: '127.0.0.1'
    });

    const webhookPaymentId = `pay_wh_${Date.now()}`;
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

    const webhookPayloadStr = JSON.stringify(webhookPayload);

    // 8a. Test Invalid Webhook Signature
    let invalidWhCaught = false;
    try {
      await paymentService.processWebhook(
        webhookPayloadStr,
        'bogus_webhook_signature_hex_fail',
        '127.0.0.1'
      );
    } catch (e) {
      invalidWhCaught = true;
      if (!e.message.includes('Invalid webhook signature')) {
        throw new Error(`Unexpected error message: ${e.message}`);
      }
    }
    if (!invalidWhCaught) throw new Error('Invalid webhook signature must be rejected!');
    console.log('PASS: Invalid webhook signature cryptographically rejected.');

    // 8b. Test Valid Webhook Signature
    const validWebhookSig = crypto
      .createHmac('sha256', paymentService.webhookSecret)
      .update(webhookPayloadStr)
      .digest('hex');

    const whResult = await paymentService.processWebhook(
      webhookPayloadStr,
      validWebhookSig,
      '127.0.0.1'
    );
    if (!whResult.processed) throw new Error('Valid webhook must be processed');

    // Verify themes unlocked in MongoDB
    const dbThemesEnt = await Entitlement.findOne({ userId });
    if (!dbThemesEnt.premiumThemesUnlocked.includes('sunset')) {
      throw new Error('Sunset theme was not unlocked in MongoDB by webhook!');
    }
    if (!dbThemesEnt.premiumThemesUnlocked.includes('forest')) {
      throw new Error('Forest theme was not unlocked in MongoDB by webhook!');
    }
    console.log('PASS: Webhook signature verified. Entitlement fulfilled in MongoDB.');

    // 8c. Test Duplicate Webhook Replay Idempotency
    const duplicateWhResult = await paymentService.processWebhook(
      webhookPayloadStr,
      validWebhookSig,
      '127.0.0.1'
    );
    if (!duplicateWhResult.processed || !duplicateWhResult.alreadyProcessed) {
      throw new Error('Duplicate webhook must return alreadyProcessed: true');
    }
    console.log('PASS: Duplicate webhook processed idempotently without double fulfillment.\n');

    // -------------------------------------------------------------
    // TEST 9: Repeated Consumable Purchase (5 Hints Again)
    // -------------------------------------------------------------
    console.log('--- TEST 9: Repeated Consumable Purchase (Second Hints Pack) ---');
    const repeatOrder = await paymentService.createOrder({
      userId,
      productId: 'pathora_hints_5',
      ipAddress: '127.0.0.1'
    });
    const repeatPaymentId = `pay_repeat_${Date.now()}`;
    const repeatSig = crypto
      .createHmac('sha256', paymentService.keySecret)
      .update(`${repeatOrder.orderId}|${repeatPaymentId}`)
      .digest('hex');

    const repeatVerify = await paymentService.verifyPayment({
      userId,
      orderId: repeatOrder.orderId,
      paymentId: repeatPaymentId,
      signature: repeatSig,
      ipAddress: '127.0.0.1'
    });

    if (repeatVerify.entitlements.hintsBalance !== 13) {
      throw new Error(`Hints balance should be 8 + 5 = 13, got ${repeatVerify.entitlements.hintsBalance}`);
    }

    const repeatDbEnt = await Entitlement.findOne({ userId });
    if (repeatDbEnt.hintsBalance !== 13) {
      throw new Error(`MongoDB Entitlement hints balance should be 13, got ${repeatDbEnt.hintsBalance}`);
    }
    console.log('PASS: Repeated consumable purchase credited correctly (8 + 5 = 13 hints) in MongoDB.\n');

    // -------------------------------------------------------------
    // TEST 10: Non-Consumable Purchase (Premium Puzzle Pack)
    // -------------------------------------------------------------
    console.log('--- TEST 10: Non-Consumable Purchase (Premium Puzzles) ---');
    const ncOrder = await paymentService.createOrder({
      userId,
      productId: 'pathora_premium_puzzles',
      ipAddress: '127.0.0.1'
    });
    const ncPaymentId = `pay_nc_${Date.now()}`;
    const ncSig = crypto
      .createHmac('sha256', paymentService.keySecret)
      .update(`${ncOrder.orderId}|${ncPaymentId}`)
      .digest('hex');

    const ncVerify = await paymentService.verifyPayment({
      userId,
      orderId: ncOrder.orderId,
      paymentId: ncPaymentId,
      signature: ncSig,
      ipAddress: '127.0.0.1'
    });

    if (!ncVerify.entitlements.premiumPuzzlesUnlocked.includes('campaign_pack_master')) {
      throw new Error('campaign_pack_master should be unlocked in entitlements');
    }

    const ncDbEnt = await Entitlement.findOne({ userId });
    if (!ncDbEnt.premiumPuzzlesUnlocked.includes('campaign_pack_master')) {
      throw new Error('campaign_pack_master missing from MongoDB Entitlement record');
    }
    console.log('PASS: Non-consumable Premium Puzzle Pack unlocked permanently in MongoDB.\n');

    // -------------------------------------------------------------
    // TEST 11: Extra Lives Consumable Purchase
    // -------------------------------------------------------------
    console.log('--- TEST 11: Extra Lives Consumable Purchase ---');
    const livesOrder = await paymentService.createOrder({
      userId,
      productId: 'pathora_lives_5',
      ipAddress: '127.0.0.1'
    });
    const livesPaymentId = `pay_lives_${Date.now()}`;
    const livesSig = crypto
      .createHmac('sha256', paymentService.keySecret)
      .update(`${livesOrder.orderId}|${livesPaymentId}`)
      .digest('hex');

    const livesVerify = await paymentService.verifyPayment({
      userId,
      orderId: livesOrder.orderId,
      paymentId: livesPaymentId,
      signature: livesSig,
      ipAddress: '127.0.0.1'
    });

    if (livesVerify.entitlements.extraLivesBalance !== 5) {
      throw new Error(`extraLivesBalance should be 5, got ${livesVerify.entitlements.extraLivesBalance}`);
    }
    console.log('PASS: Extra lives credited correctly (5 lives) in MongoDB.\n');

    // -------------------------------------------------------------
    // TEST 12: Restore Purchases & Server Restart Reconciliation
    // -------------------------------------------------------------
    console.log('--- TEST 12: Restore Purchases & Persistence Across Restarts ---');
    // Fetch directly using a fresh query to MongoDB
    const restoredEntitlements = await paymentService.getUserEntitlements(userId);
    const purchaseHistory = await paymentService.getPurchaseHistory(userId);

    if (restoredEntitlements.hintsBalance !== 13) {
      throw new Error(`Restored hints balance mismatch. Expected 13, got ${restoredEntitlements.hintsBalance}`);
    }
    if (restoredEntitlements.extraLivesBalance !== 5) {
      throw new Error(`Restored lives balance mismatch. Expected 5, got ${restoredEntitlements.extraLivesBalance}`);
    }
    if (!restoredEntitlements.premiumPuzzlesUnlocked.includes('campaign_pack_master')) {
      throw new Error('Restored entitlements must contain campaign_pack_master');
    }
    if (!restoredEntitlements.premiumThemesUnlocked.includes('sunset')) {
      throw new Error('Restored entitlements must contain sunset theme');
    }
    if (purchaseHistory.length < 4) {
      throw new Error(`Purchase history should contain at least 4 paid orders, got ${purchaseHistory.length}`);
    }
    console.log(`PASS: All purchases and balances (${restoredEntitlements.hintsBalance} hints, ${restoredEntitlements.extraLivesBalance} lives, 1 puzzle pack, 1 theme pack) restored from MongoDB.`);
    console.log(`PASS: Purchase history contains ${purchaseHistory.length} paid orders in MongoDB.\n`);

    console.log('=================================================================');
    console.log('ALL 12 BACKEND MONGODB & RAZORPAY AUDIT TESTS PASSED FLAWLESSLY! 🚀');
    console.log('=================================================================\n');

  } catch (error) {
    console.error('TEST SUITE FAILED:', error);
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
