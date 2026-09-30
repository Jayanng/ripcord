/**
 * Skeleton loader (Phase 9, #22): honest placeholders while the first data
 * load runs. Purely visual; never hides a known value.
 */
export function Skeleton({ width = '100%', height = 14, radius = 6 }: { width?: string | number; height?: string | number; radius?: number }) {
  return (
    <span
      className="skeleton-line"
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

/**
 * Immediate styled skeleton of the wallet shell (header + card shapes in the existing design language).
 * Rendered during boot and screen transitions so there is never a blank viewport.
 */
export function WalletSkeleton() {
  return (
    <div className="wallet-shell-skeleton" aria-busy="true" aria-label="Loading wallet" style={{ display: 'grid', gap: '20px' }}>
      {/* Balance Hero Card Skeleton */}
      <section className="instrument balance-card" style={{ padding: '0' }}>
        <div className="section-heading" style={{ padding: '22px 24px' }}>
          <div style={{ display: 'grid', gap: '6px' }}>
            <Skeleton width={130} height={12} radius={6} />
            <Skeleton width={180} height={24} radius={8} />
            <Skeleton width={220} height={14} radius={6} />
          </div>
          <Skeleton width={32} height={32} radius={16} />
        </div>
        <div style={{ padding: '34px 28px', display: 'grid', gap: '12px' }}>
          <Skeleton width={140} height={11} radius={6} />
          <Skeleton width="60%" height={44} radius={10} />
          <Skeleton width={200} height={14} radius={6} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', padding: '18px 24px', borderTop: '1px solid var(--line-subtle)' }}>
          <Skeleton width="100%" height={46} radius={12} />
          <Skeleton width="100%" height={46} radius={12} />
          <Skeleton width="100%" height={46} radius={12} />
        </div>
      </section>

      {/* Vault Status Card Skeleton */}
      <section className="flow-screen" style={{ padding: '28px' }}>
        <div style={{ display: 'grid', gap: '8px', marginBottom: '20px' }}>
          <Skeleton width={160} height={12} radius={6} />
          <Skeleton width={240} height={24} radius={8} />
          <Skeleton width="80%" height={14} radius={6} />
        </div>
        <div style={{ display: 'grid', gap: '12px' }}>
          <Skeleton width="100%" height={70} radius={12} />
          <Skeleton width="100%" height={50} radius={10} />
        </div>
      </section>
    </div>
  );
}

