import { useEffect, useRef, useState } from 'react';
import { useWallet } from '../context/WalletContext';
import { useRefund, type RefundReadiness, type ClaimReadiness } from '../hooks/useRefund';
import { composeFlowErrorMessage } from '@ripcord/core/lifecycle';
import { describeDaemonFailure } from '@ripcord/core/net';
import { HoldToConfirmButton } from './HoldToConfirmButton';
import { truncate, formatSats } from './ui';

type Phase = 'idle' | 'assessing' | 'assessed' | 'broadcasting' | 'broadcast' | 'claiming' | 'claimed';

/**
 * Cooperative refund path: the fast half of the dual-path exit console.
 * Needs the 5-of-7 quorum's signature but no timelock. Every broadcast is
 * gated behind the app's HoldToConfirmButton; assessment is a pure dry run.
 */
export function RefundPanel() {
  const wallet = useWallet();
  const { runAssess, runExecute, runAssessClaim, runClaim } = useRefund();
  const [phase, setPhase] = useState<Phase>('idle');
  const [refundReadiness, setRefundReadiness] = useState<RefundReadiness | null>(null);
  const [claimReadiness, setClaimReadiness] = useState<ClaimReadiness | null>(null);
  const [refundTxid, setRefundTxid] = useState('');
  const [claimTxid, setClaimTxid] = useState('');
  const [error, setError] = useState('');
  const refundValueRef = useRef<bigint>(0n);

  const vault = wallet.activeVault;
  const identity = wallet.identity;

  const describeError = (e: unknown) => composeFlowErrorMessage(e) || describeDaemonFailure(e);

  // After a refund broadcast, poll the to_local payout maturity like the
  // funding flow polls confirmations.
  useEffect(() => {
    if (phase !== 'broadcast' || !refundTxid || !refundReadiness?.toLocal || !identity) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await runAssessClaim(refundReadiness.toLocal!, { txid: refundTxid, valueSats: refundValueRef.current }, identity, wallet.baseUrl);
        if (!cancelled) { setClaimReadiness(result); setError(''); }
      } catch (e) {
        if (!cancelled) setError(describeError(e));
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [phase, refundTxid, refundReadiness, identity, wallet.baseUrl]);

  const assess = async () => {
    if (!vault || !identity) return;
    setPhase('assessing'); setError(''); setRefundReadiness(null);
    try {
      const result = await runAssess(vault, identity, wallet.baseUrl);
      setRefundReadiness(result);
      setPhase('assessed');
    } catch (e) {
      setError(describeError(e));
      setPhase('idle');
    }
  };

  const broadcast = async () => {
    if (!vault || !identity) return;
    setPhase('broadcasting'); setError('');
    try {
      const result = await runExecute(vault, identity, wallet.baseUrl, refundReadiness?.feeSats, refundReadiness?.userValueSats);
      refundValueRef.current = result.userValueSats;
      setRefundReadiness(prev => (prev ? { ...prev, toLocal: result.toLocal } : prev));
      setRefundTxid(String(result.txid));
      setPhase('broadcast');
    } catch (e) {
      setError(describeError(e));
      setPhase('assessed');
    }
  };

  const claim = async () => {
    if (!identity || !refundReadiness?.toLocal || !refundTxid) return;
    setPhase('claiming'); setError('');
    try {
      const result = await runClaim(refundReadiness.toLocal, { txid: refundTxid, valueSats: refundValueRef.current }, identity, wallet.baseUrl);
      setClaimTxid(String(result.txid));
      setPhase('claimed');
    } catch (e) {
      setError(describeError(e));
      setPhase('broadcast');
    }
  };

  const claimStatus = claimReadiness?.status ?? (refundTxid ? 'maturing' : 'unfunded');
  const canBroadcast = phase === 'assessed' && refundReadiness?.status === 'ready' && Boolean(refundReadiness?.dryRun);
  const canClaim = phase === 'broadcast' && claimStatus === 'live';

  return (
    <section id="refund" className="ripcord-panel" aria-labelledby="refund-title">
      <div className="ripcord-kicker">
        <span className="cord" />
        <div>
          <p className="eyebrow">Cooperative refund path</p>
          <h2 id="refund-title">Fast refund</h2>
        </div>
        <span className={`exit-status ${refundReadiness?.status === 'ready' ? 'live' : refundReadiness ? 'maturing' : 'unfunded'}`}>
          {phase === 'claimed' ? 'REFUNDED' : refundReadiness?.status === 'ready' ? 'QUORUM READY' : refundTxid ? 'PAYOUT PENDING' : 'DRY RUN FIRST'}
        </span>
      </div>

      <p className="ripcord-copy">
        The quorum co-signs a refund of your current balance. No timelock to wait out,
        but it needs the 5-of-7 validators to answer. The payout then lands in a
        timelocked claim output that sweeps to your L1 address once mature.
      </p>

      <dl className="ripcord-facts">
        <div>
          <dt>Refund value</dt>
          <dd>{refundReadiness?.userValueSats !== undefined ? formatSats(refundReadiness.userValueSats) : 'Assess to see the live amount'}</dd>
        </div>
        <div>
          <dt>Network fee</dt>
          <dd>{refundReadiness?.feeSats !== undefined ? `${formatSats(refundReadiness.feeSats)}` : 'Shown after assessment'}</dd>
        </div>
        <div>
          <dt>Payout address</dt>
          <dd>{refundReadiness?.dryRun ? truncate(refundReadiness.dryRun.toLocalAddress, 10, 8) : identity ? truncate(identity.l1Address, 10, 8) : 'No identity loaded'}</dd>
        </div>
        <div>
          <dt>Claim status</dt>
          <dd>
            {!refundTxid
              ? 'Not broadcast yet'
              : claimStatus === 'live'
                ? 'Mature, ready to claim'
                : claimStatus === 'maturing'
                  ? `Claimable in ${claimReadiness?.confirmationsRemaining ?? '?'} confirmations`
                  : claimStatus === 'spent'
                    ? 'Already claimed'
                    : 'Waiting for the payout output'}
          </dd>
        </div>
      </dl>

      <div className="ripcord-actions">
        <button className="test-pull" disabled={!vault || !identity || phase === 'assessing' || phase === 'broadcasting' || phase === 'claiming'} onClick={() => void assess()}>
          {phase === 'assessing' ? 'Assessing refund…' : refundReadiness ? 'Re-assess refund' : 'Assess refund (dry run)'}
        </button>
        {canBroadcast && (
          <HoldToConfirmButton disabled={false} label="HOLD TO BROADCAST REFUND" disabledHint="Assess the refund first" onConfirm={() => void broadcast()} />
        )}
        {canClaim && (
          <HoldToConfirmButton disabled={false} label="HOLD TO CLAIM PAYOUT" disabledHint="Payout must be mature before claiming" onConfirm={() => void claim()} />
        )}
      </div>

      {phase === 'broadcasting' && <p className="flow-note" role="status">Contacting the quorum and broadcasting the refund…</p>}
      {phase === 'claiming' && <p className="flow-note" role="status">Sweeping the payout to your L1 address…</p>}
      {refundTxid && phase !== 'claimed' && (
        <p className="flow-note" role="status">
          Refund broadcast: {truncate(refundTxid, 10, 8)}
          {claimStatus === 'live' ? ' · payout mature, hold the claim button to sweep it.' : ' · tracking payout maturity.'}
        </p>
      )}
      {phase === 'claimed' && claimTxid && (
        <p className="flow-note" role="status">Payout claimed: {truncate(claimTxid, 10, 8)} · funds sent to your L1 settlement address.</p>
      )}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </section>
  );
}
