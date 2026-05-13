import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAdminOverview,
  buildAdminCreditTransactionRows,
  buildAdminUserRows,
  isAdminUser,
  parseAdminEmails,
} from '../server/admin-analytics.js';

test('parseAdminEmails normalizes comma separated admin emails', () => {
  assert.deepEqual(parseAdminEmails('A@EXAMPLE.COM, b@example.com ,,').sort(), [
    'a@example.com',
    'b@example.com',
  ]);
});

test('buildAdminCreditTransactionRows joins assigned user details', () => {
  const rows = buildAdminCreditTransactionRows(
    [
      {
        id: 't1',
        user_id: 'u1',
        delta: 50,
        reason: 'admin_adjustment',
        description: 'Admin kredi duzeltmesi: +50 kredi',
      },
    ],
    [{ id: 'u1', email: 'customer@example.com', name: 'Customer' }],
  );

  assert.equal(rows[0].user_email, 'customer@example.com');
  assert.equal(rows[0].user_name, 'Customer');
  assert.equal(rows[0].display_label, 'Customer <customer@example.com>');
});

test('isAdminUser accepts database admins and configured admin emails', () => {
  assert.equal(isAdminUser({ email: 'owner@example.com', is_admin: false }, 'owner@example.com'), true);
  assert.equal(isAdminUser({ email: 'user@example.com', is_admin: true }, ''), true);
  assert.equal(isAdminUser({ email: 'user@example.com', is_admin: false }, 'owner@example.com'), false);
});

test('buildAdminOverview calculates platform totals and daily revision metrics', () => {
  const now = new Date('2026-05-13T12:00:00.000Z');
  const overview = buildAdminOverview(
    {
      users: [{ id: 'u1' }, { id: 'u2' }],
      prompts: [
        { id: 'p1', user_id: 'u1', created_at: '2026-05-13T09:00:00.000Z' },
        { id: 'p2', user_id: 'u1', created_at: '2026-05-12T09:00:00.000Z' },
      ],
      promptVersions: [
        { id: 'v1', prompt_id: 'p1', version_number: 1, revision_instruction: null, created_at: '2026-05-13T09:02:00.000Z' },
        { id: 'v2', prompt_id: 'p1', version_number: 2, revision_instruction: 'shorter', created_at: '2026-05-13T10:00:00.000Z' },
        { id: 'v3', prompt_id: 'p2', version_number: 2, revision_instruction: 'safer', created_at: '2026-05-12T10:00:00.000Z' },
      ],
      creditTransactions: [
        { user_id: 'u1', delta: 10 },
        { user_id: 'u1', delta: -5, reason: 'generate' },
        { user_id: 'u2', delta: 50, reason: 'purchase' },
      ],
    },
    now,
  );

  assert.equal(overview.total_users, 2);
  assert.equal(overview.total_prompts, 2);
  assert.equal(overview.total_revisions, 2);
  assert.equal(overview.daily_prompts, 1);
  assert.equal(overview.daily_revisions, 1);
  assert.equal(overview.total_credit_balance, 55);
  assert.equal(overview.total_credits_spent, 5);
});

test('buildAdminUserRows joins user credit, prompt, and revision counts', () => {
  const rows = buildAdminUserRows({
    users: [
      { id: 'u1', email: 'a@example.com', name: 'A' },
      { id: 'u2', email: 'b@example.com', name: 'B' },
    ],
    prompts: [
      { id: 'p1', user_id: 'u1' },
      { id: 'p2', user_id: 'u1' },
    ],
    promptVersions: [
      { prompt_id: 'p1', revision_instruction: 'revise' },
      { prompt_id: 'p2', revision_instruction: null },
    ],
    creditTransactions: [
      { user_id: 'u1', delta: 10 },
      { user_id: 'u1', delta: -5 },
      { user_id: 'u2', delta: 50 },
    ],
  });

  assert.deepEqual(rows.map((row) => ({
    id: row.id,
    credits_balance: row.credits_balance,
    prompt_count: row.prompt_count,
    revision_count: row.revision_count,
  })), [
    { id: 'u1', credits_balance: 5, prompt_count: 2, revision_count: 1 },
    { id: 'u2', credits_balance: 50, prompt_count: 0, revision_count: 0 },
  ]);
});
