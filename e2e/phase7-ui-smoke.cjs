/**
 * Phase 7 smoke: watchtower sentinel surface.
 * 1. create wallet, verify the Watchtower panel renders LIVE daemon values
 *    (mode, scan height, sweep threshold, bounty, receipts),
 * 2. verify the breach history renders honestly (empty state OR real receipts),
 * 3. verify the sentinel alert banner appears only when a breach exists,
 * 4. verify the TruthRail keeps its watchtower summary row.
 * Read-only: no sends, no broadcasts, no state mutation beyond display.
 */
const { chromium } = require('@playwright/test');

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const URL = 'http://localhost:4444/';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await page.goto(URL, { waitUntil: 'networkidle' });

  await page.locator('textarea, input[type="text"]').first().fill(MNEMONIC);
  await page.getByRole('button', { name: /Create identity/ }).click();
  await page.waitForTimeout(9000);

  // === 1. Watchtower panel live values ===
  const panel = page.locator('.watchtower-panel');
  console.log('PANEL_PRESENT:', await panel.count());
  const mode = await page.locator('.watchtower-mode').innerText();
  console.log('MODE:', JSON.stringify(mode));
  const grid = (await page.locator('.watchtower-grid').innerText()).replace(/\n/g, ' | ');
  console.log('GRID:', JSON.stringify(grid.slice(0, 260)));

  // === 2. Breach history honest state ===
  const breachItems = await page.locator('.breach-item').count();
  const historyText = await page.locator('.watchtower-receipts').innerText();
  console.log('BREACH_ITEMS:', breachItems);
  console.log('HISTORY_STATE:', JSON.stringify(historyText.replace(/\n/g, ' | ').slice(0, 200)));

  // === 3. Sentinel alert only on breach ===
  console.log('SENTINEL_BANNER:', await page.locator('.sentinel-alert').count());

  // === 4. TruthRail watchtower summary still present ===
  // Phase 9 makes the rail collapsible (collapsed by default at mobile widths):
  // expand first so the summary rows are in the DOM snapshot.
  await page.locator('.truth-toggle').click();
  await page.waitForTimeout(400);
  const rail = await page.locator('.truth-rail').innerText();
  console.log('RAIL_HAS_WATCHTOWER:', rail.includes('Watchtower') ? 'yes' : 'NO');
  console.log('RAIL_HAS_RECEIPTS_ROW:', rail.includes('WT Receipts') ? 'yes' : 'NO');

  await page.screenshot({ path: '/tmp/p7-watchtower.png', fullPage: true });
  await browser.close();
  console.log('SMOKE_DONE');
})().catch(err => { console.error('SMOKE_FAIL:', err.message); process.exit(1); });
