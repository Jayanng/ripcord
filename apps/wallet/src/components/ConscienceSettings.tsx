import { useState } from 'react';
import { DEFAULT_CONSCIENCE_SETTINGS, type ConscienceSettings } from '@ripcord/core/spend-conscience';
import { loadSpendLog, saveConscienceSettings, type SpendLogEntry } from '../lib/conscience';

type Props = {
  settings: ConscienceSettings;
  onChange: (next: ConscienceSettings) => void;
};

/**
 * Spend Conscience settings (Phase 3). Everything is off by default and the
 * limits are the user's own numbers. Plain inputs, no jargon, saved on this
 * device only.
 */
export function ConscienceSettings({ settings, onChange }: Props) {
  const [log] = useState<SpendLogEntry[]>(() => loadSpendLog().slice(0, 5));

  const update = (patch: Partial<ConscienceSettings>) => {
    const next = { ...settings, ...patch };
    saveConscienceSettings(next);
    onChange(next);
  };

  const limitInput = (
    value: bigint | null,
    onLimit: (v: bigint | null) => void,
    label: string,
    hint: string,
  ) => (
    <div style={{ display: 'grid', gap: '6px', marginBottom: '14px' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-hi)', fontSize: '13.5px', fontWeight: 600 }}>
        <input
          type="checkbox"
          checked={value !== null}
          onChange={e => onLimit(e.target.checked ? 50_000n : null)}
        />
        {label}
      </label>
      {value !== null && (
        <input
          type="number"
          min={1}
          step={1000}
          value={value.toString()}
          onChange={e => {
            const parsed = Number(e.target.value);
            onLimit(Number.isSafeInteger(parsed) && parsed > 0 ? BigInt(parsed) : null);
          }}
          aria-label={label}
          style={{ width: '180px', padding: '8px 10px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--bg-inset)', color: 'var(--text-hi)', font: '600 14px var(--font-mono)' }}
        />
      )}
      <small style={{ color: 'var(--text-lo)', fontSize: '12px' }}>{hint}</small>
    </div>
  );

  return (
    <details className="instrument balance-details-drawer" style={{ marginTop: '18px' }}>
      <summary className="balance-details-summary" aria-label="Toggle Spend Conscience settings">
        <span>Spend Conscience settings</span>
        <span className="balance-details-chevron" aria-hidden="true">▾</span>
      </summary>
      <div style={{ padding: '4px 2px' }}>
        <p style={{ color: 'var(--text-lo)', fontSize: '12.5px', lineHeight: 1.55, margin: '0 0 14px' }}>
          Your own rules for sending. Everything is off until you turn it on.
          Rules never block a send on their own: they show up for a careful look before the money moves.
        </p>
        {limitInput(
          settings.perTxLimitSats,
          v => update({ perTxLimitSats: v }),
          'Per-send limit (sats)',
          'Flag any single send above this amount.',
        )}
        {limitInput(
          settings.dailyLimitSats,
          v => update({ dailyLimitSats: v }),
          '24-hour limit (sats)',
          'Flag sends once your total in a rolling 24 hours passes this. Counts sends made since this feature existed.',
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-hi)', fontSize: '13.5px', fontWeight: 600, marginBottom: '14px' }}>
          <input
            type="checkbox"
            checked={settings.newRecipientWarn}
            onChange={e => update({ newRecipientWarn: e.target.checked })}
          />
          Warn me about new recipients
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-hi)', fontSize: '13.5px', fontWeight: 600, marginBottom: '6px' }}>
          <input
            type="checkbox"
            checked={settings.largeFractionWarn}
            onChange={e => update({ largeFractionWarn: e.target.checked })}
          />
          Warn me when a send is a large share of my balance
        </label>
        {settings.largeFractionWarn && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-lo)', fontSize: '12.5px', marginBottom: '14px' }}>
            Large means over
            <input
              type="number"
              min={1}
              max={100}
              value={settings.largeFractionPct}
              onChange={e => {
                const parsed = Number(e.target.value);
                if (Number.isFinite(parsed) && parsed > 0 && parsed <= 100) update({ largeFractionPct: parsed });
              }}
              style={{ width: '76px', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg-inset)', color: 'var(--text-hi)', font: '600 13px var(--font-mono)' }}
            />
            % of my spendable balance
          </label>
        )}
        <button
          type="button"
          className="secondary-action"
          onClick={() => {
            saveConscienceSettings(DEFAULT_CONSCIENCE_SETTINGS);
            onChange(DEFAULT_CONSCIENCE_SETTINGS);
          }}
        >
          Turn everything off
        </button>
        {log.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <p style={{ color: 'var(--text-lo)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '.07em', margin: '0 0 8px' }}>
              Recent checks
            </p>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '6px' }}>
              {log.map(entry => (
                <li key={entry.at} style={{ color: 'var(--text-lo)', fontSize: '12px' }}>
                  {new Date(entry.at).toLocaleString()} · {entry.amountSats} sats · {entry.allPassed ? 'all rules passed' : 'rules flagged'} · {entry.recipient.slice(0, 10)}…
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}
