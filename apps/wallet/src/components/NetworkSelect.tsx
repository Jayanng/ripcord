import type { TachiNetwork } from '@ripcord/core';
import { setActiveNetwork } from '../lib/network-state';

/**
 * Network selection — onboarding step 0 (user-mandated 2026-10-14): the user
 * picks TACHI REGTEST or TACHI SIGNET BEFORE any wallet, vault, or key exists.
 * The choice is stamped on the identity and every vault record at creation and
 * resolves every endpoint downstream (daemon, WSS, explorer, faucet, chain
 * guard). A wallet is bound to its network; the other network means a fresh
 * wallet ("Start over"), same as today's flows.
 */
export function NetworkSelect({ onChoose }: { onChoose: (network: TachiNetwork) => void }) {
  const choose = (network: TachiNetwork) => {
    setActiveNetwork(network);
    onChoose(network);
  };

  return (
    <section className="flow-screen netselect-screen">
      <p className="eyebrow">STEP 1 · NETWORK</p>
      <div className="flow-heading">
        <h1>Choose your network</h1>
        <p className="flow-note">
          Your wallet is created on the network you pick here: its keys, vaults,
          links and funds all live on it. Nothing is created until you choose.
        </p>
      </div>

      <div className="netselect-grid">
        <article className="netselect-card">
          <h2>Tachi Regtest</h2>
          <p className="netselect-tag">Ripcord&apos;s original test network</p>
          <ul>
            <li>Private Tachi chain backed by Bitcoin regtest</li>
            <li>Faucet: 0.5 BTC per address per day, no sign-in</li>
            <li>Addresses look like <code>bcrt1…</code></li>
          </ul>
          <button type="button" className="test-pull" onClick={() => choose('regtest')}>
            Use Tachi Regtest
          </button>
        </article>

        <article className="netselect-card">
          <h2>Tachi Signet</h2>
          <p className="netselect-tag">Public Bitcoin signet</p>
          <ul>
            <li>Tachi&apos;s signet chain (tachi-signet-1)</li>
            <li>Faucet: sign in with GitHub or X, 0.005 BTC per account per day</li>
            <li>Addresses look like <code>tb1…</code></li>
          </ul>
          <button type="button" className="test-pull" onClick={() => choose('signet')}>
            Use Tachi Signet
          </button>
        </article>
      </div>

      <p className="flow-note">
        Want the other network later? Start a fresh wallet from More — a wallet
        stays on the network it was created on.
      </p>
    </section>
  );
}
