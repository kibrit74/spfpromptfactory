import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const landingFiles = ['index.html', 'landing.html'];

for (const file of landingFiles) {
  test(`${file} pricing section uses credit packages`, () => {
    const html = fs.readFileSync(file, 'utf8');
    const pricingSection = html.match(/<section id="pricing"[\s\S]*?<\/section>/)?.[0] || '';

    assert.match(pricingSection, /Free[\s\S]*10 kredi/);
    assert.match(pricingSection, /Starter[\s\S]*\$5[\s\S]*50 kredi/);
    assert.match(pricingSection, /Builder[\s\S]*\$12[\s\S]*150 kredi/);
    assert.match(pricingSection, /Pro[\s\S]*\$25[\s\S]*400 kredi/);
    assert.match(pricingSection, /Prompt uretimi 5 kredi/);
    assert.match(pricingSection, /Analiz 1 kredi/);
    assert.doesNotMatch(pricingSection, /\$19|\$99|Ayl/);
    assert.doesNotMatch(pricingSection, /Sinirsiz prompt|S.n.rs.z prompt|10 prompt \/ g/);
  });
}
