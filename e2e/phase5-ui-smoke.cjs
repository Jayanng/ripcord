/**
 * Phase 5 smoke v3: real multi-vault through the app's own flows.
 * 1. create wallet (vault A at index 0),
 * 2. "+ Start another deposit round" (vault B derived + selected),
 * 3. verify 2 distinct chips (same address, distinct record keys!) + switching.
 * Read-only beyond ordinary vault derivation; nothing is funded or broadcast.
 */
const { chromium } = require('@playwright/test');

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const URL = 'http://localhost:4444/';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await page.goto(URL, { waitUntil: 'networkidle' });

  // create wallet at the default index (the Create tab is the default view)
  await page.locator('textarea, input[type="text"]').first().fill(MNEMONIC);
  await page.getByRole('button', { name: /Create identity/ }).click();
  await page.waitForTimeout(8000);

  // vault switcher on the wallet screen
  await page.getByRole('button', { name: 'Wallet', exact: true }).click();
  await page.waitForTimeout(2000);
  console.log('CHIPS_BEFORE:', await page.locator('.vault-chip:not(.vault-chip-add)').count());
  console.log('TOTALS_BEFORE:', (await page.locator('.vault-switcher-totals').innerText()).replace(/\n/g, ' '));

  // start another deposit round -> derived vault B selected
  await page.getByRole('button', { name: /Start another deposit round/ }).click();
  await page.waitForTimeout(6000);
  const chips = page.locator('.vault-chip:not(.vault-chip-add)');
  const count = await chips.count();
  console.log('CHIPS_AFTER:', count);
  console.log('TOTALS_AFTER:', (await page.locator('.vault-switcher-totals').innerText()).replace(/\n/g, ' '));

  if (count >= 2) {
    const chip1 = await chips.nth(1).innerText();
    await chips.nth(0).click();
    await page.waitForTimeout(800);
    const active = await page.locator('.vault-chip.active').first().innerText();
    console.log('SWITCH_WORKS:', active === (await chips.nth(0).innerText()) ? 'yes' : 'NO');
    console.log('CHIP_1_LABEL:', JSON.stringify(chip1.replace(/\n/g, ' | ')));
    // both records show the same vault address but distinct identity (title has funding)
    const t0 = await chips.nth(0).getAttribute('title');
    const t1 = await chips.nth(1).getAttribute('title');
    console.log('SAME_ADDRESS_DISTINCT_RECORDS:', t0 === t1 ? 'titles equal (inspect)' : 'distinct titles');
    await page.screenshot({ path: '/tmp/p5-vault-switcher.png', fullPage: true });
    console.log('SCREENSHOT: /tmp/p5-vault-switcher.png');
  }
  await browser.close();
})().catch(e => { console.error('SMOKE_FAIL:', e.message); process.exit(1); });
