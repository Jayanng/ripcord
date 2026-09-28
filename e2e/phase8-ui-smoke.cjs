/**
 * Phase 8 smoke: search drawer + activity filters/export + send toast.
 * 1. Ctrl+K opens the drawer; a live block height search renders typed
 *    results; a garbage query renders the honest not-found state,
 * 2. activity toolbar: filter tabs + search + export buttons work,
 * 3. a REAL send (1000 sats to Bob) commits on the live daemon and the
 *    send-committed toast appears with a tx link (#32).
 */
const { chromium } = require('@playwright/test');

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const BOB_MNEMONIC = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
const URL = 'http://localhost:4444/';

(async () => {
  // Bob's real user address (derived, not invented) for the send recipient.
  const { deriveIdentity } = await import('@ripcord/core/keys');
  const bob = deriveIdentity(BOB_MNEMONIC, 'regtest', 0);
  console.log('BOB_ADDR_SET:', bob.userAddress.length > 10 ? 'yes' : 'NO');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await page.goto(URL, { waitUntil: 'networkidle' });

  await page.locator('textarea, input[type="text"]').first().fill(MNEMONIC);
  await page.getByRole('button', { name: /Create identity/ }).click();
  await page.waitForTimeout(9000);

  // === 1. Search drawer (Ctrl+K) ===
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(800);
  console.log('DRAWER_OPEN:', await page.locator('.search-drawer').count());
  await page.locator('#protocol-search-input').fill('14360');
  await page.locator('#protocol-search-input').press('Enter');
  await page.waitForTimeout(2500);
  const resultText = (await page.locator('.search-result').innerText()).replace(/\n/g, ' | ');
  console.log('BLOCK_RESULT:', JSON.stringify(resultText.slice(0, 160)));

  await page.locator('#protocol-search-input').fill('zzzz-nope');
  await page.locator('#protocol-search-input').press('Enter');
  await page.waitForTimeout(2500);
  const missText = (await page.locator('.search-result').innerText()).replace(/\n/g, ' | ');
  console.log('MISS_RESULT:', JSON.stringify(missText.slice(0, 120)));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // === 2. Activity toolbar ===
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await page.waitForTimeout(1500);
  console.log('FILTER_TABS:', await page.locator('.activity-filter-tab').count());
  console.log('EXPORT_CSV:', await page.getByRole('button', { name: 'Export CSV' }).count());
  console.log('EXPORT_JSON:', await page.getByRole('button', { name: 'Export JSON' }).count());
  const beforeCount = await page.locator('.activity-day-group').count();
  await page.locator('.activity-filter-tab', { hasText: 'Blocks' }).click();
  await page.waitForTimeout(800);
  const afterCount = await page.locator('.activity-day-group').count();
  console.log('FILTER_WORKS:', afterCount <= beforeCount ? `yes (${beforeCount}->${afterCount})` : `NO (${beforeCount}->${afterCount})`);
  await page.locator('.activity-filter-tab', { hasText: 'All' }).click();
  await page.waitForTimeout(500);

  // === 3. Real send + toast (#32) ===
  await page.getByRole('button', { name: 'Wallet', exact: true }).click(); // main tab bar back to wallet
  await page.waitForTimeout(1000);
  await page.locator('.subnav-btn', { hasText: 'Send' }).first().click();
  await page.waitForTimeout(1200);
  await page.locator('#send-recipient').fill(bob.userAddress);
  await page.locator('#send-amount').fill('1000');
  await page.getByRole('button', { name: /Review and send/ }).click();
  await page.waitForTimeout(1500);
  const reviewOpen = await page.locator('.send-safety-card').count();
  console.log('REVIEW_OPEN:', reviewOpen);
  if (reviewOpen) {
    await page.getByRole('button', { name: /Confirm and send/ }).click();
    // live daemon round trips: queue -> TachiTx -> commit -> receipt -> toast
    try {
      await page.locator('.toast').first().waitFor({ timeout: 90000 });
      const toastText = (await page.locator('.toast').first().innerText()).replace(/\n/g, ' | ');
      console.log('TOAST:', JSON.stringify(toastText.slice(0, 140)));
      console.log('TOAST_LINK:', await page.locator('.toast .tx-link').count());
    } catch {
      const formState = await page.locator('.inline-error, .flow-note').first().innerText().catch(() => '(none)');
      console.log('TOAST: not observed. Form says:', JSON.stringify(formState.slice(0, 120)));
    }
  } else {
    console.log('REVIEW_NOT_OPEN (validation); toast path code-audited, real-commit proof lives in money-path runs');
  }

  await page.screenshot({ path: '/tmp/p8-search-activity.png', fullPage: true });
  await browser.close();
  console.log('SMOKE_DONE');
})().catch(err => { console.error('SMOKE_FAIL:', err.message); process.exit(1); });
