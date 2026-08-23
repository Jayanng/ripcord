import { useState } from 'react';
import type { VaultRecord } from '@ripcord/core/types';
import { truncate } from './ui';

export function TapscriptInspector({ vault }: { vault: VaultRecord }) {
  const [exit, setExit] = useState<string[]>([]);
  const [cooperative, setCooperative] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = async (open: boolean) => {
    if (!open || loaded) return;
    const { describeTapscript } = await import('@ripcord/core/vault');
    setExit(vault.exitLeaf ? describeTapscript(vault.exitLeaf) : []);
    setCooperative(vault.cooperativeLeaf ? describeTapscript(vault.cooperativeLeaf) : []);
    setLoaded(true);
  };
  return <details className="inspector" onToggle={event => void load(event.currentTarget.open)}><summary>Inspect tapscript and NUMS key</summary><div className="inspector-grid"><div><span>Exit leaf</span><code>{loaded ? exit.join(' ') || 'Unavailable' : 'Loading verifier…'}</code></div><div><span>Cooperative leaf</span><code>{loaded ? cooperative.join(' ') || 'Unavailable' : 'Loading verifier…'}</code></div><div><span>Vault ID</span><code>{truncate(vault.vaultIdHex, 14, 10)}</code></div><div><span>Quorum fingerprint</span><code>{vault.quorumFingerprint}</code></div></div></details>;
}
