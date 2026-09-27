import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui';
import { describeDaemonFailure } from '@ripcord/core/net';
import { addressToScriptPubKeyHex, type ExplicitSpendableInput } from '@ripcord/core/deposit';

type State = 'idle' | 'requesting' | 'waiting' | 'confirmed' | 'error';
type Props = {
  address: string;
  onClose: () => void;
  onConfirmed?: (txid: string, explicitInput?: ExplicitSpendableInput) => void;
};

const keyFor = (address: string) => `ripcord:faucet:${address}`;
// Same-origin by contract (dev Vite proxy / deployment rewrites carry it to
// faucet.tachibtc.com); override with VITE_FAUCET_URL for other hosts.
const FAUCET_URL = (import.meta.env.VITE_FAUCET_URL as string | undefined) || '/faucet/api/faucet';

export function FaucetModal({ address, onClose, onConfirmed }: Props) {
  const [state, setState] = useState<State>('idle');
  const [message, setMessage] = useState('');
  const panel = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const nodes = [...panel.current.querySelectorAll<HTMLElement>('button,[href],input,textarea,[tabindex]:not([tabindex="-1"])')];
      if (!nodes.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      abortRef.current?.abort();
      previous?.focus();
    };
  }, [onClose]);

  const resolvePayoutOutput = async (txid: string, targetAddress: string): Promise<ExplicitSpendableInput | null> => {
    let expectedScript = '';
    try {
      expectedScript = addressToScriptPubKeyHex(targetAddress, 'regtest').toLowerCase();
    } catch {
      // ignore
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const response = await fetch('/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'getrawtransaction',
            params: [txid, true],
          }),
        });
        if (response.ok) {
          const payload = (await response.json()) as {
            result?: {
              txid: string;
              vout: Array<{ n: number; value: number; scriptPubKey: { hex: string; address?: string } }>;
            };
          };
          const match = payload.result?.vout?.find(
            v => (expectedScript && v.scriptPubKey.hex.toLowerCase() === expectedScript) || v.scriptPubKey.address === targetAddress
          );
          if (match) {
            return {
              txid,
              vout: match.n,
              amountSats: BigInt(Math.round(match.value * 1e8)),
              scriptPubKey: match.scriptPubKey.hex,
            };
          }
        }
      } catch {
        // retry
      }
      await new Promise(r => setTimeout(r, 250));
    }
    return null;
  };

  const waitForConfirmation = async (txid: string) => {
    const started = Date.now();
    const controller = new AbortController();
    abortRef.current = controller;
    setState('waiting');
    while (!controller.signal.aborted) {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      setMessage(`Funding broadcast: ${txid} · checking live confirmation (${elapsed}s elapsed)`);
      try {
        const response = await fetch('/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
          body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'getrawtransaction', params: [txid, true] }),
        });
        const payload = (await response.json()) as { result?: { confirmations?: number }; error?: { message?: string } };
        if ((payload.result?.confirmations ?? 0) > 0) {
          setState('confirmed');
          setMessage(`Funding confirmed: ${payload.result!.confirmations} confirmation(s). Starting vault setup…`);
          window.setTimeout(() => onConfirmed?.(txid), 900);
          return;
        }
        if (payload.error && !/no such mempool|not found/i.test(payload.error.message ?? '')) {
          throw new Error(payload.error.message ?? 'Bitcoin RPC lookup failed');
        }
        setMessage(`Funding is in the mempool: ${txid} · 0 confirmations · regtest blocks arrive on the live chain, not on a UI timer`);
      } catch (error) {
        if (controller.signal.aborted) return;
        const errMsg =
          error instanceof Error && /timeout/i.test(error.message)
            ? 'Bitcoin RPC check timed out; retrying live confirmation.'
            : describeDaemonFailure(error, { url: '/rpc', method: 'POST' });
        setMessage(`${errMsg} (${Math.floor((Date.now() - started) / 1000)}s elapsed)`);
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  };

  useEffect(() => {
    const saved = localStorage.getItem(keyFor(address));
    if (saved && /^[0-9a-f]{64}$/i.test(saved)) {
      setMessage(`Resuming funding broadcast: ${saved} · checking live confirmation`);
      void (async () => {
        const explicitInput = await resolvePayoutOutput(saved, address);
        if (explicitInput) {
          onConfirmed?.(saved, explicitInput);
        }
        await waitForConfirmation(saved);
      })();
    }
  }, [address]);

  const request = async () => {
    setState('requesting');
    setMessage('');
    try {
      const response = await fetch(FAUCET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, amountBtc: 0.5 }),
      });
      const text = await response.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
      if (!response.ok) {
        throw new Error(
          typeof data === 'object' && data && 'error' in data
            ? String((data as { error: unknown }).error)
            : `Faucet HTTP ${response.status}` + (text && !/^\s*</.test(text) && text.length < 300 ? `: ${text}` : '')
        );
      }
      const txid = typeof data === 'object' && data && 'txid' in data ? String((data as { txid: unknown }).txid) : '';
      if (!/^[0-9a-f]{64}$/i.test(txid)) {
        throw new Error('Faucet response did not include a valid funding txid');
      }
      localStorage.setItem(keyFor(address), txid);

      // 0-conf chaining: resolve payout output immediately from mempool and pass downstream
      const explicitInput = await resolvePayoutOutput(txid, address);
      if (explicitInput) {
        setMessage(`Funding broadcast: ${txid} · chained deposit input resolved · proceeding with single block wait`);
        onConfirmed?.(txid, explicitInput);
      } else {
        setMessage(`Funding broadcast: ${txid} · waiting for live confirmation`);
        onConfirmed?.(txid);
      }

      await waitForConfirmation(txid);
    } catch (error) {
      setState('error');
      setMessage(describeDaemonFailure(error, { url: FAUCET_URL, method: 'POST' }));
    }
  };

  const buttonLabel =
    state === 'requesting'
      ? 'Requesting…'
      : state === 'waiting'
      ? 'Waiting for confirmation…'
      : state === 'confirmed'
      ? 'Confirmed'
      : 'Request 0.5 regtest BTC';

  return (
    <div
      className="sheet-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside ref={panel} className="proof-sheet" role="dialog" aria-modal="true" aria-labelledby="faucet-title">
        <header>
          <div>
            <p className="eyebrow">Regtest funding</p>
            <h2 id="faucet-title">Request faucet funds</h2>
          </div>
          <button ref={close} aria-label="Close faucet" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="flow-body">
          <p>
            The faucet sends 0.5 regtest BTC to your L1 settlement address. Ripcord immediately chains your 40,000 sat vault
            deposit without waiting for an intermediate confirmation, cutting funding to a single block wait (~10 min worst
            case, ~5 min average). Both transactions confirm together in the same block.
          </p>
          <p className="flow-note">
            The test network produces Bitcoin blocks automatically about every 10 minutes. You can close this panel and return
            later. Your transaction is saved and setup will resume automatically when the block lands.
          </p>
          <code>{address}</code>
          <button
            className="test-pull"
            disabled={state === 'requesting' || state === 'waiting' || state === 'confirmed'}
            onClick={() => void request()}
          >
            {buttonLabel}
          </button>
          {message && (
            <p role="status" className={state === 'error' ? 'inline-error' : state === 'confirmed' ? 'flow-note' : 'inline-note'}>
              {message}
            </p>
          )}
          {state === 'waiting' && (
            <button className="secondary-action" onClick={onClose}>
              Explore wallet while waiting →
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
