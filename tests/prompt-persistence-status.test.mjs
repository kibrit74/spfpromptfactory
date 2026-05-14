import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRuntimeStatus,
  getPromptPersistenceBlocker,
  normalizeSaveFailure,
} from '../server/runtime-status.js';

test('prompt persistence requires a hydrated Supabase user id', () => {
  const blocker = getPromptPersistenceBlocker({
    userId: null,
    supabaseAdminAvailable: true,
    disabledReason: null,
  });

  assert.equal(blocker.code, 'missing_user_id');
  assert.match(blocker.message, /Supabase user sync/i);
});

test('prompt persistence reports disabled Supabase admin as unavailable', () => {
  const blocker = getPromptPersistenceBlocker({
    userId: 'user-1',
    supabaseAdminAvailable: false,
    disabledReason: 'Supabase service key is invalid.',
  });

  assert.equal(blocker.code, 'supabase_unavailable');
  assert.equal(blocker.message, 'Supabase service key is invalid.');
});

test('save failure payload keeps the generated prompt but marks persistence as failed', () => {
  const payload = normalizeSaveFailure('generated prompt', new Error('insert failed'));

  assert.equal(payload.prompt, 'generated prompt');
  assert.equal(payload.prompt_id, null);
  assert.equal(payload.save_status, 'failed');
  assert.equal(payload.save_error, 'insert failed');
});

test('runtime status exposes Google auth, Gemini runtime, and prompt persistence independently', () => {
  const status = buildRuntimeStatus({
    googleOAuthConfigured: true,
    googleCallbackUrl: 'http://localhost:3000/auth/google/callback',
    geminiConfigured: false,
    geminiModel: 'gemini-3-pro-preview',
    supabaseConfigured: true,
    supabaseAdminAvailable: false,
    supabaseDisabledReason: 'Supabase service key is invalid.',
    promptPersistenceChecked: true,
    promptPersistenceOk: false,
    promptPersistenceError: 'Invalid API key',
    promptMarketChecked: true,
    promptMarketOk: false,
    promptMarketError: 'Market schema missing',
  });

  assert.equal(status.google_auth.ok, true);
  assert.equal(status.gemini_runtime.ok, false);
  assert.equal(status.supabase_prompt_persistence.ok, false);
  assert.equal(status.supabase_prompt_persistence.reason, 'Invalid API key');
  assert.equal(status.prompt_market.ok, false);
  assert.equal(status.prompt_market.reason, 'Market schema missing');
});
