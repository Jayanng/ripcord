interface CustodyComparisonRow {
  name: string;
  detail: string;
  resolution: string;
  isSovereignGuarantee?: boolean;
}

const ROWS: CustodyComparisonRow[] = [
  {
    name: 'Payment channels',
    detail: 'No channel funding transactions, capacity exhaustion, or manual rebalancing.',
    resolution: 'None to open',
  },
  {
    name: 'Inbound liquidity',
    detail: 'Receive satoshis instantly without pre-purchasing inbound route capacity.',
    resolution: 'Not a concept',
  },
  {
    name: 'Force closes',
    detail: 'Deterministic Taproot trees eliminate channel dispute games and toxic state leaks.',
    resolution: 'Cannot happen',
  },
  {
    name: 'Watchtower fees',
    detail: 'Consensus quorum validates off-chain state; zero user monitoring overhead.',
    resolution: 'Node-side',
  },
  {
    name: 'Sovereign exit guarantee',
    detail: 'Pre-signed BIP68 relative timelocks guarantee independent on-chain recovery.',
    resolution: 'Always yours',
    isSovereignGuarantee: true,
  },
];

export function WhatYouDontManage() {
  return (
    <section className="instrument absence-panel" aria-label="Custody comparison">
      <div className="absence-header">
        <p className="absence-eyebrow">Custody without ceremony</p>
        <h2 className="absence-title">Not your problem</h2>
        <p className="absence-subtitle">
          Eliminating the operational overhead and failure modes of traditional Bitcoin second-layer solutions.
        </p>
      </div>

      <dl className="absence-list">
        {ROWS.map((row) => (
          <div
            key={row.name}
            className={`absence-row ${row.isSovereignGuarantee ? 'is-guarantee' : ''}`}
          >
            <div className="absence-left">
              <span
                className={`absence-icon-badge ${row.isSovereignGuarantee ? 'positive' : 'negative'}`}
                aria-hidden="true"
              >
                {row.isSovereignGuarantee ? (
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
                  </svg>
                ) : (
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  >
                    <line x1="3" y1="3" x2="11" y2="11" />
                    <line x1="11" y1="3" x2="3" y2="11" />
                  </svg>
                )}
              </span>
              <dt className="absence-term">
                <span className="absence-name">{row.name}</span>
                <span className="absence-detail">{row.detail}</span>
              </dt>
            </div>

            <dd className="absence-badge-wrap">
              <span
                className={`absence-badge ${row.isSovereignGuarantee ? 'badge-guarantee' : 'badge-eliminated'}`}
              >
                {row.resolution}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
