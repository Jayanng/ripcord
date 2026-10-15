/**
 * Comfortable funding bar (2026-10-16): the vault deposit target drops from
 * 40,000 to 10,000 sats, and a wallet that cannot cover target + fee still
 * opens a vault with whatever fits (down to a floor). The SDK's coin check
 * throws InsufficientFundsError(available, required) where
 * required = requested + feeEstimate; the fit is available - feeEstimate.
 * Pure logic only; no daemon.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_VAULT_DEPOSIT_SATS, MIN_VAULT_DEPOSIT_SATS, fitDepositToAvailable } from '../src/deposit.js';

describe('DEFAULT_VAULT_DEPOSIT_SATS', () => {
  it('is the 10,000-sat comfortable target', () => {
    expect(DEFAULT_VAULT_DEPOSIT_SATS).toBe(10_000n);
  });
});

describe('fitDepositToAvailable', () => {
  it('fits an exactly-target-funded wallet down to target minus the fee', () => {
    // The live failure that started this: wallet holds exactly the target,
    // SDK requires target + 282 fee. Fitted = available - fee.
    expect(fitDepositToAvailable(10_000n, 10_000n, 10_282n)).toBe(9_718n);
    expect(fitDepositToAvailable(40_000n, 40_000n, 40_282n)).toBe(39_718n);
  });

  it('fits an under-target wallet down to what it can cover', () => {
    expect(fitDepositToAvailable(5_000n, 10_000n, 10_282n)).toBe(4_718n);
  });

  it('accepts exactly the floor but refuses below it', () => {
    expect(fitDepositToAvailable(MIN_VAULT_DEPOSIT_SATS + 282n, 10_000n, 10_282n)).toBe(MIN_VAULT_DEPOSIT_SATS);
    expect(fitDepositToAvailable(MIN_VAULT_DEPOSIT_SATS + 281n, 10_000n, 10_282n)).toBeNull();
    expect(fitDepositToAvailable(0n, 10_000n, 10_282n)).toBeNull();
  });

  it('refuses malformed requirements instead of guessing a fee', () => {
    expect(fitDepositToAvailable(10_000n, 10_000n, 10_000n)).toBeNull(); // no fee line
    expect(fitDepositToAvailable(10_000n, 10_000n, 9_000n)).toBeNull(); // negative fee
    expect(fitDepositToAvailable(50_000n, 10_000n, 10_282n)).toBeNull(); // fitted >= requested: nothing to fit
  });

  it('keeps the floor above the SDK dust threshold and the protocol fee line', () => {
    expect(MIN_VAULT_DEPOSIT_SATS > 1_000n).toBe(true); // SAFE_DUST_THRESHOLD_SATS
    expect(MIN_VAULT_DEPOSIT_SATS > 330n).toBe(true); // daemon to_local floor
    expect(MIN_VAULT_DEPOSIT_SATS > 2n).toBe(true); // mint + registration fees
  });
});
