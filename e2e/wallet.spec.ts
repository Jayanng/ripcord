import { test, expect } from '@playwright/test';

test.describe('wallet smoke journey', () => {
  test('loads the honest empty or recovered wallet surface', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Ripcord home' })).toBeVisible();
    await expect(page.getByText(/regtest/i).first()).toBeVisible();
  });
});
