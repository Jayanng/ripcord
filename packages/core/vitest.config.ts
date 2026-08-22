import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Live tests share Alice/Bob VTXOs and the Bitcoin RPC scantxoutset lock.
    // Parallel files double-spend (code=5) and abort in-flight scans.
    fileParallelism: false,
  },
});
