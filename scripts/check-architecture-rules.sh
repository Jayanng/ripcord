#!/usr/bin/env bash
set -euo pipefail

echo "Checking architecture rules..."
FAIL=0

# Only search directories that exist (apps/ arrives in the UI phase). A missing
# search path makes grep exit 2, which under pipefail silently disables the
# gate below it. Never grep a path that might not exist.
DIRS=(packages)
if [ -d apps ]; then DIRS+=(apps); fi

# Rule 1 & Rule 2: No full unindexed chain scans (R2) or finalized PSBT on send (R3)
if grep -rnE "addressTransactions|listTransactions|finalizeVtxoPsbt" "${DIRS[@]}" --exclude-dir=node_modules 2>/dev/null | grep -v "test/" | grep -v "dist/"; then
  echo "ERROR: Found forbidden API call in packages/ or apps/ (AGENTS.md Rule 4 / R2+R3)"
  FAIL=1
fi

# Rule 2: apps/wallet must not import @tachibtc/* directly (layering enforcement)
if [ -d "apps/wallet/src" ]; then
  if grep -rnE "@tachibtc/" apps/wallet/src/ --exclude-dir=node_modules 2>/dev/null; then
    echo "ERROR: Found direct @tachibtc/* import in apps/wallet/src/ (layering)"
    FAIL=1
  fi
fi

# HARD RULE (AGENTS.md Rule 2): zero mocks / simulations anywhere in packages/ or apps/
# (src AND test). Live daemon is the only verification path.
MOCK_PATTERN='vi\.mock|vi\.fn|jest\.mock|nock|msw|sinon|proxyquire|mockImplementation|mockReturnValue|mockResolvedValue|mockRejectedValue'
if grep -rnE "$MOCK_PATTERN" "${DIRS[@]}" --include='*.ts' --include='*.tsx' --exclude-dir=node_modules 2>/dev/null | grep -v "dist/"; then
  echo "ERROR: Mock/simulation API found (AGENTS.md Rule 2: live-only verification)."
  FAIL=1
fi

# HARD RULE (AGENTS.md Rule 2): no unconditional test skips (.skipIf is allowed).
if grep -rnE "\.skip\(" "${DIRS[@]}" --include='*.ts' --include='*.tsx' --exclude-dir=node_modules 2>/dev/null | grep -v "dist/"; then
  echo "ERROR: Unconditional .skip() found (AGENTS.md Rule 2: skips must be env-gated)."
  FAIL=1
fi

# Rule (net.ts / docs/DEPLOYMENT.md): never join daemon URLs with
# new URL('/path', base). An absolute path silently drops the base's path
# prefix (new URL('/health', 'https://host/proxy') -> https://host/health), the
# request 404s against the host root, and fetch RESOLVES on 404 so the failure
# is silent. Proven live 2026-09-27. Use joinDaemonUrl from src/net.ts.
if grep -rnE "new URL\(['\"]/" "${DIRS[@]}" --include='*.ts' --exclude-dir=node_modules 2>/dev/null | grep -v "test/"; then
  echo "ERROR: new URL('/path', base) drops base path prefixes; use joinDaemonUrl (packages/core/src/net.ts, docs/DEPLOYMENT.md)"
  FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
  echo "RULES FAILED."
  exit 1
fi

echo "All architecture rules passed."
