/**
 * Daemon URL joining and fetch-failure diagnosis.
 *
 * WHY THIS EXISTS (live debugging, 2026-09-27): two URL-join conventions meet
 * at runtime and one of them is a silent trap.
 *
 *   - `@tachibtc/taurus-vault-core` string-concats (`${baseUrl}/tachi_x`), so a
 *     path prefix on the base survives.
 *   - `@tachibtc/tachi-sdk-ts`'s `TachiClient` resolves with
 *     `new URL` with an absolute path like `/health` on `baseUrl`. Because
 *     that path is absolute the base's path is DROPPED: resolving
 *     `/health` against `https://host/proxy` yields `https://host/health`.
 *     The request then 404s against whatever the host
 *     serves at root (often the SPA shell) and `fetch` RESOLVES on 404, so
 *     nothing errors and the failure is silent.
 *
 * Ripcord therefore joins daemon URLs exactly one way (string concat via
 * `joinDaemonUrl`) and never hands a path-bearing base to the Tachi SDKs. That
 * also means a path-prefixed daemon mount (e.g. https://host/proxy) works
 * everywhere inside ripcord.
 *
 * The second trap is CORS: the public Tachi daemon answers cross-origin GETs
 * (it sends `access-control-allow-origin: *`) but NOT POSTs (verified live:
 * POST and OPTIONS carry no `access-control-*` headers at all). A browser
 * client therefore MUST reach daemon POSTs (tx broadcast, sign ceremony, the
 * bitcoind JSON-RPC proxy at `/`) through a same-origin proxy. Dev does this
 * via the Vite proxy, production via the deployment rewrites; both mirror the
 * same contract (see docs/DEPLOYMENT.md).
 *
 * `describeDaemonFailure` turns both traps into actionable text so a
 * misconfigured host fails LOUDLY with the fix in the message, instead of
 * silently showing zeros or a bare "Failed to fetch".
 */

/**
 * Join a daemon base URL and a path. Path-preserving and slash-tolerant.
 *
 * Never use `new URL(path, base)` for daemon paths: an absolute path drops the
 * base's path prefix (see the module comment).
 */
export function joinDaemonUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

const PROXY_HINT =
  'the host serving this app is not proxying the daemon paths (/health, /tachi_*, /rpc); see docs/DEPLOYMENT.md';

const CORS_HINT =
  'the Tachi daemon does not send CORS headers on POSTs, so in a browser daemon POSTs must go through a same-origin proxy (dev Vite proxy / deployment rewrites); see docs/DEPLOYMENT.md';

const NETWORK_HINT =
  'the daemon did not answer (down, DNS, or TLS); if it is up, the host serving this app is likely not proxying the daemon paths; see docs/DEPLOYMENT.md';

const TIMEOUT_HINT = 'the daemon did not answer in time; it may be slow or down';

/**
 * Enrich a raw fetch/daemon failure with the likely cause and its fix.
 *
 * Pure string/regex diagnosis: safe to use in UIs, tests, and logs. `context`
 * is optional; when `method` is known the POST/CORS diagnosis is exact, and
 * without it browser contexts still get both possibilities named.
 */
export function describeDaemonFailure(
  err: unknown,
  context: { url?: string; method?: string } = {},
): string {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : 'unknown error';
  const name = err instanceof Error ? err.name : '';
  const method = (context.method ?? '').toUpperCase();
  const where = `${context.url ?? ''} ${message}`;

  // Timeouts first: AbortSignal.timeout surfaces as AbortError/TimeoutError.
  if (name === 'AbortError' || name === 'TimeoutError' || /\b(timed? ?out|aborted)\b/i.test(message)) {
    return `${message}: ${TIMEOUT_HINT}`;
  }

  // Network-layer failures.
  if (name === 'TypeError' || /Failed to fetch|NetworkError|fetch failed|ENOTFOUND|ECONNREFUSED|getaddrinfo/i.test(message)) {
    if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
      return `${message}: ${CORS_HINT}`;
    }
    if (!method && typeof window !== 'undefined' && /Failed to fetch/i.test(message)) {
      // Browser-only branch (Node tests cannot reach it; exercised through the
      // wallet UI on the deployed site). Method unknown: name both real causes
      // instead of guessing.
      return `${message}: if this was a POST it was almost certainly CORS-blocked (the daemon only CORS-enables GETs), so daemon POSTs must go through a same-origin proxy (see docs/DEPLOYMENT.md); if it was a GET, ${NETWORK_HINT}`;
    }
    return `${message}: ${NETWORK_HINT}`;
  }

  // 404 on daemon plumbing paths means the host is not proxying them. The one
  // exception is /tachi_tx, whose 404 is an application-level "transaction not
  // found" (RipcordCode.TX_NOT_FOUND), not a routing problem.
  if (/\b404\b/.test(message) && !/\btachi_tx\b/.test(where)) {
    return `${message}: ${PROXY_HINT}`;
  }

  return message;
}
