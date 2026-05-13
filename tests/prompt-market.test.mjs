import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyMarketUserState,
  normalizeMarketShareInput,
  rankMarketItems,
} from '../server/prompt-market.js';

test('normalizeMarketShareInput prepares user share metadata with safe defaults', () => {
  const input = normalizeMarketShareInput(
    {
      title: '  React SaaS Paneli  ',
      description: '  Admin panel promptu  ',
      category: '  Frontend  ',
    },
    {
      task: 'React dashboard icin prompt uret',
      generated_prompt: 'SPF prompt',
    },
  );

  assert.deepEqual(input, {
    title: 'React SaaS Paneli',
    description: 'Admin panel promptu',
    category: 'Frontend',
    prompt_text: 'SPF prompt',
    source_task: 'React dashboard icin prompt uret',
  });
});

test('normalizeMarketShareInput falls back to prompt task and general category', () => {
  const input = normalizeMarketShareInput(
    {
      title: '',
      description: '',
      category: '',
    },
    {
      task: 'Uzun bir prompt gorevi',
      generated_prompt: 'SPF prompt',
    },
  );

  assert.equal(input.title, 'Uzun bir prompt gorevi');
  assert.equal(input.description, 'Uzun bir prompt gorevi');
  assert.equal(input.category, 'Genel');
});

test('rankMarketItems prioritizes highest star count and secondary engagement', () => {
  const ranked = rankMarketItems([
    { id: 'a', star_count: 4, comment_count: 10, save_count: 0, created_at: '2026-01-01T00:00:00Z' },
    { id: 'b', star_count: 8, comment_count: 1, save_count: 0, created_at: '2026-01-01T00:00:00Z' },
    { id: 'c', star_count: 8, comment_count: 4, save_count: 1, created_at: '2026-01-01T00:00:00Z' },
  ]);

  assert.deepEqual(ranked.map((item) => item.id), ['c', 'b', 'a']);
});

test('applyMarketUserState flags starred and saved prompts for current user', () => {
  const items = applyMarketUserState(
    [{ id: 'market-1' }, { id: 'market-2' }],
    [{ market_item_id: 'market-2' }],
    [{ market_item_id: 'market-1' }],
  );

  assert.equal(items[0].starred_by_user, false);
  assert.equal(items[0].saved_by_user, true);
  assert.equal(items[1].starred_by_user, true);
  assert.equal(items[1].saved_by_user, false);
});
