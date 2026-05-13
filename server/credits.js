export const CREDIT_PACKAGES = [
  {
    id: 'free',
    name: 'Free',
    credits: 10,
    price_cents: 0,
    currency: 'USD',
    description: 'Baslangic kredisi',
  },
  {
    id: 'starter',
    name: 'Starter',
    credits: 50,
    price_cents: 500,
    currency: 'USD',
    description: 'Hafif kullanim icin',
  },
  {
    id: 'builder',
    name: 'Builder',
    credits: 150,
    price_cents: 1200,
    currency: 'USD',
    description: 'Duzenli prompt uretimi icin',
  },
  {
    id: 'pro',
    name: 'Pro',
    credits: 400,
    price_cents: 2500,
    currency: 'USD',
    description: 'Yogun kullanim icin',
  },
];

export const CREDIT_COSTS = {
  analyze: 1,
  generate: 5,
  revise: 5,
};

export function getCreditPackage(packageId) {
  return CREDIT_PACKAGES.find((pack) => pack.id === packageId) || null;
}

export function getCreditCost(action) {
  const cost = CREDIT_COSTS[action];
  if (!Number.isInteger(cost)) {
    throw new Error(`Unknown credit action: ${action}`);
  }
  return cost;
}

export function canSpendCredits(balance, actionOrCost) {
  const cost = typeof actionOrCost === 'number' ? actionOrCost : getCreditCost(actionOrCost);
  return Number(balance) >= cost;
}

export function sumCreditLedger(entries) {
  return entries.reduce((total, entry) => total + Number(entry?.delta || 0), 0);
}
