import { describe, it, expect } from 'vitest';
import { joinDaemonUrl, describeDaemonFailure } from '../src/net.js';

/**
 * These are pure-function tests (no network, no mocks, no fixtures): they lock
 * the two failure classes found live on 2026-09-27.
 *
 * 1. URL-join trap: `new URL('/health', 'https://host/proxy')` silently drops
 *    the base path and produces `https://host/health`. Ripcord joins by string
 *    concat so path-prefixed bases survive.
 * 2. Failure diagnosis: the deployed wallet showed bare "Failed to fetch" and
 *    silent 404s for what was a hosting/proxy misconfiguration. Diagnosis must
 *    name the cause and the fix.
 */
describe('joinDaemonUrl', () => {
  it('preserves a base path prefix (the new URL() trap regression)', () => {
    expect(joinDaemonUrl('https://host/proxy', 'tachi_validatorsPower')).toBe(
      'https://host/proxy/tachi_validatorsPower',
    );
    // The dropped-path behaviour this guards against, documented in place:
    expect(new URL('/tachi_validatorsPower', 'https://host/proxy').href).toBe(
      'https://host/tachi_validatorsPower',
    );
  });

  it('tolerates trailing and leading slashes on both sides', () => {
    expect(joinDaemonUrl('https://host/', '/health')).toBe('https://host/health');
    expect(joinDaemonUrl('https://host///', '///tachi_tx')).toBe('https://host/tachi_tx');
    expect(joinDaemonUrl('https://host', '')).toBe('https://host/');
  });

  it('keeps nested daemon paths intact', () => {
    expect(joinDaemonUrl('https://host/proxy/', 'tachi_validators/live')).toBe(
      'https://host/proxy/tachi_validators/live',
    );
  });
});

describe('describeDaemonFailure', () => {
  it('explains a 404 on daemon plumbing paths (host is not proxying)', () => {
    const out = describeDaemonFailure(new Error('HTTP 404 from https://host/tachi_nodeInfo'), {
      url: 'https://host/tachi_nodeInfo',
      method: 'GET',
    });
    expect(out).toContain('404');
    expect(out).toContain('not proxying');
    expect(out).toContain('docs/DEPLOYMENT.md');
  });

  it('does not mislabel the application-level /tachi_tx "transaction not found" 404', () => {
    const out = describeDaemonFailure(new Error('HTTP 404 from https://host/tachi_tx'), {
      url: 'https://host/tachi_tx?hash=ab',
      method: 'GET',
    });
    expect(out).not.toContain('not proxying');
    expect(out).toContain('404');
  });

  it('diagnoses a POST "Failed to fetch" as the daemon CORS gap', () => {
    const out = describeDaemonFailure(new TypeError('Failed to fetch'), {
      url: 'https://host/tachi_txBroadcastSync',
      method: 'POST',
    });
    expect(out).toContain('CORS');
    expect(out).toContain('same-origin proxy');
    expect(out).toContain('docs/DEPLOYMENT.md');
  });

  it('diagnoses a GET "Failed to fetch" as an outage, not CORS', () => {
    const out = describeDaemonFailure(new TypeError('Failed to fetch'), {
      url: 'https://host/tachi_validatorsPower',
      method: 'GET',
    });
    expect(out).toContain('did not answer');
    expect(out).not.toContain('does not send CORS headers on POSTs');
  });

  it('names timeout causes', () => {
    const out = describeDaemonFailure(new DOMException('The operation was aborted', 'AbortError'), {
      method: 'GET',
    });
    expect(out).toContain('did not answer in time');
  });

  it('passes through unrelated errors unchanged', () => {
    expect(describeDaemonFailure(new Error('Expected threshold 5, got 4'))).toBe(
      'Expected threshold 5, got 4',
    );
    expect(describeDaemonFailure('plain string')).toBe('plain string');
    expect(describeDaemonFailure(undefined)).toBe('unknown error');
  });
});
