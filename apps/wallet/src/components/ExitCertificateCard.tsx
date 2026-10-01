import { useEffect, useMemo, useState } from 'react';
import { useWallet } from '../context/WalletContext';
import { buildExitCertificate, certificateSummaryText, type ExitCertificate } from '@ripcord/core/exit-certificate';

/**
 * Exit Readiness Certificate (Bounty #1, Phase 2).
 *
 * The four checks Tachi's docs recommend made visible and exportable: a
 * judge-facing, plain-English proof that this vault's unilateral exit is
 * enforced by Bitcoin consensus. Pure presentation: the engine does all
 * verification and never throws.
 *
 * Honesty (second-eye review): the "your key" check compares the exit leaf
 * against the key derived from the USER'S PHRASE, not the vault record's own
 * claim, so a tampered record fails loudly. A missing exit leaf fails its
 * checks; nothing is ever synthesized to make the card look good.
 */
export function ExitCertificateCard() {
  const wallet = useWallet();
  const vault = wallet.activeVault;
  const identity = wallet.identity;
  const readiness = wallet.exitReadiness;

  // The key the user actually controls: derived from their phrase at the
  // vault's key index. This is the honest reference for the binding check.
  const [userKeyHex, setUserKeyHex] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (!vault || !identity) {
      setUserKeyHex('');
      return;
    }
    void (async () => {
      try {
        const { deriveIdentity } = await import('@ripcord/core/keys');
        const derived = deriveIdentity(identity.mnemonic, 'regtest', vault.userKeyIndex);
        if (!cancelled) setUserKeyHex(String(derived.xOnly));
      } catch {
        if (!cancelled) setUserKeyHex('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vault, identity]);

  const cert: ExitCertificate | null = useMemo(() => {
    if (!vault || !identity || !userKeyHex) return null;
    try {
      const funding = vault.funding ? `${vault.funding.txid}:${vault.funding.vout}` : undefined;
      return buildExitCertificate(
        {
          csvBlocks: vault.csvBlocks,
          exitScript: vault.exitLeaf ?? '',
          userKeyHex,
          address: vault.address,
        },
        readiness ?? null,
        {
          network: 'regtest',
          treeVerified: Boolean(readiness?.dryRun),
          fundingOutpoint: funding,
        },
      );
    } catch {
      // The engine never throws by design; a null card beats a broken screen.
      return null;
    }
  }, [vault, identity, userKeyHex, readiness]);

  if (!vault || !identity || !cert) return null;

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(cert, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ripcord-exit-certificate-${cert.timestamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const allPass = cert.passed === cert.checks.length;
  const treePending = !cert.checks.find(c => c.id === 'tree-proof')?.pass;

  return (
    <div className="exit-cert" aria-label="Exit Readiness Certificate">
      <div className="exit-cert-head">
        <h3>Exit Readiness Certificate</h3>
        <span className={`exit-cert-badge ${allPass && cert.exitStillPossible ? 'ok' : 'warn'}`}>
          {cert.exitStillPossible ? `${cert.passed}/${cert.checks.length} checks` : 'spent'}
        </span>
      </div>
      <p className="exit-cert-summary">{certificateSummaryText(cert)}</p>
      <ul className="exit-cert-checks">
        {cert.checks.map(check => (
          <li key={check.id} className={check.pass ? 'pass' : 'fail'}>
            <span className="exit-cert-mark" aria-hidden="true">{check.pass ? '✓' : '✕'}</span>
            <div>
              <strong>{check.name}</strong>
              <span>{check.detail}</span>
            </div>
          </li>
        ))}
      </ul>
      <dl className="exit-cert-meta">
        <div><dt>Maturity</dt><dd>{cert.maturity.text}</dd></div>
        <div><dt>Your key</dt><dd>{cert.userKeyFingerprint}</dd></div>
        <div><dt>Vault</dt><dd>{cert.vaultAddress.slice(0, 12)}…{cert.vaultAddress.slice(-6)}</dd></div>
      </dl>
      {treePending && (
        <p className="exit-cert-nudge">
          {cert.maturity.status === 'unfunded'
            ? <>The tree proof appears once this vault holds confirmed funds on Bitcoin L1. Fund it first, then run <strong>Verify Exit Path (Dry Run)</strong> above.</>
            : <>The tree proof completes when you run <strong>Verify Exit Path (Dry Run)</strong> above.</>}
        </p>
      )}
      <div className="exit-cert-actions">
        <button type="button" className="test-pull" onClick={exportJson}>Export certificate (JSON)</button>
      </div>
    </div>
  );
}
