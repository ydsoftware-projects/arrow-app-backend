const PRODUCTS = [
  {
    id: 'pathora_hints_small',
    name: 'Hint Pack Small',
    description: '10 Hints to solve challenging puzzles',
    price: 4900, // in paise (₹49)
    currency: 'INR',
    type: 'consumable',
    active: true,
    entitlement: {
      type: 'hints',
      amount: 10
    }
  },
  {
    id: 'pathora_hints_medium',
    name: 'Hint Pack Medium',
    description: '50 Hints with 20% bonus value',
    price: 19900, // ₹199
    currency: 'INR',
    type: 'consumable',
    active: true,
    entitlement: {
      type: 'hints',
      amount: 50
    }
  },
  {
    id: 'pathora_hints_large',
    name: 'Hint Pack Large',
    description: '150 Hints for puzzle masters',
    price: 49900, // ₹499
    currency: 'INR',
    type: 'consumable',
    active: true,
    entitlement: {
      type: 'hints',
      amount: 150
    }
  },
  {
    id: 'pathora_extra_lives',
    name: 'Extra Lives Pack',
    description: '10 Additional Lives to recover anytime',
    price: 7900, // ₹79
    currency: 'INR',
    type: 'consumable',
    active: true,
    entitlement: {
      type: 'lives',
      amount: 10
    }
  },
  {
    id: 'pathora_remove_ads',
    name: 'Remove Ads',
    description: 'Permanent ad-free puzzle experience',
    price: 14900, // ₹149
    currency: 'INR',
    type: 'non_consumable',
    active: true,
    entitlement: {
      type: 'remove_ads',
      value: true
    }
  },
  {
    id: 'pathora_premium_puzzles',
    name: 'Premium Puzzle Pack',
    description: '50 Exclusive master-crafted campaign levels',
    price: 9900, // ₹99
    currency: 'INR',
    type: 'non_consumable',
    active: true,
    entitlement: {
      type: 'premium_pack',
      packId: 'campaign_pack_master'
    }
  },
  {
    id: 'pathora_premium_themes',
    name: 'Premium Theme Pack',
    description: 'Unlock Sunset, Amber, Neon and Forest themes',
    price: 9900, // ₹99
    currency: 'INR',
    type: 'non_consumable',
    active: true,
    entitlement: {
      type: 'premium_themes',
      themes: ['sunset', 'amber', 'forest']
    }
  }
];

function getProductById(productId) {
  return PRODUCTS.find(p => p.id === productId && p.active);
}

module.exports = {
  PRODUCTS,
  getProductById
};

