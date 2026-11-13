const mongoose = require('mongoose');

const entitlementSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  hintsBalance: {
    type: Number,
    default: 3,
    min: 0
  },
  extraLivesBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  removeAds: {
    type: Boolean,
    default: false
  },
  premiumPuzzlesUnlocked: {
    type: [String],
    default: []
  },
  premiumThemesUnlocked: {
    type: [String],
    default: []
  },
  lastSynchronizedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Entitlement', entitlementSchema);

