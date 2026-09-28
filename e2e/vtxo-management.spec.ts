import { test, expect } from '@playwright/test';

const ALICE_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test.describe('VTXO Management View & Provenance Labels (PHASE 3)', () => {
  test('renders full inventory with multiple states and opens inspection detail sheet', async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);

    // 1. Clean browser state & navigate to root
    await page.goto('/');
    await context.clearCookies();
    await page.evaluate(async () => {
      localStorage.clear();
      for (const name of await indexedDB.databases()) {
        if (name.name) indexedDB.deleteDatabase(name.name);
      }
    });
    await page.reload();

    // 2. Open Recover wallet tab
    const recoverTab = page.getByRole('tab', { name: 'Recover wallet' });
    await expect(recoverTab).toBeVisible({ timeout: 15_000 });
    await recoverTab.click();

    // 3. Fill Alice's mnemonic & start recovery
    const recovery = page.locator('.recovery-screen');
    await recovery.getByLabel('12-word BIP-39 mnemonic').fill(ALICE_MNEMONIC);
    await recovery.getByRole('button', { name: 'Start live recovery' }).click();

    // 4. Wait for wallet to be ready and enter balance screen
    await expect(page.getByText('Vault ready')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/OFF-CHAIN · SPENDABLE NOW/)).toBeVisible({ timeout: 30_000 });

    // 5. Verify the "Your VTXOs" management section is rendered beneath custody split
    const vtxoSection = page.locator('.vtxo-management-card');
    await expect(vtxoSection).toBeVisible({ timeout: 20_000 });

    // 6. Verify section header and total count
    await expect(page.locator('#vtxo-section-title')).toContainText('Your VTXOs');
    await expect(page.locator('.vtxo-total-pill')).toBeVisible();

    // 7. Verify grouping and presence of 2+ real VTXOs of different states (Spendable & Spent)
    const spendableRows = vtxoSection.locator('.vtxo-row.spendable');
    const spentRows = vtxoSection.locator('.vtxo-row.spent');

    await expect(spendableRows.first()).toBeVisible({ timeout: 15_000 });
    await expect(spentRows.first()).toBeVisible({ timeout: 15_000 });

    const spendableCount = await spendableRows.count();
    const spentCount = await spentRows.count();
    console.log(`[TEST] Found ${spendableCount} spendable VTXOs and ${spentCount} spent VTXOs on Alice's wallet.`);
    expect(spendableCount).toBeGreaterThan(0);
    expect(spentCount).toBeGreaterThan(0);

    // 8. Inspect the first spendable row for required fields:
    //    truncated id, copy button, amount, state chip, provenance line
    const firstRow = spendableRows.first();
    await expect(firstRow.locator('.vtxo-id-text')).toBeVisible();
    await expect(firstRow.locator('.vtxo-copy-btn')).toBeVisible();
    await expect(firstRow.locator('.vtxo-amount')).toBeVisible();
    await expect(firstRow.locator('.vtxo-state-chip')).toContainText('Spendable');
    await expect(firstRow.locator('.vtxo-provenance-text')).toBeVisible();

    const provText = await firstRow.locator('.vtxo-provenance-text').textContent();
    console.log(`[TEST] First row provenance line: "${provText}"`);
    expect(provText).toMatch(/(Deposit #\d+|Received)/);

    // 9. Click the first row to open the VtxoDetailSheet
    await firstRow.click();

    // 10. Verify VtxoDetailSheet modal is open and has all required inspection fields
    const detailSheet = page.locator('.vtxo-detail-sheet');
    await expect(detailSheet).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#vtxo-detail-title')).toHaveText('VTXO Details');

    // Verify fields in detail sheet
    await expect(detailSheet.locator('.vtxo-detail-amount strong')).toBeVisible();
    await expect(detailSheet.locator('.vtxo-detail-item', { hasText: 'VTXO ID' })).toBeVisible();
    await expect(detailSheet.locator('.vtxo-detail-item', { hasText: 'Owner' })).toBeVisible();
    await expect(detailSheet.locator('.proof-step', { hasText: 'Provenance' })).toBeVisible();
    await expect(detailSheet.locator('.proof-step', { hasText: 'Creation Epoch / Height' })).toBeVisible();
    await expect(detailSheet.locator('.proof-step', { hasText: 'Lock Status' })).toBeVisible();
    await expect(detailSheet.locator('.proof-step', { hasText: 'L1 Anchor' })).toBeVisible();
    await expect(detailSheet.getByRole('link', { name: /View in Regtest Explorer/i })).toBeVisible();

    // 11. Save screenshot and DOM capture for evidence
    await page.screenshot({ path: 'e2e/vtxo-inventory-detail.png', fullPage: true });
    await page.screenshot({ path: 'e2e/vtxo-inventory-detail-viewport.png', fullPage: false });
    console.log('[TEST] Captured screenshots at e2e/vtxo-inventory-detail.png and e2e/vtxo-inventory-detail-viewport.png');

    // Capture DOM of detail sheet and top VTXO rows
    const detailHtml = await detailSheet.evaluate(el => el.outerHTML);
    const rowHtml = await firstRow.evaluate(el => el.outerHTML);
    const spentRowHtml = await spentRows.first().evaluate(el => el.outerHTML);
    const fs = await import('fs');
    fs.writeFileSync('/tmp/vtxo_dom_evidence.txt', `=== SPENDABLE ROW ===\n${rowHtml}\n\n=== SPENT ROW ===\n${spentRowHtml}\n\n=== DETAIL SHEET ===\n${detailHtml}\n`);
    console.log('[TEST] Wrote DOM evidence to /tmp/vtxo_dom_evidence.txt');

    // 12. Close detail sheet and verify it dismisses cleanly
    await detailSheet.getByLabel('Close details').click();
    await expect(detailSheet).not.toBeVisible();
  });
});
