#!/usr/bin/env bash
set -euo pipefail

echo "Checking architecture rules..."

# Rule 1 & Rule 2: No full unindexed chain scans (R2) or finalized PSBT on send (R3)
if grep -rnE "addressTransactions|listTransactions|finalizeVtxoPsbt" packages/ apps/ 2>/dev/null | grep -v "test/" | grep -v "dist/"; then
  echo "ERROR: Found forbidden API call in packages/ or apps/"
  exit 1
fi

# Rule 2: apps/wallet must not import @tachibtc/* directly (layering enforcement)
if [ -d "apps/wallet/src" ]; then
  if grep -rnE "@tachibtc/" apps/wallet/src/ 2>/dev/null; then
    echo "ERROR: Found direct @tachibtc/* import in apps/wallet/src/"
    exit 1
  fi
fi

echo "All architecture rules passed."
