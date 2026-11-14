const PRODUCTS = [
  {
    id: 'pathora_hints_5',
    name: '5 Hints',
    description: '5 Hints to solve challenging puzzles',
    price: 900, // in paise (₹9)
    currency: 'INR',
    type: 'consumable',
    active: true,
    entitlement: {
      type: 'hints',
      amount: 5
    }
  },
  {
    id: 'pathora_hints_15',
    name: '15 Hints',
    description: '15 Hints for tricky boards',
    price: 1900, // ₹19
    currency: 'INR',
    type: 'consumable',
    active: true,
    entitlement: {
      type: 'hints',
      amount: 15
    }
  },
  {
    id: 'pathora_hints_50',
    name: '50 Hints',
    description: '50 Hints with maximum value',
    price: 3900, // ₹39
    currency: 'INR',
    type: 'consumable',
    active: true,
    entitlement: {
      type: 'hints',
      amount: 50
    }
  },
  {
    id: 'pathora_lives_5',
    name: '5 Extra Lives',
    description: '5 Additional Lives to recover anytime',
    price: 900, // ₹9
    currency: 'INR',
    type: 'consumable',
    active: true,
    entitlement: {
      type: 'lives',
      amount: 5
    }
  },
  {
    id: 'pathora_lives_15',
    name: '15 Extra Lives',
    description: '15 Additional Lives to keep playing',
    price: 1900, // ₹19
    currency: 'INR',
    type: 'consumable',
    active: true,
    entitlement: {
      type: 'lives',
      amount: 15
    }
  },
  {
    id: 'pathora_premium_puzzles',
    name: 'Premium Puzzle Pack',
    description: '50 Exclusive master-crafted campaign levels',
    price: 2900, // ₹29
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
    price: 1900, // ₹19
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
