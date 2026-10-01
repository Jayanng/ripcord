import { useState } from 'react';
import { useWallet } from '../context/WalletContext';
import { identityForVault } from '../context/WalletContext';
import { wipeAllAppData } from '../lib/selfHeal';

/**
 * Lock screen shown when stored vault records exist but the in-memory keys
 * are gone (fresh page load / browser restart). Keys are NEVER persisted -
 * by design - so the user re-enters their 12-word recovery phrase to
 * re-derive the identity and reload balances, VTXOs, and proofs.
 */
export function UnlockScreen() {
  const wallet = useWallet();
  const [mnemonic, setMnemonic] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const lostKeys = async () => {
    const confirmed = window.confirm(
      'Start over on this device?\n\n' +
      'This forgets the vault records stored here. Funds in a wallet whose 12-word phrase is truly lost cannot be recovered by anyone.\n\n' +
      'If you still have your phrase somewhere, cancel and enter it instead - or use "Recover wallet" after resetting.',
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      await wipeAllAppData();
    } finally {
      window.location.reload();
    }
  };

  const unlock = async () => {
    setBusy(true);
    setError('');
    try {
      const { deriveIdentity } = await import('@ripcord/core/keys');
      const trimmed = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
      // Real verification: the derived key must MATCH the stored vault's key.
      // (Deriving at the vault's index and comparing the index proves nothing,
      // that comparison was always true. The key itself is the proof.)
      const vaults = wallet.vaults;
      let matched: ReturnType<typeof deriveIdentity> | null = null;
      for (const v of vaults) {
        const id = deriveIdentity(trimmed, 'regtest', v.userKeyIndex);
        const vaultKey = String(v.userKeyDescriptor?.publicKey ?? '').replace(/^0x/, '').toLowerCase().slice(-64);
        if (vaultKey && id.xOnly.toLowerCase() === vaultKey) {
          matched = id;
          break;
        }
      }
      if (vaults.length > 0 && !matched) {
        setError('This phrase does not match the wallet stored on this device. Check each word, or use "Recover wallet" on the previous screen.');
        return;
      }
      wallet.setIdentity(matched ?? deriveIdentity(trimmed, 'regtest', 0));
    } catch (e) {
      setError('Could not unlock: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setup-gate auth-container" role="dialog" aria-label="Unlock wallet">
      <div className="auth-header">
        <p className="eyebrow">Locked · Keys are never stored</p>
        <h2>Welcome back</h2>
        <p className="auth-subtext">
          Your vault records are stored on this device, but your keys are never stored — they were cleared when the page closed.
          Enter your 12-word recovery phrase to unlock your wallet and reload balances, VTXOs, and proofs.
        </p>
        <textarea
          className="mono-input"
          value={mnemonic}
          onChange={e => setMnemonic(e.target.value)}
          placeholder="12-word recovery phrase"
          rows={3}
          disabled={busy}
          style={{ width: '100%', marginTop: '16px', minHeight: 44 }}
          aria-label="Recovery phrase"
        />
        {error && <p className="field-error" role="alert">{error}</p>}
        <div style={{ marginTop: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="test-pull balance-fund-cta"
            onClick={() => void unlock()}
            disabled={busy || mnemonic.trim().split(/\s+/).filter(Boolean).length < 12}
            style={{ minHeight: 44, minWidth: 44 }}
          >
            {busy ? 'Unlocking…' : 'Unlock wallet'}
          </button>
        </div>
        <span className="balance-friendly-helper" style={{ display: 'block', marginTop: '10px', fontSize: '12px' }}>
          Keys are never written anywhere. Unlocking restores them from your phrase.
        </span>
        <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
          <span style={{ fontSize: '12px', opacity: 0.65 }}>Phrase gone?</span>
          <button
            type="button"
            className="secondary-action-compact"
            onClick={() => void lostKeys()}
            disabled={busy}
            style={{ minHeight: 44, minWidth: 44 }}
          >
            Start over on this device
          </button>
        </div>
      </div>
    </div>
  );
}
