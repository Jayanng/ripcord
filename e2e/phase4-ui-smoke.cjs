/**
 * Phase 4 UI smoke: drive the REAL built wallet and prove the dual-path exit
 * console works against the live daemon:
 *  1. recover Alice's identity (the UI's own recover flow),
 *  2. open the Exit screen: both panels render (cooperative + unilateral),
 *  3. run "Assess refund (dry run)" and verify REAL values render,
 *  4. verify the unilateral "Verify Exit Path (Dry Run)" naming + banner.
 * Assessment is a pure dry run: this smoke never broadcasts anything.
 */
const { chromium } = require('@playwright/test');

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const URL = 'http://localhost:4444/';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await page.goto(URL, { waitUntil: 'networkidle' });

  // Recover tab -> paste mnemonic -> recover
  await page.getByRole('button', { name: /Recover wallet/ }).click();
  await page.locator('textarea, input[type="text"]').first().fill(MNEMONIC);
  const recoverBtn = page.getByRole('button', { name: /Recover|Restore|Import/i }).last();
  await recoverBtn.click();
  await page.waitForTimeout(6000);

  // Exit screen
  await page.getByRole('button', { name: 'Exit', exact: true }).click();
  await page.waitForTimeout(2500);
  const body = await page.locator('body').innerText();
  console.log('CONSOLE_HEADLINE:', /Two ways out/.test(body) ? 'present' : 'MISSING');
  console.log('REFUND_PANEL:', /Fast refund/.test(body) ? 'present' : 'MISSING');
  console.log('UNILATERAL_PANEL:', /Ripcord/.test(body) ? 'present' : 'MISSING');
  console.log('NEW_DRYRUN_NAME:', /Verify Exit Path \(Dry Run\)/.test(body) ? 'present' : 'MISSING');
  console.log('OLD_TESTPULL_NAME:', /Run test-pull/.test(body) ? 'STILL PRESENT' : 'gone');

  // Assess refund (dry run) on the active vault
  const assessBtn = page.getByRole('button', { name: /Assess refund/ });
  if (await assessBtn.count()) {
    await assessBtn.click();
    await page.waitForTimeout(9000);
    const after = await page.locator('body').innerText();
    const valueLine = after.split('\n').filter(l => /Refund value|Network fee|sats|ready|unfunded|spent|Assess/i.test(l)).slice(0, 14);
    console.log('AFTER_ASSESS_LINES:', JSON.stringify(valueLine));
    console.log('QUORUM_READY_STATE:', /QUORUM READY/.test(after) ? 'present' : 'absent');
    await page.screenshot({ path: '/tmp/p4-exit-console.png', fullPage: true });
    console.log('SCREENSHOT: /tmp/p4-exit-console.png');
  } else {
    console.log('ASSESS_BUTTON: MISSING');
  }

  // Unilateral dry run naming check on the ripcord panel
  const verifyBtn = page.getByRole('button', { name: /Verify Exit Path/ });
  console.log('VERIFY_BUTTON_COUNT:', await verifyBtn.count());

  await browser.close();
})().catch(e => { console.error('SMOKE_FAIL:', e.message); process.exit(1); });
