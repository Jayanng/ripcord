/**
 * Phase 9 smoke: onboarding UX + mobile polish (two fixtures).
 * PAGE A (generated phrase -> unfunded vault):
 *   1. chip grid + hide/reveal + 3-word backup challenge (blocked without,
 *      wrong answers blocked, correct answers pass, manual edit clears it),
 *   2. CSV advanced field visible + editable,
 *   3. skeletons while the first VTXO snapshot is in flight,
 *   4. TruthRail collapsed on mobile, toggles open,
 *   5. tap-to-refresh updates the timestamp,
 *   6. register on the unfunded vault -> honest error + Retry (#24).
 * PAGE B (Alice's funded phrase):
 *   7. a REAL send renders the animated receipt card (#25).
 */
const { chromium } = require('@playwright/test');

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const BOB_MNEMONIC = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
const URL = 'http://localhost:4444/';

(async () => {
  const { deriveIdentity } = await import('@ripcord/core/keys');
  const bob = deriveIdentity(BOB_MNEMONIC, 'regtest', 0);

  const browser = await chromium.launch();

  // ================= PAGE A: generated phrase (unfunded) =================
  const pageA = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await pageA.route('**/tachi_*', async route => {
    await new Promise(r => setTimeout(r, 3500));
    try { await route.continue(); } catch { /* page moved on */ }
  });
  await pageA.goto(URL, { waitUntil: 'domcontentloaded' });
  await pageA.waitForTimeout(1500);

  // === 1. generated phrase: chips, reveal, challenge ===
  await pageA.getByRole('button', { name: /Generate a new recovery phrase/ }).click();
  await pageA.waitForTimeout(600);
  console.log('CHIPS:', await pageA.locator('.mnemonic-chip').count());
  console.log('CHALLENGE_FIELDS:', await pageA.locator('.backup-challenge-field').count());
  console.log('CREATE_BLOCKED_WITHOUT_CHALLENGE:', (await pageA.getByRole('button', { name: /Verify the backup check|Create identity/ }).isDisabled()) ? 'yes' : 'NO');

  await pageA.getByRole('button', { name: 'Hide words' }).click();
  await pageA.waitForTimeout(300);
  const hiddenWord = await pageA.locator('.chip-word').first().innerText();
  console.log('HIDE_WORKS:', hiddenWord.includes('•') ? 'yes' : `NO(${hiddenWord})`);
  await pageA.getByRole('button', { name: 'Reveal words' }).click();
  await pageA.waitForTimeout(300);

  const chipWords = await pageA.locator('.chip-word').allInnerTexts();
  const fields = pageA.locator('.backup-challenge-field');
  for (let i = 0; i < 3; i++) await fields.nth(i).locator('input').fill('wrongword');
  await pageA.waitForTimeout(300);
  console.log('WRONG_ANSWER_STATE:', (await pageA.getByRole('button', { name: /Verify the backup check/ }).isDisabled()) ? 'blocked' : 'NOT-BLOCKED');
  for (let i = 0; i < 3; i++) {
    const label = await fields.nth(i).locator('span').innerText();
    const position = Number(label.replace(/\D/g, '')) - 1;
    await fields.nth(i).locator('input').fill(chipWords[position]);
  }
  await pageA.waitForTimeout(300);
  console.log('CHALLENGE_PASSED:', (await pageA.locator('.backup-challenge .flow-note').count()) ? 'yes' : 'NO');
  console.log('CREATE_ENABLED:', (await pageA.getByRole('button', { name: /Create identity and vault/ }).isEnabled()) ? 'yes' : 'NO');

  // === 2. CSV field ===
  const csvField = pageA.locator('.advanced-field', { hasText: 'CSV timelock' });
  console.log('CSV_FIELD:', await csvField.count());
  await csvField.locator('input').fill('3');
  console.log('CSV_EDITABLE:', (await csvField.locator('input').inputValue()) === '3' ? 'yes' : 'NO');
  await csvField.locator('input').fill('2');

  // create with the generated phrase (challenge solved)
  await pageA.getByRole('button', { name: /Create identity and vault/ }).click();

  // === 3. skeletons while the first snapshot is in flight ===
  let maxSkeletons = 0;
  for (let i = 0; i < 24; i++) {
    await pageA.waitForTimeout(500);
    maxSkeletons = Math.max(maxSkeletons, await pageA.locator('.skeleton-line').count());
  }
  console.log('SKELETONS_DURING_FIRST_LOAD:', maxSkeletons);
  await pageA.unroute('**/tachi_*');
  await pageA.waitForTimeout(6000);

  // === 4. TruthRail collapse on mobile ===
  console.log('RAIL_COLLAPSED_ON_MOBILE:', (await pageA.locator('.truth-rail dl').count()) === 0 ? 'yes' : 'NO');
  await pageA.locator('.truth-toggle').click();
  await pageA.waitForTimeout(400);
  console.log('RAIL_EXPANDS:', (await pageA.locator('.truth-rail dl').count()) === 1 ? 'yes' : 'NO');

  // === 5. tap-to-refresh updates the timestamp ===
  const before = await pageA.locator('.truth-rail .truth-updated').innerText();
  // both the custody split and Chain Truth have their own tap-to-refresh (#23)
  await pageA.locator('.truth-rail .refresh').click();
  let after = before;
  for (let i = 0; i < 30 && after === before; i++) {
    await pageA.waitForTimeout(1000);
    after = await pageA.locator('.truth-rail .truth-updated').innerText();
  }
  console.log('REFRESH_UPDATES:', before !== after ? `yes (${before} -> ${after})` : `unchanged (${after})`);

  // === 6. register on the unfunded vault -> honest error + Retry (#24) ===
  await pageA.getByRole('tab', { name: 'Receive', exact: true }).click();
  await pageA.waitForTimeout(1200);
  await pageA.locator('.receive-mode-tab', { hasText: 'Vault address' }).click();
  await pageA.waitForTimeout(600);
  const registerBtn = pageA.getByRole('button', { name: /Check and register deposit/ });
  if (await registerBtn.count()) {
    await registerBtn.click();
    await pageA.waitForTimeout(9000);
    console.log('REGISTER_ERROR_RETRY:', (await pageA.getByRole('button', { name: 'Retry' }).count()) ? 'yes' : 'NO');
    console.log('REGISTER_ERROR_TEXT:', JSON.stringify((await pageA.locator('.register-deposit-card .inline-error').first().innerText().catch(() => '(none)')).slice(0, 110)));
  } else {
    console.log('REGISTER_ERROR_RETRY: no register button reachable');
  }
  await pageA.screenshot({ path: '/tmp/p9-page-a.png', fullPage: true });
  await pageA.close();

  // ================= PAGE B: Alice (funded) -> receipt card =================
  const pageB = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await pageB.goto(URL, { waitUntil: 'networkidle' });
  await pageB.locator('textarea').first().fill(MNEMONIC); // hand-entered: no challenge
  await pageB.waitForTimeout(300);
  console.log('HAND_ENTERED_NO_CHALLENGE:', (await pageB.locator('.backup-challenge').count()) === 0 ? 'yes' : 'NO');
  await pageB.getByRole('button', { name: /Create identity and vault/ }).click();
  await pageB.waitForTimeout(9000);

  // === 7. real send -> animated receipt card (#25) ===
  await pageB.locator('.subnav-btn', { hasText: 'Send' }).first().click();
  await pageB.waitForTimeout(1200);
  await pageB.locator('#send-recipient').fill(bob.userAddress);
  await pageB.locator('#send-amount').fill('1000');
  await pageB.getByRole('button', { name: /Review and send/ }).click();
  await pageB.waitForTimeout(1500);
  if (await pageB.locator('.send-safety-card').count()) {
    await pageB.getByRole('button', { name: /Confirm and send/ }).click();
    try {
      await pageB.locator('.send-receipt').first().waitFor({ timeout: 90000 });
      console.log('RECEIPT_CARD: yes');
      console.log('RECEIPT_TEXT:', JSON.stringify((await pageB.locator('.send-receipt').innerText()).replace(/\n/g, ' | ').slice(0, 130)));
    } catch {
      console.log('RECEIPT_CARD: not observed (send did not commit in window)');
    }
  } else {
    console.log('RECEIPT_CARD: review not open (no balance)');
  }
  await pageB.screenshot({ path: '/tmp/p9-page-b.png', fullPage: true });
  await browser.close();
  console.log('SMOKE_DONE');
})().catch(err => { console.error('SMOKE_FAIL:', err.message); process.exit(1); });
