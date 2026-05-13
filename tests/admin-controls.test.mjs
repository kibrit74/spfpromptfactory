import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildActiveRecords,
  evaluateActionAccess,
  getDailyUsageCounts,
  normalizeUserControls,
} from '../server/admin-controls.js';

test('normalizeUserControls accepts block state, reason, notes, and daily limits', () => {
  assert.deepEqual(
    normalizeUserControls({
      is_blocked: true,
      block_reason: 'chargeback',
      admin_notes: 'watch account',
      daily_prompt_limit: '3',
      daily_revision_limit: '',
      daily_analysis_limit: null,
    }),
    {
      is_blocked: true,
      block_reason: 'chargeback',
      admin_notes: 'watch account',
      daily_prompt_limit: 3,
      daily_revision_limit: null,
      daily_analysis_limit: null,
    },
  );
});

test('getDailyUsageCounts counts today prompt, revision, and analysis actions', () => {
  const now = new Date('2026-05-13T12:00:00.000Z');
  const counts = getDailyUsageCounts(
    {
      prompts: [
        { user_id: 'u1', created_at: '2026-05-13T09:00:00.000Z' },
        { user_id: 'u1', created_at: '2026-05-12T09:00:00.000Z' },
        { user_id: 'u2', created_at: '2026-05-13T10:00:00.000Z' },
      ],
      creditTransactions: [
        { user_id: 'u1', reason: 'revise', created_at: '2026-05-13T10:00:00.000Z' },
        { user_id: 'u1', reason: 'analyze', created_at: '2026-05-13T11:00:00.000Z' },
        { user_id: 'u1', reason: 'analyze', created_at: '2026-05-12T11:00:00.000Z' },
      ],
    },
    'u1',
    now,
  );

  assert.deepEqual(counts, { generate: 1, revise: 1, analyze: 1 });
});

test('evaluateActionAccess blocks blocked users and enforces per-action daily limits', () => {
  assert.deepEqual(
    evaluateActionAccess(
      { is_blocked: true, block_reason: 'abuse' },
      'generate',
      { generate: 0, revise: 0, analyze: 0 },
    ),
    { allowed: false, status: 403, reason: 'abuse' },
  );

  assert.deepEqual(
    evaluateActionAccess(
      { is_blocked: false, daily_revision_limit: 2 },
      'revise',
      { generate: 0, revise: 2, analyze: 0 },
    ),
    { allowed: false, status: 429, reason: 'Daily revise limit reached' },
  );

  assert.equal(
    evaluateActionAccess(
      { is_blocked: false, daily_prompt_limit: null },
      'generate',
      { generate: 200, revise: 0, analyze: 0 },
    ).allowed,
    true,
  );
});

test('buildActiveRecords returns visible scheduled announcements and campaigns', () => {
  const now = new Date('2026-05-13T12:00:00.000Z');
  const records = buildActiveRecords(
    [
      { id: 'a', status: 'active', starts_at: '2026-05-12T00:00:00.000Z', ends_at: null },
      { id: 'b', status: 'draft', starts_at: null, ends_at: null },
      { id: 'c', status: 'active', starts_at: null, ends_at: '2026-05-12T00:00:00.000Z' },
    ],
    now,
  );

  assert.deepEqual(records.map((record) => record.id), ['a']);
});
