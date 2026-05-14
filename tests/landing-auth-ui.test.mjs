import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('landing pages load signed-in CTA behavior from the shared auth UI script', () => {
  for (const file of ['index.html', 'landing.html']) {
    const html = fs.readFileSync(file, 'utf8');

    assert.match(html, /<script src="\/auth-ui\.js" defer><\/script>/);
    assert.doesNotMatch(html, /async function syncAuthCtas/);
  }
});

test('app shell also has access to the shared auth UI script for static auth fragments', () => {
  const html = fs.readFileSync('app.html', 'utf8');

  assert.match(html, /<script src="\/auth-ui\.js" defer><\/script>/);
});
