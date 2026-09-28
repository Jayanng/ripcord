/**
 * Phase 10 smoke: trust extras.
 * PAGE A: theme toggle persists (dark), security chip in topbar, and a REAL
 *   recovery run showing the progress banner with live counts (#30).
 * PAGE B: create Alice -> proof badges in balance hero (#27) -> REAL send ->
 *   open the proof sheet -> chain diagram nodes + Export Proof JSON (#20).
 */
const { chromium } = require('@playwright/test');

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const BOB_MNEMONIC = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
const URL = 'http://localhost:4444/';

(async () => {
  const { deriveIdentity } = await import('@ripcord/core/keys');
  const bob = deriveIdentity(BOB_MNEMONIC, 'regtest', 0);
  const browser = await chromium.launch();

  // ================= PAGE A: theme, security chip, recovery banner =================
  // separate contexts: the recovery run must not pollute page B's fresh create
  const contextA = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const pageA = await contextA.newPage();
  await pageA.goto(URL, { waitUntil: 'networkidle' });

  // === theme toggle (#31) ===
  const themeBefore = await pageA.evaluate(() => document.documentElement.dataset.theme || 'light');
  await pageA.getByRole('button', { name: /Switch to dark theme/ }).click();
  await pageA.waitForTimeout(400);
  const themeAfter = await pageA.evaluate(() => document.documentElement.dataset.theme);
  console.log('DARK_MODE_APPLIES:', themeAfter === 'dark' ? 'yes' : `NO(${themeAfter})`);
  await pageA.reload({ waitUntil: 'networkidle' });
  const themePersisted = await pageA.evaluate(() => document.documentElement.dataset.theme);
  console.log('DARK_MODE_PERSISTS:', themePersisted === 'dark' ? 'yes' : `NO(${themePersisted})`);
  await pageA.getByRole('button', { name: /Switch to light theme/ }).click(); // back to light

  // === security chip (#29) ===
  console.log('SECURITY_CHIP:', await pageA.locator('.security-chip').count());
  console.log('SECURITY_CHIP_TEXT:', JSON.stringify((await pageA.locator('.security-chip').innerText()).trim()));

  // === recovery banner (#30) - real recovery run ===
  await pageA.goto(URL + '#/recover', { waitUntil: 'networkidle' });
  await pageA.waitForTimeout(800);
  await pageA.locator('textarea').first().fill(MNEMONIC);
  await pageA.getByRole('button', { name: /Start live recovery/ }).click();
  let bannerSeen = null;
  for (let i = 0; i < 400; i++) {
    await pageA.waitForTimeout(300);
    const banner = await pageA.locator('.recovery-banner').count();
    if (banner) {
      const text = (await pageA.locator('.recovery-banner').innerText()).replace(/\n/g, ' | ');
      if (!bannerSeen) bannerSeen = text;
      if (/\d+ of \d+ scanned/.test(text)) { bannerSeen = text; break; }
    }
    if ((await pageA.locator('.recovery-evidence').count()) > 0) break; // completed without catching banner
  }
  console.log('RECOVERY_BANNER:', bannerSeen ? JSON.stringify(bannerSeen.slice(0, 120)) : 'not observed');
  await pageA.screenshot({ path: '/tmp/p10-recovery.png', fullPage: true });
  await contextA.close();

  // ================= PAGE B: badges + proof diagram/export =================
  const contextB = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const pageB = await contextB.newPage();
  await pageB.goto(URL, { waitUntil: 'networkidle' });
  await pageB.locator('textarea').first().fill(MNEMONIC);
  await pageB.getByRole('button', { name: /Create identity and vault/ }).click();
  await pageB.waitForTimeout(9000);

  // === proof badges (#27) ===
  await pageB.locator('.proof-badge-row').waitFor({ timeout: 15000 });
  console.log('PROOF_BADGES:', await pageB.locator('.proof-badge').count());
  console.log('PROOF_BADGE_TEXT:', JSON.stringify((await pageB.locator('.proof-badge-row').innerText()).replace(/\n/g, ' | ').slice(0, 140)));
  // wait for the first VTXO snapshot so the send has a real balance
  await pageB.locator('.skeleton-line').first().waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
  await pageB.waitForTimeout(2500);

  // === real send -> receipt -> proof sheet (#20) ===
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
      console.log('SEND_COMMITTED: yes');
    } catch {
      console.log('SEND_COMMITTED: no');
    }
  } else {
    console.log('SEND_COMMITTED: review not open');
  }

  // open the proof from the activity feed (poll: the HAT proof is fetched
  // right after commit and flips the button enabled)
  await pageB.getByRole('button', { name: 'Activity', exact: true }).click();
  await pageB.waitForTimeout(2500);
  const enabledProof = pageB.locator('button', { hasText: 'View proof' }).and(pageB.locator(':not([disabled])'));
  for (let i = 0; i < 30 && (await enabledProof.count()) === 0; i++) {
    await pageB.waitForTimeout(1000);
  }
  if (await enabledProof.count()) {
    await enabledProof.first().click();
    await pageB.waitForTimeout(1200);
    console.log('PROOF_SHEET_OPEN:', await pageB.locator('.proof-sheet').count());
    console.log('DIAGRAM_NODES:', await pageB.locator('.proof-diagram-row .proof-node').count());
    console.log('PROVED_NODES:', await pageB.locator('.proof-node.proved').count());
    console.log('EXPORT_BUTTON:', await pageB.getByRole('button', { name: /Export Proof JSON/ }).count());
  } else {
    console.log('PROOF_SHEET_OPEN: no enabled proof button yet (proof fetch still in flight)');
    console.log('DIAGRAM_NODES: n/a');
    console.log('EXPORT_BUTTON: n/a');
  }
  await pageB.screenshot({ path: '/tmp/p10-proof.png', fullPage: true });
  await browser.close();
  console.log('SMOKE_DONE');
})().catch(err => { console.error('SMOKE_FAIL:', err.message); process.exit(1); });
