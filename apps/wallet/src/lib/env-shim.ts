// Vendor env override shim (explorer rewire 2026-10-03).
//
// The Tachi wallet-aggregator vendor package computes its network config at
// module load time via readEnv("TAURUS_REGTEST_EXPLORER"), falling back to the
// retired explorer (explorer-regtest.tachibtc.com, dead behind Cloudflare 526).
// In a browser build `process` is undefined, so that dead fallback was the live
// value. This shim must be the FIRST import of the app entry so it runs before
// any vendor chunk evaluates.

const g = globalThis as { process?: { env: Record<string, string | undefined> } };
g.process ??= { env: {} };
g.process.env ??= {};
g.process.env.TAURUS_REGTEST_EXPLORER ??= 'https://regtest.tachibtcscan.com';

export {};
