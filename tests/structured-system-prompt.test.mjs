import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function readStructuredSystemPrompt() {
  const source = fs.readFileSync('server.js', 'utf8');
  const match = source.match(/const STRUCTURED_SYSTEM_PROMPT = `([\s\S]*?)`;\n\nconst ANALYSIS_SYSTEM_PROMPT/);
  assert.ok(match, 'STRUCTURED_SYSTEM_PROMPT must be declared before ANALYSIS_SYSTEM_PROMPT');
  return match[1];
}

test('structured system prompt uses SPF Generator v1.0 contract', () => {
  const prompt = readStructuredSystemPrompt();

  assert.match(prompt, /SPF Prompt Generator -- Sistem Promptu v1\.0/);
  assert.match(prompt, /@spf_standard/);
  assert.match(prompt, /@skill_anatomy/);
  assert.match(prompt, /@clarification_questions/);
  assert.match(prompt, /@quality_rules/);
  assert.match(prompt, /## Tasarim Kararlari/);
  assert.doesNotMatch(prompt, /Return ONLY the SPF prompt\. No explanation before or after\./);
});

test('structured system prompt requires all mandatory SPF sections in order', () => {
  const prompt = readStructuredSystemPrompt();
  const sections = [
    '@model',
    '@init',
    '@context',
    '@skills',
    '@task',
    '@sections',
    '@design_system',
    '@rules',
    '@validators',
    '@failure_policy',
    '@output',
  ];

  let cursor = -1;
  for (const section of sections) {
    const index = prompt.indexOf(section);
    assert.ok(index > cursor, `${section} should appear after the previous mandatory section`);
    cursor = index;
  }
});
