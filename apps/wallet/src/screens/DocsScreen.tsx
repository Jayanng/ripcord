import { useEffect } from 'react';

/**
 * Phase 1: Docs have moved to the standalone /docs page outside the wallet shell.
 * This screen redirects any deep-linked callers to /docs.
 */
export function DocsScreen() {
  useEffect(() => {
    // Round 8B-5: the standalone /docs page is regtest-era product docs and is
    // NOT served on the signet deployment (the signet deploy strips it). Point
    // signet-build visitors at the repo README, which documents both networks.
    const isSignetHost = window.location.host.includes('ripcord-signet');
    window.location.replace(isSignetHost
      ? 'https://github.com/Jayanng/ripcord#readme'
      : '/docs' + (window.location.hash ? window.location.hash : ''));
  }, []);

  return (
    <div className="docs-redirect" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
      <p>Redirecting to <a href="/docs" style={{ color: 'var(--primary)', fontWeight: 600 }}>Ripcord Documentation</a>...</p>
    </div>
  );
}
