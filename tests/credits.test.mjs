import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CREDIT_COSTS,
  CREDIT_PACKAGES,
  canSpendCredits,
  getCreditCost,
  getCreditPackage,
  sumCreditLedger,
} from '../server/credits.js';

test('credit packages expose the v1 pricing policy', () => {
  assert.deepEqual(CREDIT_PACKAGES.map((pack) => pack.id), [
    'free',
    'starter',
    'builder',
    'pro',
  ]);

  assert.equal(getCreditPackage('free').credits, 10);
  assert.equal(getCreditPackage('free').price_cents, 0);
  assert.equal(getCreditPackage('starter').credits, 50);
  assert.equal(getCreditPackage('starter').price_cents, 500);
  assert.equal(getCreditPackage('builder').credits, 150);
  assert.equal(getCreditPackage('builder').price_cents, 1200);
  assert.equal(getCreditPackage('pro').credits, 400);
  assert.equal(getCreditPackage('pro').price_cents, 2500);
});

test('credit costs match prompt intelligence actions', () => {
  assert.equal(CREDIT_COSTS.generate, 5);
  assert.equal(CREDIT_COSTS.revise, 5);
  assert.equal(CREDIT_COSTS.analyze, 1);
  assert.equal(getCreditCost('generate'), 5);
  assert.equal(getCreditCost('revise'), 5);
  assert.equal(getCreditCost('analyze'), 1);
});

test('credit helpers calculate spend eligibility and ledger balance', () => {
  assert.equal(canSpendCredits(4, 'generate'), false);
  assert.equal(canSpendCredits(5, 'generate'), true);
  assert.equal(canSpendCredits(0, 'analyze'), false);
  assert.equal(canSpendCredits(1, 'analyze'), true);

  assert.equal(
    sumCreditLedger([
      { delta: 10 },
      { delta: -5 },
      { delta: -1 },
    ]),
    4,
  );
});
