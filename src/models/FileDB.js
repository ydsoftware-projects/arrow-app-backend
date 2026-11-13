const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'db_data.json');

class FileDB {
  constructor() {
    this.data = {
      orders: [],
      entitlements: [],
      audits: []
    };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        this.data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      }
    } catch (_) {}
  }

  _save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (_) {}
  }

  // Orders
  async findOrder(orderId) {
    return this.data.orders.find(o => o.orderId === orderId);
  }

  async saveOrder(order) {
    const idx = this.data.orders.findIndex(o => o.orderId === order.orderId);
    if (idx >= 0) {
      this.data.orders[idx] = { ...this.data.orders[idx], ...order, updatedAt: new Date() };
    } else {
      this.data.orders.push({ ...order, createdAt: new Date(), updatedAt: new Date() });
    }
    this._save();
    return this.findOrder(order.orderId);
  }

  async getOrderHistory(userId) {
    return this.data.orders
      .filter(o => o.userId === userId && o.status === 'paid')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  // Entitlements
  async findEntitlement(userId) {
    return this.data.entitlements.find(e => e.userId === userId);
  }

  async saveEntitlement(entitlement) {
    const idx = this.data.entitlements.findIndex(e => e.userId === entitlement.userId);
    if (idx >= 0) {
      this.data.entitlements[idx] = { ...this.data.entitlements[idx], ...entitlement, updatedAt: new Date() };
    } else {
      this.data.entitlements.push({ ...entitlement, createdAt: new Date(), updatedAt: new Date() });
    }
    this._save();
    return this.findEntitlement(entitlement.userId);
  }

  // Audits
  async logAudit(audit) {
    this.data.audits.push({ ...audit, createdAt: new Date() });
    this._save();
  }
}

module.exports = new FileDB();

