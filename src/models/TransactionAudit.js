const mongoose = require('mongoose');

const transactionAuditSchema = new mongoose.Schema({
  eventType: {
    type: String,
    required: true,
    enum: [
      'order_created',
      'payment_verified',
      'signature_failed',
      'entitlement_granted',
      'duplicate_attempt_blocked',
      'webhook_received',
      'webhook_processed',
      'payment_failed',
      'refund_processed'
    ]
  },
  userId: {
    type: String,
    index: true
  },
  orderId: {
    type: String,
    index: true
  },
  paymentId: {
    type: String,
    index: true
  },
  details: {
    type: mongoose.Schema.Types.Mixed
  },
  ipAddress: {
    type: String
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('TransactionAudit', transactionAuditSchema);

