import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Gemini generation defaults to Gemini 3 Pro preview', () => {
  const serverSource = fs.readFileSync('server.js', 'utf8');
  const envExample = fs.readFileSync('.env.example', 'utf8');

  assert.match(serverSource, /'gemini-3-pro-preview'/);
  assert.doesNotMatch(serverSource, /'gemini-2\.5-pro'/);
  assert.match(envExample, /GEMINI_MODEL=gemini-3-pro-preview/);
});
