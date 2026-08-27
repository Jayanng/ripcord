import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: process.env.RIPCORD_WALLET_URL ?? 'http://127.0.0.1:4173', trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  webServer: process.env.RIPCORD_WALLET_URL ? undefined : { command: 'npm.cmd run dev --workspace=apps/wallet -- --host 127.0.0.1 --port 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: true, timeout: 120_000 },
});
