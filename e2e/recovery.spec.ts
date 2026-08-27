import { test, expect } from '@playwright/test';

const mnemonic = process.env.RIPCORD_E2E_MNEMONIC;
const keyIndex = process.env.RIPCORD_E2E_KEY_INDEX ?? '0';
const csv = process.env.RIPCORD_E2E_CSV ?? '2';

test.describe('live browser wipe recovery', () => {
  test.skip(!mnemonic, 'Set RIPCORD_E2E_MNEMONIC privately to run the live recovery journey.');

  test('recovers the funded vault after storage wipe', async ({ page, context }) => {
    test.setTimeout(240_000);
    await page.goto('/');
    await context.clearCookies();
    await page.evaluate(async () => { localStorage.clear(); for (const name of await indexedDB.databases()) if (name.name) indexedDB.deleteDatabase(name.name); });
    await page.reload();
    const recovery = page.locator('.recovery-screen');
    await recovery.getByLabel('12-word BIP-39 mnemonic').fill(mnemonic!);
    await recovery.getByLabel('Vault key index').fill(keyIndex);
    await recovery.getByLabel('CSV confirmations').fill(csv);
    await recovery.getByRole('button', { name: 'Start live recovery' }).click();
    await expect(page.getByText('Vault ready')).toBeVisible({ timeout: 180_000 });
    await expect(page.getByText(/Indexer connected/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/public records/)).toBeVisible();
    await expect(page.getByText(/OFF-CHAIN/)).toBeVisible();
  });
});
