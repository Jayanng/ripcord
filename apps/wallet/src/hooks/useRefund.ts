import type { VaultRecord, Identity } from '@ripcord/core/types';

// ToLocalP2trOutput's home is the TaurUS SDK (banned in the wallet layer by the
// architecture gate); derive the type from core's own exported constructor.
type ToLocalP2trOutput = ReturnType<typeof import('@ripcord/core/refund').buildToLocalCommitment>;

/**
 * Cooperative refund flow hook (the fast half of the dual-path exit console).
 *
 * Wires the existing, live-tested core engine (packages/core/src/refund.ts):
 *   assessRefund        - dry run: inspects funding, builds + user-signs the
 *                         refund PSBT, NEVER broadcasts
 *   executeRefund       - build + sign + quorum cosign + broadcast to L1
 *   assessToLocalClaim  - dry run + maturity for the broadcast to_local payout
 *   claimToLocalPayout  - sweep the payout to the user's L1 address once the
 *                         toSelfDelay timelock has matured
 *
 * UI-only: every money operation below is a thin call into core. No signing or
 * transaction logic lives in the wallet layer. Signer indices follow core's own
 * conventions (refund signs with vault.userKeyIndex, the claim signs with
 * identity.userKeyDescriptor.index; core enforces the two match).
 */
export type RefundReadiness = Awaited<ReturnType<typeof import('@ripcord/core/refund').assessRefund>>;
export type ClaimReadiness = Awaited<ReturnType<typeof import('@ripcord/core/refund').assessToLocalClaim>>;

export function useRefund() {
  /** Dry run only: never broadcasts. */
  const runAssess = async (vault: VaultRecord, identity: Identity, baseUrl: string): Promise<RefundReadiness> => {
    const { assessRefund } = await import('@ripcord/core/refund');
    return assessRefund({ vault, identity, baseUrl });
  };

  /** Broadcasts a cooperative refund: quorum cosign + L1 sendrawtransaction. */
  const runExecute = async (
    vault: VaultRecord,
    identity: Identity,
    baseUrl: string,
    feeSats?: bigint,
    userValueSats?: bigint,
  ) => {
    const { executeRefund } = await import('@ripcord/core/refund');
    const { makeSigner } = await import('@ripcord/core/keys');
    const signer = makeSigner(identity.mnemonic, 'regtest', vault.userKeyIndex);
    return executeRefund({ vault, identity, signer, baseUrl, feeSats, userValueSats });
  };

  /** Maturity + dry run for the payout claim (the to_local output of the refund tx). */
  const runAssessClaim = async (
    toLocal: ToLocalP2trOutput,
    funding: { txid: string; valueSats: bigint },
    identity: Identity,
    baseUrl: string,
  ): Promise<ClaimReadiness> => {
    const { assessToLocalClaim } = await import('@ripcord/core/refund');
    return assessToLocalClaim({ toLocal, funding: { txid: funding.txid, vout: 0, valueSats: funding.valueSats }, identity, baseUrl, destAddress: identity.l1Address });
  };

  /** Broadcasts the payout sweep to the user's L1 settlement address. */
  const runClaim = async (
    toLocal: ToLocalP2trOutput,
    funding: { txid: string; valueSats: bigint },
    identity: Identity,
    baseUrl: string,
  ) => {
    const { claimToLocalPayout } = await import('@ripcord/core/refund');
    const { makeSigner } = await import('@ripcord/core/keys');
    const signer = makeSigner(identity.mnemonic, 'regtest', identity.userKeyDescriptor.index);
    return claimToLocalPayout({
      toLocal,
      funding: { txid: funding.txid, vout: 0, valueSats: funding.valueSats },
      signer,
      destAddress: identity.l1Address,
      baseUrl,
    });
  };

  return { runAssess, runExecute, runAssessClaim, runClaim };
}
