import { SendForm } from '../components/SendForm';

export function SendScreen({ onBack }: { onBack?: () => void }) {
  return (
    <section className="flow-screen">
      {onBack && (
        <button
          type="button"
          className="back-to-wallet-btn"
          onClick={onBack}
          aria-label="Back to wallet"
        >
          ← Back to wallet
        </button>
      )}
      <div className="flow-heading">
        <p className="eyebrow">Off-chain transfer</p>
        <h2>Send VTXO sats</h2>
        <p>Inputs are selected from the live daemon. Change returns to your own user key, never the vault address.</p>
      </div>
      <SendForm />
    </section>
  );
}

