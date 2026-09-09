import { useState, useEffect, useRef, type ReactNode } from 'react';
import { WhatYouDontManage } from '../components/WhatYouDontManage';

function CodeBlock({ code, title = 'TypeScript' }: { code: string; title?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code.trim());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="docs-code-block">
      <div className="docs-code-header">
        <span className="docs-code-title">{title}</span>
        <button type="button" className="docs-code-copy" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre><code>{code.trim()}</code></pre>
    </div>
  );
}

function PocketCallout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pocket-callout">
      <svg className="pocket-callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>
      </svg>
      <div className="pocket-callout-body">
        <h4 className="pocket-callout-title">{title}</h4>
        {children}
      </div>
    </div>
  );
}

interface NavItem {
  id: string;
  label: string;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    group: 'Introduction',
    items: [
      { id: 'overview', label: 'Overview' },
      { id: 'comparison', label: 'TAURUS vs. Lightning' },
    ],
  },
  {
    group: 'Getting Started',
    items: [
      { id: 'quickstart', label: 'Quick Start' },
      { id: 'installation', label: 'Installation' },
      { id: 'taproot', label: 'Deterministic Taproot Vaults' },
      { id: 'quorum', label: 'Quorum Discovery' },
    ],
  },
  {
    group: 'Concepts',
    items: [
      { id: 'nums', label: 'NUMS Unspendable Key' },
      { id: 'tapscript', label: 'Tapscript Tree Leaves' },
      { id: 'proofs', label: 'Inclusion Proofs (HAT & RIP)' },
      { id: 'ephemeral', label: 'RAM-Only Key Policy' },
      { id: 'coin-selection', label: 'VTXO Coin Selection' },
    ],
  },
  {
    group: 'Lifecycle & Exit',
    items: [
      { id: 'journey', label: 'Lifecycle (Steps 01-06)' },
      { id: 'ripcord-exit', label: 'Unilateral Ripcord Exit' },
      { id: 'timelocks', label: 'BIP68 Relative Timelocks' },
      { id: 'test-pull', label: 'Dry-Run Test-Pull Engine' },
      { id: 'recovery', label: 'Disaster Storage Wipe' },
    ],
  },
  {
    group: 'Developer & Specs',
    items: [
      { id: 'invariants', label: 'Security Invariants' },
      { id: 'sdk', label: '@ripcord/core SDK' },
      { id: 'sdk-examples', label: 'TypeScript Code Examples' },
      { id: 'sdk-subpaths', label: 'Exported Subpaths' },
      { id: 'satvm', label: 'SatVM Smart Contracts' },
      { id: 'specs', label: 'Network Specifications' },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap(g => g.items.map(item => ({ ...item, group: g.group })));

export function DocsScreen() {
  const [activeId, setActiveId] = useState('overview');
  const [search, setSearch] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.replace('#/docs#', '').replace('#/docs/', '').replace('#/docs', '').replace('#', '');
      if (hash && ALL_ITEMS.some(i => i.id === hash)) {
        setActiveId(hash);
      }
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  // Keyboard shortcut: pressing / or Ctrl+K focuses the search input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key === 'k')) && document.activeElement !== searchInputRef.current) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const scrollTo = (id: string) => {
    setActiveId(id);
    setMobileNavOpen(false);
    window.location.hash = `#/docs#${id}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const filteredGroups = NAV_GROUPS.map(grp => ({
    ...grp,
    items: grp.items.filter(item => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return item.label.toLowerCase().includes(q) || grp.group.toLowerCase().includes(q);
    }),
  })).filter(grp => grp.items.length > 0);

  // Determine current active item, group, previous and next pagination items
  const currentIndex = Math.max(0, ALL_ITEMS.findIndex(item => item.id === activeId));
  const currentItem = ALL_ITEMS[currentIndex] || ALL_ITEMS[0];
  const prevItem = currentIndex > 0 ? ALL_ITEMS[currentIndex - 1] : null;
  const nextItem = currentIndex < ALL_ITEMS.length - 1 ? ALL_ITEMS[currentIndex + 1] : null;

  const renderActiveDocument = () => {
    switch (activeId) {
      case 'overview':
        return (
          <>
            <div className="pocket-eyebrow-row">
              <a
                href="https://www.npmjs.com/package/@ripcord/core"
                target="_blank"
                rel="noreferrer"
                className="pocket-package-badge"
                title="View @ripcord/core v0.1.1 on npm"
              >
                <span className="pocket-package-dot" aria-hidden="true" />
                <span className="pocket-package-label">PACKAGE</span>
                <span className="pocket-package-version">V0.1.1</span>
              </a>
              <span className="pocket-eyebrow-sep">·</span>
              <span className="pocket-network-pill">TACHI REGTEST</span>
              <span className="pocket-eyebrow-sep">·</span>
              <a
                href="https://github.com/Jayanng/ripcord"
                target="_blank"
                rel="noreferrer"
                className="pocket-github-badge"
                title="View RIPCORD on GitHub"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                </svg>
                <span>GitHub</span>
              </a>
            </div>
            <h1 className="pocket-title">RIPCORD Protocol Documentation</h1>
            <p className="pocket-lede">
              Integrate self-custodial Bitcoin operations across the Tachi and TAURUS ecosystem via deterministic 5-of-7 Taproot vaults, spendable VTXOs, cryptographic inclusion proofs, and sovereign unilateral exits.
            </p>
            <p>
              RIPCORD is a verification-first custody architecture where every balance and settlement claim names its authoritative cryptographic source. Cooperative transfers offer instant, zero-fee off-chain settlement, while the on-chain Tapscript exit leaf guarantees that users can always reclaim their exact Bitcoin on L1 after the configured timelock expires without third-party permission.
            </p>

            <PocketCallout title="Choose your integration path">
              <ul className="pocket-callout-list">
                <li><strong>Self-Custodial Wallet UI</strong> — Full-featured self-custodial web application with real-time VTXO payments, proof receipts, and one-click hold-to-confirm exit engine.</li>
                <li><strong>@ripcord/core SDK</strong> — Standalone TypeScript package for key derivation, deterministic vault derivation, and payment commitments.</li>
                <li><strong>Tachi Consensus RPC</strong> — Direct interaction with 5-of-7 quorum validators and live WebSocket indexer streaming.</li>
              </ul>
            </PocketCallout>

            <div className="pocket-grid">
              <button type="button" className="pocket-card" onClick={() => scrollTo('quickstart')}>
                <h3 className="pocket-card-title">Quick Start</h3>
                <p className="pocket-card-desc">Generate ephemeral BIP-39 mnemonic, derive user keys, and verify live on-chain custody in 3 steps.</p>
              </button>

              <button type="button" className="pocket-card" onClick={() => scrollTo('taproot')}>
                <h3 className="pocket-card-title">Deterministic Vaults</h3>
                <p className="pocket-card-desc">Taproot P2TR script tree committing 5-of-7 validator quorum and unspendable NUMS internal key.</p>
              </button>

              <button type="button" className="pocket-card" onClick={() => scrollTo('coin-selection')}>
                <h3 className="pocket-card-title">Off-Chain VTXO Payments</h3>
                <p className="pocket-card-desc">Greedy coin selection, local spend reservations, single-writer serialization, and isolated change routing.</p>
              </button>

              <button type="button" className="pocket-card" onClick={() => scrollTo('proofs')}>
                <h3 className="pocket-card-title">Inclusion Proofs (HAT & RIP)</h3>
                <p className="pocket-card-desc">History Authenticity Tree note continuity checks and Rollup Inclusion Proof verification.</p>
              </button>

              <button type="button" className="pocket-card" onClick={() => scrollTo('ripcord-exit')}>
                <h3 className="pocket-card-title">Unilateral Ripcord Exit</h3>
                <p className="pocket-card-desc">BIP68 relative timelocks and dry-run test-pull engine allowing unconditional sweep to Bitcoin L1.</p>
              </button>

              <button type="button" className="pocket-card" onClick={() => scrollTo('recovery')}>
                <h3 className="pocket-card-title">Disaster Recovery</h3>
                <p className="pocket-card-desc">Complete wallet reconstruction from only 12 words after total browser storage wipe.</p>
              </button>
            </div>

            <p className="pocket-meta-footer">
              The platform ships with 252+ automated test assertions, ephemeral memory-only keys, per-transfer reservation locks, and real-time transaction confirmation streaming.
            </p>
            <p className="pocket-meta-footer">
              New to RIPCORD? Start with Quick Start, then read how deterministic vaults operate before executing write transactions.
            </p>
          </>
        );
      case 'comparison':
        return (
          <>
            <p className="pocket-eyebrow">TAURUS VS. LIGHTNING NETWORK</p>
            <h1 className="pocket-title">TAURUS vs. Lightning: Superior UX & Stronger Sovereignty</h1>
            <p className="pocket-lede">
              Tachi and TAURUS vaults deliver a superior user experience compared to the Lightning Network while providing stronger self-custody guarantees: zero channel management, no inbound liquidity bottlenecks, no force-closure penalties, and clean unilateral timelocked exits.
            </p>
            <WhatYouDontManage />
            <div className="docs-table-wrap" style={{ marginTop: '24px' }}>
              <table className="docs-table">
                <thead>
                  <tr>
                    <th>Custody Attribute</th>
                    <th>TAURUS Vaults (Tachi)</th>
                    <th>Lightning Network</th>
                    <th>Custodial Wallets / Rollups</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>Key Ownership</strong></td>
                    <td>User holds BIP-39 seed (RAM-only)</td>
                    <td>User holds private node keys</td>
                    <td>Operator holds private keys</td>
                  </tr>
                  <tr>
                    <td><strong>Channel Management</strong></td>
                    <td>None. Single vault backs arbitrary VTXOs</td>
                    <td>Manual channel capacity & rebalancing</td>
                    <td>None (centralized ledger)</td>
                  </tr>
                  <tr>
                    <td><strong>Inbound Liquidity</strong></td>
                    <td>Not a concept. Receive any amount</td>
                    <td>Requires inbound channel liquidity</td>
                    <td>Unlimited (centralized)</td>
                  </tr>
                  <tr>
                    <td><strong>Unilateral Exit</strong></td>
                    <td>Guaranteed via BIP68 timelock (CSV)</td>
                    <td>Force close with dispute penalty</td>
                    <td>None. Dependent on operator</td>
                  </tr>
                  <tr>
                    <td><strong>Watchtower Requirement</strong></td>
                    <td>None. Exit leaf requires only user signature</td>
                    <td>Mandatory to prevent old state fraud</td>
                    <td>None (trusted operator)</td>
                  </tr>
                  <tr>
                    <td><strong>Offline Receive</strong></td>
                    <td>Deterministic user P2TR addresses</td>
                    <td>Node must remain continuously online</td>
                    <td>Supported via custodial backend</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: '32px' }}>
              <h3>Why TAURUS Proves a Superior Second-Layer Model</h3>
              <p>
                The Lightning Network achieved breakthrough speed on Bitcoin, but introduced severe operational friction that pushed millions of users back toward custodial solutions. TAURUS solves these structural flaws at the protocol level:
              </p>
              <ul style={{ display: 'grid', gap: '12px', marginTop: '12px' }}>
                <li>
                  <strong>No Inbound Liquidity Deadlocks:</strong> On Lightning, a new user cannot receive Bitcoin until they have first spent funds or paid a routing node for an inbound liquidity lease. In TAURUS, Virtual UTXOs (VTXOs) are self-contained credit commitments; any user can receive sats instantly to their user Taproot address with zero pre-existing channels.
                </li>
                <li>
                  <strong>Elimination of Force-Closure & Toxic State:</strong> If a Lightning node loses state synchronization or broadcasts an outdated commitment transaction, justice penalty mechanisms can burn or confiscate their entire channel balance. In TAURUS, off-chain state updates are committed to validator consensus trees; there are no penalty games or toxic states.
                </li>
                <li>
                  <strong>Deterministic Unilateral Timelock Exit:</strong> If live validators go offline or refuse to coordinate, the user does not need to run a complex fee-bumping dispute race. The TAURUS Taproot exit leaf is hardcoded to the user single-key CHECKSIG with an on-chain relative timelock (BIP68 CSV), enabling guaranteed single-transaction recovery directly to Bitcoin L1.
                </li>
              </ul>
            </div>
          </>
        );
      case 'quickstart':
        return (
          <>
            <p className="pocket-eyebrow">GETTING STARTED</p>
            <h1 className="pocket-title">Quick Start Guide</h1>
            <p className="pocket-lede">
              Follow these three core steps to initialize a sovereign identity, bind to an on-chain Taproot vault, and begin transacting.
            </p>
            <h3>1. Generate Ephemeral Mnemonic</h3>
            <p>Generate a 12-word BIP-39 mnemonic. Private keys are derived into volatile JavaScript heap memory and are never written to disk or browser storage.</p>
            <CodeBlock title="BIP-39 Identity Derivation" code={`import { deriveIdentity } from '@ripcord/core';\n\nconst identity = deriveIdentity(mnemonic, 'regtest', 0);\nconsole.log('User P2TR Address:', identity.userAddress);\nconsole.log('L1 Settlement Address:', identity.l1Address);`} />

            <h3>2. Query Live Quorum & Derive Vault</h3>
            <p>Fetch the 5-of-7 validator threshold from the Tachi consensus daemon and construct the deterministic Taproot vault address.</p>
            <CodeBlock title="Vault Construction" code={`import { getQuorumWithCache, createVault } from '@ripcord/core';\n\nconst quorum = await getQuorumWithCache('https://rpc-regtest.tachibtc.com');\nconst vault = await createVault({\n  network: 'regtest',\n  nodePubkeys: quorum.nodePubkeys,\n  csvBlocks: 2,\n  userKeyDescriptor: identity.userKeyDescriptor,\n  threshold: quorum.threshold,\n});\nconsole.log('Vault P2TR Address:', vault.address);`} />

            <h3>3. Fund & Transact</h3>
            <p>Fund the vault using the Tachi testnet faucet or Bitcoin RPC. Once confirmed on L1, the deposited satoshis become spendable Virtual UTXOs (VTXOs).</p>
          </>
        );
      case 'installation':
        return (
          <>
            <p className="pocket-eyebrow">GETTING STARTED</p>
            <h1 className="pocket-title">Installation & Workspace Setup</h1>
            <p className="pocket-lede">Install @ripcord/core into your Node.js or browser project, or run the full wallet monorepo locally.</p>
            <div className="docs-link-cards">
              <a href="https://www.npmjs.com/package/@ripcord/core" target="_blank" rel="noreferrer" className="docs-external-card">
                <span className="docs-external-title">npm: @ripcord/core</span>
                <span className="docs-external-sub">Verified TypeScript core package v0.1.1</span>
              </a>
              <a href="https://github.com/Jayanng/ripcord" target="_blank" rel="noreferrer" className="docs-external-card">
                <span className="docs-external-title">GitHub: Jayanng/ripcord</span>
                <span className="docs-external-sub">Monorepo source code & issues</span>
              </a>
            </div>
            <CodeBlock title="Package Manager" code={`npm install @ripcord/core\n# or\npnpm add @ripcord/core\n# or\nyarn add @ripcord/core`} />
            <h3>Running the Wallet Locally</h3>
            <p>Clone the official repository from GitHub, install dependencies, and start the local development server:</p>
            <CodeBlock title="Terminal Commands" code={`git clone https://github.com/Jayanng/ripcord.git\ncd ripcord\nnpm install\nnpm run build\nnpm run dev`} />
          </>
        );
      case 'taproot':
        return (
          <>
            <p className="pocket-eyebrow">CRYPTOGRAPHIC PRIMITIVES</p>
            <h1 className="pocket-title">Deterministic Taproot Vault Construction</h1>
            <p className="pocket-lede">Every RIPCORD vault is an on-chain Bitcoin Taproot (P2TR) output governed by BIP-341 and BIP-342.</p>
            <p>To enforce that funds can never be spent via an unknown keypath, the internal key is set to a provably unspendable NUMS point. Any spend MUST reveal a valid script leaf from the Taproot Merkle tree.</p>
            <div className="docs-diagram">
{`                        Taproot Output (P2TR)
                                │
                  Internal Key: NUMS Point (Unspendable)
                                │
                        Tapscript Merkle Root
                               /      \\
                              /        \\
                     [Leaf A]            [Leaf B]
                 Cooperative Path     Unilateral Exit Path
                 ────────────────     ────────────────────
                 5-of-7 Validator     <user_pubkey> CHECKSIGVERIFY
                 Schnorr Quorum       <csv_blocks> CHECKSEQUENCEVERIFY`}
            </div>
            <ul>
              <li><strong>Leaf A (Cooperative Consensus Path):</strong> Requires valid Schnorr signatures from at least 5 of the 7 registered Tachi consensus validators. This path coordinates atomic off-chain VTXO minting and batch settlements.</li>
              <li><strong>Leaf B (Unilateral Exit Path):</strong> Requires a valid Schnorr signature from the user's sovereign public key plus relative timelock verification: <code>&lt;user_xonly_pubkey&gt; OP_CHECKSIGVERIFY &lt;csv_blocks&gt; OP_CHECKSEQUENCEVERIFY</code>.</li>
            </ul>
          </>
        );
      case 'quorum':
        return (
          <>
            <p className="pocket-eyebrow">ARCHITECTURE</p>
            <h1 className="pocket-title">Quorum Discovery & Fingerprinting</h1>
            <p className="pocket-lede">RIPCORD queries live consensus validators, computes quorum fingerprints, and prevents rogue validator collusion.</p>
            <CodeBlock title="Fetching Consensus Quorum" code={`import { getQuorumWithCache } from '@ripcord/core';\n\nconst quorum = await getQuorumWithCache('https://rpc-regtest.tachibtc.com');\nconsole.log(\`Quorum Threshold: \${quorum.threshold} of \${quorum.nodePubkeys.length} validators\`);`} />
            <p>The quorum fingerprint is a domain-separated cryptographic hash covering the exact sorted public keys and consensus threshold. Any change in validator composition triggers an explicit rotation warning.</p>
          </>
        );
      case 'nums':
        return (
          <>
            <p className="pocket-eyebrow">CRYPTOGRAPHIC PRIMITIVES</p>
            <h1 className="pocket-title">NUMS Unspendable Key</h1>
            <p className="pocket-lede">A Nothing-Up-My-Sleeve point ensures that funds locked in a Taproot vault can never be spent via keypath.</p>
            <p>The NUMS internal key is derived by hashing a standard generator point such that the discrete logarithm (private key) is mathematically unfeasible to calculate:</p>
            <CodeBlock title="BIP-341 NUMS Point" code={`// Standard BIP-341 unspendable public key point:\nconst NUMS_INTERNAL_KEY = '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0';\n\n// Any spend of this Taproot output MUST reveal a valid script leaf from the Taproot Merkle tree.\n// No party (neither user nor validator quorum) can spend via the keypath.`} />
          </>
        );
      case 'tapscript':
        return (
          <>
            <p className="pocket-eyebrow">ARCHITECTURE</p>
            <h1 className="pocket-title">Tapscript Tree Leaves</h1>
            <p className="pocket-lede">Detailed specification of Leaf A (Cooperative 5-of-7 Quorum) and Leaf B (Unilateral Relative Timelock Exit).</p>
            <p>Both script leaves are compiled into a binary Tapscript Merkle tree. Leaf A enables atomic off-chain transfers and batch settlements. Leaf B provides the sovereign emergency rip-cord: if validators disappear or censor transactions, the user signs a sweep transaction on L1 after the configured CSV blocks elapse.</p>
          </>
        );
      case 'proofs':
        return (
          <>
            <p className="pocket-eyebrow">VERIFICATION</p>
            <h1 className="pocket-title">Inclusion Proofs: HAT and RIP</h1>
            <p className="pocket-lede">Cryptographic verification guarantees that off-chain state transitions are authentic and verifiable by anyone.</p>
            <ul>
              <li><strong>History Authenticity Tree (HAT):</strong> A Merkle tree structure maintained by the Tachi daemon that records historical note consumption and balance continuity across rounds.</li>
              <li><strong>Rollup Inclusion Proof (RIP):</strong> A cryptographic proof verifying that a specific payment transaction hash is included in the StateDiff committed to the rollup root.</li>
            </ul>
          </>
        );
      case 'ephemeral':
        return (
          <>
            <p className="pocket-eyebrow">SECURITY ARCHITECTURE</p>
            <h1 className="pocket-title">RAM-Only Ephemeral Key Policy</h1>
            <p className="pocket-lede">Protecting Bitcoin private keys against browser exploits, persistent malware, and cross-site scripting.</p>
            <PocketCallout title="Volatile Heap Isolation">
              <p style={{ margin: 0 }}>The 12-word recovery mnemonic and derived private keys are kept strictly in volatile JavaScript heap memory. They are automatically zeroized when the browser tab closes and are never written to disk, localStorage, or IndexedDB.</p>
            </PocketCallout>
          </>
        );
      case 'coin-selection':
        return (
          <>
            <p className="pocket-eyebrow">CUSTODY LIFECYCLE</p>
            <h1 className="pocket-title">VTXO Coin Selection & Reservation Locks</h1>
            <p className="pocket-lede">How RIPCORD selects inputs, isolates change outputs, and prevents concurrent double-spends.</p>
            <ul>
              <li><strong>Greedy Coin Selection:</strong> Selects the smallest optimal set of spendable VTXOs to satisfy the target payment amount.</li>
              <li><strong>Local Spend Reservation:</strong> Temporarily locks selected inputs in memory to prevent concurrent payments from double-spending the same note.</li>
              <li><strong>Single-Writer Queue:</strong> Serializes outbound payments to enforce strict state nonce progression.</li>
              <li><strong>Change Output Isolation:</strong> Change returns strictly to the sender's own user key descriptor, never into the shared validator pool.</li>
            </ul>
          </>
        );
      case 'journey':
        return (
          <>
            <p className="pocket-eyebrow">END-TO-END WALKTHROUGH</p>
            <h1 className="pocket-title">The Complete Custody Lifecycle (Steps 01 to 06)</h1>
            <p className="pocket-lede">Here is the complete path of Bitcoin through the RIPCORD system, from fresh mnemonic generation to off-chain transfers and disaster recovery.</p>
            <div className="journey-grid">
              <div className="journey-card">
                <div className="journey-step-num">01</div>
                <div className="journey-body">
                  <h4>Ephemeral Key Generation & Identity Derivation</h4>
                  <p>User generates a standard 128-bit BIP-39 mnemonic (12 words). Ripcord derives root keys in RAM at path <code>m/84'/0'/0'/0/index</code>.</p>
                </div>
              </div>
              <div className="journey-card">
                <div className="journey-step-num">02</div>
                <div className="journey-body">
                  <h4>Quorum Discovery & Vault Compilation</h4>
                  <p>Ripcord queries the live Tachi daemon, validates the 5-of-7 threshold, sorts validator public keys, and derives the Taproot vault address.</p>
                </div>
              </div>
              <div className="journey-card">
                <div className="journey-step-num">03</div>
                <div className="journey-body">
                  <h4>On-Chain Deposit & Ambient Background Settlement</h4>
                  <p>User deposits BTC into the vault address. Ripcord monitors the Bitcoin mempool and verifies on-chain scriptPubKey matching upon L1 confirmation (blocks arrive every ~10 minutes on Tachi regtest) in the background while allowing full wallet exploration.</p>
                </div>
              </div>
              <div className="journey-card">
                <div className="journey-step-num">04</div>
                <div className="journey-body">
                  <h4>VTXO Coin Selection & Off-Chain Transacting</h4>
                  <p>Deposited BTC becomes spendable Virtual UTXOs. Outbound transfers serialize through single-writer queues with isolated change routing.</p>
                </div>
              </div>
              <div className="journey-card">
                <div className="journey-step-num">05</div>
                <div className="journey-body">
                  <h4>Live Activity Indexing & Proof Commitment</h4>
                  <p>Transactions broadcast to Tachi and stream via WebSocket. Status updates in real-time as HAT and RIP proofs are anchored into rollup blocks.</p>
                </div>
              </div>
              <div className="journey-card">
                <div className="journey-step-num">06</div>
                <div className="journey-body">
                  <h4>Cold-Start Disaster Recovery</h4>
                  <p>If storage is wiped completely, Ripcord restores full state using only the 12-word phrase by scanning candidate CSV blocks (2, 144, 432, 1008, 2016).</p>
                </div>
              </div>
            </div>
          </>
        );
      case 'ripcord-exit':
        return (
          <>
            <p className="pocket-eyebrow">SOVEREIGNTY GUARANTEED</p>
            <h1 className="pocket-title">Unilateral Ripcord Exit</h1>
            <p className="pocket-lede">The hallmark of non-custodial custody is the ability to withdraw funds without third-party permission.</p>
            <p>If Tachi validators disappear, experience downtime, or attempt censorship, the user pulls the Ripcord. This executes a sweep transaction on Bitcoin L1 using the user's sovereign private key after the BIP68 relative timelock has elapsed.</p>
          </>
        );
      case 'timelocks':
        return (
          <>
            <p className="pocket-eyebrow">SOVEREIGN EXIT</p>
            <h1 className="pocket-title">BIP68 Relative Timelocks (CSV)</h1>
            <p className="pocket-lede">The unilateral exit path uses OP_CHECKSEQUENCEVERIFY starting from the confirmation block height of the funding outpoint.</p>
            <div className="docs-table-wrap">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th>Exit Lifecycle Status</th>
                    <th>Timelock Condition</th>
                    <th>User Action Permitted</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>unfunded</code></td>
                    <td>No on-chain funding outpoint detected</td>
                    <td>Fund vault on L1 before testing exit</td>
                  </tr>
                  <tr>
                    <td><code>maturing</code></td>
                    <td><code>confirmations &lt; csvBlocks</code></td>
                    <td>Dry-run test-pull permitted; broadcast locked</td>
                  </tr>
                  <tr>
                    <td><code>live</code></td>
                    <td><code>confirmations &ge; csvBlocks</code></td>
                    <td><strong>Full unilateral exit ready</strong>: User CHECKSIG can sweep to L1</td>
                  </tr>
                  <tr>
                    <td><code>spent</code></td>
                    <td>Funding outpoint has been spent on L1</td>
                    <td>Funds already swept or settled</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        );
      case 'test-pull':
        return (
          <>
            <p className="pocket-eyebrow">SOVEREIGN EXIT</p>
            <h1 className="pocket-title">Dry-Run Test-Pull Engine</h1>
            <p className="pocket-lede">Eliminate user uncertainty before executing an on-chain broadcast through simulated witness construction.</p>
            <ul>
              <li>Builds the exact Bitcoin L1 witness transaction.</li>
              <li>Satisfies the Tapscript leaf with a dummy Schnorr signature.</li>
              <li>Computes virtual size (vsize) and sequence number (<code>nSequence = csvBlocks</code>).</li>
              <li>Computes the deterministic transaction hash (txid) without broadcasting anything.</li>
            </ul>
            <PocketCallout title="Hold-to-Confirm Physical Mechanism">
              <p style={{ margin: 0 }}>Broadcasting an exit on L1 incurs standard Bitcoin mining fees and closes the off-chain vault. RIPCORD protects users from accidental triggers with a 1.2-second hold-to-confirm physical button.</p>
            </PocketCallout>
          </>
        );
      case 'recovery':
        return (
          <>
            <p className="pocket-eyebrow">DISASTER RECOVERY</p>
            <h1 className="pocket-title">Cold-Start Disaster Storage Wipe Recovery</h1>
            <p className="pocket-lede">Complete state restoration from only the 12-word recovery phrase with zero centralized servers.</p>
            <p>If browser storage is wiped completely (clearing IndexedDB, cache, and localStorage), Ripcord scans candidate CSV blocks (2, 144, 432, 1008, 2016), binds to live Bitcoin RPC funding scripts, reconnects to the indexer, and reconstructs the wallet with zero central dependencies.</p>
          </>
        );
      case 'invariants':
        return (
          <>
            <p className="pocket-eyebrow">SECURITY GUARANTEES</p>
            <h1 className="pocket-title">Non-Negotiable Protocol Invariants</h1>
            <p className="pocket-lede">Five foundational rules enforced across both the SDK and wallet UI to guarantee fund security.</p>
            <dl className="docs-facts">
              <div><dt>1. Ephemeral Signing</dt><dd>BIP-39 mnemonic seeds and private keys remain strictly in volatile JavaScript heap memory. Only public addresses and transaction hashes are stored in IndexedDB.</dd></div>
              <div><dt>2. Change Isolation</dt><dd>Payment change always returns to the sender's own user key descriptor, never into the shared vault pool script.</dd></div>
              <div><dt>3. Zero Mocks</dt><dd>Every balance, confirmation, proof check, and exit assessment is executed against live Tachi regtest and Bitcoin RPC outputs. The wallet refuses to fabricate mock receipts.</dd></div>
              <div><dt>4. Script Binding</dt><dd>Funding outputs are verified against Bitcoin RPC via exact scriptPubKey matching. No unverified deposit is ever reported as confirmed custody.</dd></div>
              <div><dt>5. Scope Transparency</dt><dd>RIPCORD targets OP_FREEDOM Bounty #1 on Tachi regtest. There are no false claims of mainnet support; regtest is a deliberate, honest verification boundary.</dd></div>
            </dl>
          </>
        );
      case 'sdk':
        return (
          <>
            <p className="pocket-eyebrow">DEVELOPER INTEGRATION</p>
            <h1 className="pocket-title">@ripcord/core Standalone Library</h1>
            <p className="pocket-lede">The core mechanics of RIPCORD are published on npm as a standalone, modular TypeScript library.</p>
            <div className="docs-link-cards">
              <a href="https://www.npmjs.com/package/@ripcord/core" target="_blank" rel="noreferrer" className="docs-external-card">
                <span className="docs-external-title">npm Package</span>
                <span className="docs-external-sub">npmjs.com/package/@ripcord/core (v0.1.1)</span>
              </a>
              <a href="https://github.com/Jayanng/ripcord/tree/main/packages/core" target="_blank" rel="noreferrer" className="docs-external-card">
                <span className="docs-external-title">Package Source</span>
                <span className="docs-external-sub">github.com/Jayanng/ripcord/tree/main/packages/core</span>
              </a>
              <a href="https://github.com/Jayanng/ripcord/releases/tag/v0.1.1" target="_blank" rel="noreferrer" className="docs-external-card">
                <span className="docs-external-title">GitHub Release</span>
                <span className="docs-external-sub">v0.1.1 release tag</span>
              </a>
            </div>
            <CodeBlock title="Installation via npm" code="npm install @ripcord/core" />
            <p>Designed for autonomous AI agents, backend services, and front-end wallets building non-custodial custody applications on the Tachi and TAURUS protocol.</p>
          </>
        );
      case 'sdk-examples':
        return (
          <>
            <p className="pocket-eyebrow">DEVELOPER INTEGRATION</p>
            <h1 className="pocket-title">TypeScript Code Examples</h1>
            <p className="pocket-lede">End-to-end integration snippets using @ripcord/core.</p>
            <h3>Example 1: Key Derivation & Quorum Discovery</h3>
            <CodeBlock title="TypeScript" code={`import { deriveIdentity, getQuorumWithCache } from '@ripcord/core';\n\nconst mnemonic = process.env.RIPCORD_MNEMONIC!;\nconst identity = deriveIdentity(mnemonic, 'regtest', 0);\nconsole.log('User P2TR Address:', identity.userAddress);\n\nconst quorum = await getQuorumWithCache('https://rpc-regtest.tachibtc.com');\nconsole.log(\`Quorum: \${quorum.threshold} of \${quorum.nodePubkeys.length} validators\`);`} />
            <h3>Example 2: Deterministic Vault Derivation</h3>
            <CodeBlock title="TypeScript" code={`import { createVault, recoverVaultLifecycleState } from '@ripcord/core';\n\nconst vault = await createVault({\n  network: 'regtest',\n  nodePubkeys: quorum.nodePubkeys,\n  csvBlocks: 2,\n  userKeyDescriptor: identity.userKeyDescriptor,\n  threshold: quorum.threshold,\n});\nconsole.log('Vault Taproot Address:', vault.address);`} />
            <h3>Example 3: VTXO Transfer</h3>
            <CodeBlock title="TypeScript" code={`import { createVtxoPayment, makeSigner } from '@ripcord/core';\n\nconst signer = makeSigner(identity.mnemonic, 'regtest', vault.userKeyIndex);\nconst receipt = await createVtxoPayment({\n  vault,\n  senderXOnly: identity.xOnly,\n  recipientAddress: 'bcrt1p...',\n  amountSats: 50_000n,\n  baseUrl: 'https://rpc-regtest.tachibtc.com',\n  signer,\n});\nconsole.log('TxHash:', receipt.txHash);`} />
          </>
        );
      case 'sdk-subpaths':
        return (
          <>
            <p className="pocket-eyebrow">DEVELOPER INTEGRATION</p>
            <h1 className="pocket-title">Exported Module Subpaths</h1>
            <p className="pocket-lede">Modular entry points available for granular bundling.</p>
            <div className="docs-table-wrap">
              <table className="docs-table">
                <thead>
                  <tr><th>Import Subpath</th><th>Description</th></tr>
                </thead>
                <tbody>
                  <tr><td><code>@ripcord/core/keys</code></td><td>BIP-39 mnemonic validation, BIP-84 key derivation, and Schnorr signing adapters.</td></tr>
                  <tr><td><code>@ripcord/core/quorum</code></td><td>Consensus quorum discovery, validation, caching, and quorum fingerprinting.</td></tr>
                  <tr><td><code>@ripcord/core/vault</code></td><td>Taproot vault derivation, NUMS internal key, and script tree compilation.</td></tr>
                  <tr><td><code>@ripcord/core/payment</code></td><td>VTXO coin selection, payment building, change routing, and reservation locks.</td></tr>
                  <tr><td><code>@ripcord/core/exit</code></td><td>BIP68 maturity evaluation, test-pull dry runs, and unilateral exit execution.</td></tr>
                  <tr><td><code>@ripcord/core/recovery</code></td><td>Multi-candidate CSV scanning, script matching, and cold-start browser restore.</td></tr>
                  <tr><td><code>@ripcord/core/indexer</code></td><td>WebSocket indexer client for real-time transaction and block updates.</td></tr>
                  <tr><td><code>@ripcord/core/store</code></td><td>Public metadata persistence adapters for Memory and IndexedDB.</td></tr>
                </tbody>
              </table>
            </div>
          </>
        );
      case 'satvm':
        return (
          <>
            <p className="pocket-eyebrow">SMART CONTRACT PROGRAMMABILITY</p>
            <h1 className="pocket-title">SatVM Smart Contracts on TAURUS</h1>
            <p className="pocket-lede">
              Forward-compatible smart contract architecture for Turing-complete state transitions directly against Virtual UTXOs (VTXOs) via SatVM covenants targeted for Phase 2 ecosystem grant expansion.
            </p>
            <PocketCallout title="Bounty Scope & Verification Boundary">
              <p style={{ margin: 0 }}>
                <strong>Live on Tachi Regtest Today:</strong> Sovereign identity derivation, deterministic 5-of-7 TAURUS vault construction, L1 funding verification, off-chain VTXO transfers, inclusion receipts, and BIP68 unilateral exits.<br />
                <strong>Phase 2 Grant Scope:</strong> Turing-complete SatVM contract execution. <code>@ripcord/core</code> provides the forward-compatible TypeScript types (<code>SatVmCallParams</code>, <code>SatVmExecutionReceipt</code>) and architectural specification so downstream applications can prepare for contract state evaluation without breaking changes.
              </p>
            </PocketCallout>
            <p style={{ marginTop: '16px' }}>
              While standard TAURUS vaults provide high-throughput peer-to-peer VTXO transfers, SatVM extends this architecture with programmable covenant state machines. Contracts evaluate off-chain against VTXO inputs and produce verifiable state roots committed to the Tachi History Authenticity Tree (HAT).
            </p>

            <h3>How SatVM Integrates with TAURUS Custody</h3>
            <div className="docs-table-wrap">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th>Layer</th>
                    <th>Responsibility</th>
                    <th>Security Anchor</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>Bitcoin L1</strong></td>
                    <td>Custody of deposited satoshis in 5-of-7 Taproot vaults</td>
                    <td>BIP68 timelock (CSV) unconditional unilateral exit</td>
                  </tr>
                  <tr>
                    <td><strong>Tachi Consensus</strong></td>
                    <td>Off-chain VTXO sequencing, double-spend prevention, HAT anchoring</td>
                    <td>5-of-7 validator threshold signatures</td>
                  </tr>
                  <tr>
                    <td><strong>SatVM Engine</strong></td>
                    <td>Contract state execution, condition evaluation, output VTXO generation</td>
                    <td>Cryptographic state root attested by quorum</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 style={{ marginTop: '32px' }}>TypeScript Contract Invocation Interface</h3>
            <p>
              The <code>@ripcord/core</code> library exports forward-compatible types and execution interfaces for dispatching contract calls:
            </p>
            <CodeBlock
              title="SatVM Contract Call Pattern (Grant Scope)"
              code={`import { SatVmCallParams, SatVmExecutionReceipt } from '@ripcord/core';

// Forward-compatible contract call pattern for the Phase 2 SatVM grant milestone:
const callParams: SatVmCallParams = {
  contractAddress: 'satvm1qq...escrow_vault',
  method: 'releaseConditional',
  args: ['oracle_attestation_hex', 50_000n],
  inputVtxoId: 'vtxo:9a4b2c...',
  maxFeeSats: 250n,
};

// Planned Phase 2 runtime returns an attested execution receipt:
// type SatVmExecutionReceipt = {
//   txHash: string;
//   contractAddress: string;
//   method: string;
//   stateRoot: string;
//   outputVtxoIds: readonly string[];
//   gasUsedSats: bigint;
//   status: 'committed' | 'rejected';
// };`}
            />

            <h3 style={{ marginTop: '32px' }}>Grant Roadmap & Future Work</h3>
            <p>
              Full SatVM smart contract integration is targeted for Phase 2 grant milestones:
            </p>
            <ul style={{ display: 'grid', gap: '12px', marginTop: '12px' }}>
              <li>
                <strong>Phase 1 (Completed):</strong> Core types (<code>SatVmCallParams</code>, <code>SatVmExecutionReceipt</code>), architecture specification, and documentation published in <code>@ripcord/core</code>.
              </li>
              <li>
                <strong>Phase 2 (Grant Target - Conditional Escrow):</strong> Programmatic VTXO releases contingent on external multi-oracle or DLC attestations evaluated in SatVM.
              </li>
              <li>
                <strong>Phase 3 (Grant Target - Decentralized Orderbook Matching):</strong> Zero-fee, sub-second limit order settlement using SatVM state diffs without touching Bitcoin L1 base chain.
              </li>
              <li>
                <strong>Phase 4 (Grant Target - Client-Side ZK Verification):</strong> Client-side verification of SatVM state transitions using succinct zero-knowledge execution proofs.
              </li>
            </ul>
          </>
        );
      case 'specs':
      default:
        return (
          <>
            <p className="pocket-eyebrow">VERIFIED ENVIRONMENT</p>
            <h1 className="pocket-title">Network & Daemon Specifications</h1>
            <p className="pocket-lede">Authoritative live RPC endpoints, explorers, and protocol parameters for Tachi regtest.</p>
            <dl className="docs-facts">
              <div><dt>Network</dt><dd>tachi-regtest-1</dd></div>
              <div><dt>Consensus Quorum</dt><dd>5 of 7 validator threshold</dd></div>
              <div><dt>Daemon REST RPC</dt><dd><a href="https://rpc-regtest.tachibtc.com" target="_blank" rel="noreferrer">https://rpc-regtest.tachibtc.com</a></dd></div>
              <div><dt>WebSocket Indexer</dt><dd><code>wss://rpc-regtest.tachibtc.com/tachi_ws</code></dd></div>
              <div><dt>Bitcoin Faucet</dt><dd><a href="https://faucet.tachibtc.com" target="_blank" rel="noreferrer">https://faucet.tachibtc.com</a></dd></div>
              <div><dt>Block Explorer</dt><dd><a href="https://explorer-regtest.tachibtc.com" target="_blank" rel="noreferrer">https://explorer-regtest.tachibtc.com</a></dd></div>
              <div><dt>GitHub Repository</dt><dd><a href="https://github.com/Jayanng/ripcord" target="_blank" rel="noreferrer">github.com/Jayanng/ripcord</a></dd></div>
              <div><dt>Core Package (npm)</dt><dd><a href="https://www.npmjs.com/package/@ripcord/core" target="_blank" rel="noreferrer">npmjs.com/package/@ripcord/core (v0.1.1)</a></dd></div>
              <div><dt>GitHub Release</dt><dd><a href="https://github.com/Jayanng/ripcord/releases/tag/v0.1.1" target="_blank" rel="noreferrer">Release v0.1.1</a></dd></div>
              <div><dt>BIP Standards</dt><dd>BIP-39 (Mnemonic), BIP-84 (Derivation), BIP-340/341/342 (Taproot), BIP-68 (CSV)</dd></div>
            </dl>
          </>
        );
    }
  };

  return (
    <section className="dashboard-docs" aria-labelledby="docs-title">
      {/* Mobile Toggle */}
      <button
        type="button"
        className="pocket-mobile-toggle"
        onClick={() => setMobileNavOpen(prev => !prev)}
        aria-expanded={mobileNavOpen}
      >
        <span>Docs: {currentItem.label} ({ALL_ITEMS.length} topics)</span>
        <span>{mobileNavOpen ? 'Close Menu' : 'Browse Docs'}</span>
      </button>

      <div className="pocket-docs-layout">
        {/* Left Sidebar */}
        <aside className={`pocket-sidebar ${mobileNavOpen ? 'mobile-open' : ''}`} aria-label="Documentation Navigation">
          <div className="pocket-search-wrap">
            <svg className="pocket-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              ref={searchInputRef}
              type="search"
              placeholder="Search docs..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pocket-search-input"
            />
          </div>

          {filteredGroups.map(grp => (
            <div key={grp.group} className="pocket-group">
              <span className="pocket-group-title">{grp.group}</span>
              {grp.items.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={`pocket-nav-item ${activeId === item.id ? 'active' : ''}`}
                  onClick={() => scrollTo(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}

          <div className="pocket-group pocket-sidebar-resources">
            <span className="pocket-group-title">Resources</span>
            <a
              href="https://github.com/Jayanng/ripcord"
              target="_blank"
              rel="noreferrer"
              className="pocket-sidebar-link"
              title="GitHub Repository"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
              <span>GitHub (Jayanng/ripcord)</span>
            </a>
            <a
              href="https://www.npmjs.com/package/@ripcord/core"
              target="_blank"
              rel="noreferrer"
              className="pocket-sidebar-link"
              title="npm package"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M0 0v16h16V0H0zm13.333 13.333h-2.666V5.333H8V13.333H2.667V2.667h10.666v10.666z"/>
              </svg>
              <span>npm: @ripcord/core</span>
            </a>
            <a
              href="https://github.com/Jayanng/ripcord/releases/tag/v0.1.1"
              target="_blank"
              rel="noreferrer"
              className="pocket-sidebar-link"
              title="Release v0.1.1"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2.5 9l5 5 7-7V2.5H10L2.5 9z"/>
                <circle cx="12" cy="4" r="1" fill="currentColor"/>
              </svg>
              <span>Release v0.1.1</span>
            </a>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="pocket-main">
          {renderActiveDocument()}

          {/* Pagination Footer */}
          <nav className="pocket-pagination" aria-label="Documentation Pagination">
            {prevItem && (
              <button
                type="button"
                className="pocket-page-btn prev"
                onClick={() => scrollTo(prevItem.id)}
              >
                <span className="pocket-page-label">← PREVIOUS</span>
                <span className="pocket-page-title">{prevItem.label}</span>
              </button>
            )}

            {nextItem && (
              <button
                type="button"
                className="pocket-page-btn next"
                onClick={() => scrollTo(nextItem.id)}
              >
                <span className="pocket-page-label">NEXT →</span>
                <span className="pocket-page-title">{nextItem.label}</span>
              </button>
            )}
          </nav>
        </main>
      </div>
    </section>
  );
}
