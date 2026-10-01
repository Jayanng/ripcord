import { ExitCertificateCard } from '../components/ExitCertificateCard';
import { ExitRing } from '../components/ExitRing';
import { RipcordPanel } from '../components/RipcordPanel';
import { RefundPanel } from '../components/RefundPanel';

/**
 * Dual-path exit console. Two ways back to Bitcoin L1, trade-off visible at a
 * glance: the cooperative refund needs the quorum but no timelock, the
 * unilateral exit needs only the user's signature after the CSV timelock.
 * (The dual guarantee Tachi documents in docs/vault/refund-exit.md.)
 */
export function ExitScreen() {
  return (
    <section className="exit-section">
      <div className="exit-console-intro">
        <p className="eyebrow">Back to Bitcoin L1</p>
        <h2>Two ways out. Both are yours.</h2>
        <p className="ripcord-copy">
          The fast refund asks the 5-of-7 quorum to co-sign and settles now.
          The sovereign exit needs nobody, just the timelock to mature.
          Pick whichever fits the moment.
        </p>
      </div>
      <div style={{ marginBottom: '20px' }}>
        <ExitRing />
      </div>
      <div className="exit-console">
        <RefundPanel />
        <RipcordPanel />
      </div>
      <ExitCertificateCard />
    </section>
  );
}
