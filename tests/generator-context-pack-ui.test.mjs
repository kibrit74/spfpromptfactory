import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('generator explains what Context Pack is for', () => {
  const source = fs.readFileSync('src/pages/GeneratorPage.tsx', 'utf8');

  assert.match(source, /Context Pack ne ise yarar\?/);
  assert.match(source, /Ayni proje, marka tonu veya sabit kurallari her promptta tekrar yazmamak icin kullanin\./);
  assert.match(source, /Secili paket; uretim, analiz ve revizyonlarda goreve eklenir\./);
});
