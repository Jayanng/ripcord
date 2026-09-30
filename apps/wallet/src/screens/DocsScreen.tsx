import { useEffect } from 'react';

/**
 * Phase 1: Docs have moved to the standalone /docs page outside the wallet shell.
 * This screen redirects any deep-linked callers to /docs.
 */
export function DocsScreen() {
  useEffect(() => {
    window.location.replace('/docs' + (window.location.hash ? window.location.hash : ''));
  }, []);

  return (
    <div className="docs-redirect" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
      <p>Redirecting to <a href="/docs" style={{ color: 'var(--primary)', fontWeight: 600 }}>Ripcord Documentation</a>...</p>
    </div>
  );
}
