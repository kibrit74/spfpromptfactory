import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildContextPackInstruction,
  getNextVersionNumber,
  normalizeAnalysisPayload,
  parseJsonObject,
} from '../server/prompt-intelligence.js';

test('parseJsonObject extracts fenced JSON objects', () => {
  const parsed = parseJsonObject('```json\n{"quality_score":82,"missing_context":[]}\n```');

  assert.equal(parsed.quality_score, 82);
  assert.deepEqual(parsed.missing_context, []);
});

test('normalizeAnalysisPayload fills safe defaults for partial model output', () => {
  const normalized = normalizeAnalysisPayload({
    quality_score: 91,
    quality_findings: ['clear output contract'],
  });

  assert.equal(normalized.quality_score, 91);
  assert.deepEqual(normalized.missing_context, []);
  assert.deepEqual(normalized.quality_findings, ['clear output contract']);
  assert.deepEqual(normalized.test_cases, []);
});

test('buildContextPackInstruction includes user-visible context pack fields', () => {
  const instruction = buildContextPackInstruction({
    name: 'Frontend Pack',
    description: 'React/Vite product UI',
    content: 'Use existing AppShell and CSS tokens.',
  });

  assert.match(instruction, /CONTEXT PACK: Frontend Pack/);
  assert.match(instruction, /React\/Vite product UI/);
  assert.match(instruction, /Use existing AppShell/);
});

test('getNextVersionNumber increments the highest existing version', () => {
  assert.equal(getNextVersionNumber([{ version_number: 1 }, { version_number: 4 }]), 5);
  assert.equal(getNextVersionNumber([]), 1);
});
