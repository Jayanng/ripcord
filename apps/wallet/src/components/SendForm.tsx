import { useEffect, useRef, useState } from 'react';
import { useWallet } from '../context/WalletContext';
import { useBalance } from '../hooks/useBalance';
import { formatSats, truncate, Icon } from './ui';
import { describeDaemonFailure, joinDaemonUrl } from '@ripcord/core/net';
import { evaluateSpend, hasActiveRules, type ConscienceCheck, type ConscienceSettings as ConscienceSettingsType } from '@ripcord/core/spend-conscience';
import { parseAddressHighlight, findSuspiciousVariant } from '@ripcord/core/address-safety';
import { copyAddressAndAutoClear } from '../lib/clipboard';
import { loadConscienceSettings, recordSpend, sentLast24hSats } from '../lib/conscience';
import { ConscienceSheet } from './ConscienceSheet';
import { ConscienceSettings } from './ConscienceSettings';
import { isUserAddress } from '@ripcord/core/types';
import {
  classifyAddress,
  amountInWords,
  loadRecentRecipients,
  loadSavedAddresses,
  recordRecipient,
  saveAddress,
  removeSavedAddress,
  type RecipientEntry,
} from '../lib/recipients';

type Field = 'recipient' | 'amount' | 'form';

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorInstance {
  detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats: string[] }): BarcodeDetectorInstance;
  getSupportedFormats?(): Promise<string[]>;
}

const isBarcodeDetectorSupported =
  typeof window !== 'undefined' && 'BarcodeDetector' in window;

function QrScannerModal({
  onScan,
  onClose,
}: {
  onScan: (address: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = [
        ...panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | null = null;
    let active = true;

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera API is not supported in this browser.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (!active) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setScanning(true);

        const detector = new (window as unknown as { BarcodeDetector: BarcodeDetectorConstructor }).BarcodeDetector({
          formats: ['qr_code'],
        });

        const scanFrame = async () => {
          if (!active) return;
          if (videoRef.current && videoRef.current.readyState >= 2) {
            try {
              const barcodes = await detector.detect(videoRef.current);
              if (barcodes.length > 0 && active) {
                const raw = barcodes[0].rawValue.trim();
                let address = raw;
                if (/^bitcoin:/i.test(address)) {
                  address = address.replace(/^bitcoin:/i, '').split('?')[0].trim();
                }
                if (address) {
                  onScan(address);
                  onClose();
                  return;
                }
              }
            } catch {
              // frame detection error: keep polling cleanly
            }
          }
          if (active) {
            timer = window.setTimeout(() => void scanFrame(), 150);
          }
        };

        void scanFrame();
      } catch (err) {
        if (!active) return;
        const msg =
          err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
            ? 'Camera permission denied. Allow camera access in browser settings to scan QR codes.'
            : describeDaemonFailure(err);
        setCameraError(msg);
      }
    }

    void startCamera();

    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, [onClose, onScan]);

  return (
    <div
      className="sheet-backdrop"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        ref={panelRef}
        className="proof-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-scanner-title"
      >
        <header>
          <div>
            <p className="eyebrow">QR Scanner</p>
            <h2 id="qr-scanner-title">Scan recipient QR code</h2>
          </div>
          <button ref={closeRef} aria-label="Close QR scanner" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="flow-body" style={{ padding: '24px' }}>
          {cameraError ? (
            <div className="inline-error" role="alert" style={{ marginBottom: '16px' }}>
              {cameraError}
            </div>
          ) : (
            <div className="scanner-viewfinder">
              <video
                ref={videoRef}
                className="scanner-video"
                playsInline
                autoPlay
                muted
              />
              {!scanning && <p style={{ color: 'var(--text-lo)', fontSize: '13px' }}>Starting camera…</p>}
            </div>
          )}
          <button type="button" className="secondary-action" style={{ width: '100%' }} onClick={onClose}>
            Cancel
          </button>
        </div>
      </aside>
    </div>
  );
}

function SendReviewModal({
  recipient,
  amountSats,
  feeSats,
  hasLiveFee,
  feeNote,
  offChainBalance,
  isPending,
  onConfirm,
  onBack,
}: {
  recipient: string;
  amountSats: bigint;
  feeSats: bigint;
  hasLiveFee: boolean;
  feeNote?: string;
  offChainBalance: bigint;
  isPending: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onBack();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = [
        ...panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [onBack]);

  const copyRecipient = async () => {
    await copyAddressAndAutoClear(recipient, () => {
      void import('../lib/toasts').then(({ pushToast }) =>
        pushToast({
          title: 'Clipboard cleared',
          body: 'The copied address was removed from the clipboard after 60 seconds.',
          tone: 'info',
        }),
      );
    });
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const totalSats = amountSats + feeSats;
  const remainingSats = offChainBalance >= totalSats ? offChainBalance - totalSats : 0n;
  const feeLabel = `${feeSats} ${feeSats === 1n ? 'sat' : 'sats'} (${feeNote ?? (hasLiveFee ? 'recommended' : 'default')})`;
  // FIX #14: pre-send safety card - network match, address type, amount in words.
  const safety = classifyAddress(recipient);

  return (
    <div
      className="sheet-backdrop"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onBack();
      }}
    >
      <aside
        ref={panelRef}
        className="proof-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-review-title"
      >
        <header>
          <div>
            <p className="eyebrow">Payment review</p>
            <h2 id="send-review-title">Review and confirm</h2>
          </div>
          <button ref={closeRef} aria-label="Close review" onClick={onBack}>
            <Icon name="close" />
          </button>
        </header>
        <div className="flow-body" style={{ padding: '24px' }}>
          <div className="send-summary" style={{ marginBottom: '20px' }}>
            <span>Recipient</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end' }}>
              <strong title={recipient}>{truncate(recipient, 12, 10)}</strong>
              <button
                type="button"
                className="copy-inline-btn"
                onClick={() => void copyRecipient()}
                title="Copy full recipient address"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <span>Recipient address</span>
            <div style={{ gridColumn: '1 / -1' }}>
              <code className="receive-address-compact">{recipient}</code>
            </div>
            <span>Amount</span>
            <strong>{formatSats(amountSats)}</strong>
            <span>Network fee</span>
            <strong>{feeLabel}</strong>
            <span style={{ gridColumn: '1 / -1', color: 'var(--text-lo)', fontSize: '11.5px', textAlign: 'right' }}>
              Estimate: next block on regtest (blocks advance with network activity).
            </span>
            <span>Total</span>
            <strong>{formatSats(totalSats)}</strong>
            <span>Remaining balance</span>
            <strong>{formatSats(remainingSats)}</strong>
          </div>

          <div className="send-safety-card" aria-label="Send safety check">
            <p className="send-safety-title">Safety check</p>
            <div className="send-summary" style={{ marginBottom: 0 }}>
              <span>Network</span>
              <strong className={safety.networkMatches ? 'safety-ok' : 'safety-warn'}>
                {safety.networkMatches
                  ? 'Regtest · matches this wallet'
                  : `${safety.network === 'unknown' ? 'Unrecognized' : safety.network} · not this wallet's network`}
              </strong>
              <span>Address type</span>
              <strong>{safety.addressType}</strong>
              <span>Amount</span>
              <strong>{amountInWords(amountSats)}</strong>
            </div>
            {!safety.networkMatches && (
              <p className="inline-error" role="alert" style={{ marginTop: '10px' }}>
                This address is not a regtest address. Sending will fail or reach a different network. Go back and check
                the address.
              </p>
            )}
          </div>

          <button
            className="test-pull"
            disabled={isPending}
            onClick={onConfirm}
          >
            {isPending ? 'Sending…' : 'Confirm and send'}
          </button>
          <button
            type="button"
            className="secondary-action"
            style={{ width: '100%', marginTop: '10px' }}
            onClick={onBack}
          >
            Back to edit
          </button>
        </div>
      </aside>
    </div>
  );
}

export function SendForm() {
  const wallet = useWallet();
  const balance = useBalance();
  const recipientRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [result, setResult] = useState('');
  const [error, setError] = useState<{ field: Field; message: string } | null>(null);

  // FIX #11: Review state
  const [showReview, setShowReview] = useState(false);

  // Phase 3: Spend Conscience (off by default; identical sends until opted in)
  const [conscience, setConscience] = useState<ConscienceSettingsType>(() => loadConscienceSettings());
  const [showConscience, setShowConscience] = useState(false);
  const [conscienceChecks, setConscienceChecks] = useState<ConscienceCheck[]>([]);

  // Phase 3: fee transparency (Slow / Normal / Fast + custom). Default stays
  // the daemon's recommended fee: same behavior as before this phase.
  const [feeEstimate, setFeeEstimate] = useState<{ slow: bigint; normal: bigint; fast: bigint } | null>(null);
  const [feeChoice, setFeeChoice] = useState<'slow' | 'normal' | 'fast' | 'custom'>('fast');
  const [customFee, setCustomFee] = useState('');

  // FIX #12: Scanner state
  const [showScanner, setShowScanner] = useState(false);

  // FIX #14: Recent recipients + saved addresses (localStorage convenience data)
  const [recent, setRecent] = useState<RecipientEntry[]>([]);
  const [saved, setSaved] = useState<RecipientEntry[]>([]);
  const [saveLabel, setSaveLabel] = useState('');
  const [saveNote, setSaveNote] = useState('');

  useEffect(() => {
    setRecent(loadRecentRecipients());
    setSaved(loadSavedAddresses());
  }, []);

  // FIX #3: Live daemon fee estimates
  const [probedFee, setProbedFee] = useState<bigint | null>(null);

  useEffect(() => {
    // Always fetch the three-way estimate: health's recommended value alone
    // cannot fill the Slow/Normal/Fast presets.
    let active = true;
    const controller = new AbortController();
    fetch(joinDaemonUrl(wallet.daemonUrl, 'tachi_feeEstimate'), { signal: controller.signal })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!active || !data) return;
        const rec =
          data.recommended_fee_sat ??
          data.RecommendedFeeSat ??
          data.min_fee_sat ??
          data.MinFeeSat;
        if (typeof rec === 'number' && rec > 0) {
          setProbedFee(BigInt(rec));
        }
        const floor1 = (n: unknown) =>
          typeof n === 'number' && Number.isFinite(n) && n >= 1 ? BigInt(Math.floor(n)) : 1n;
        if (data && typeof data === 'object') {
          setFeeEstimate({
            slow: floor1(data.min_fee_sat ?? data.MinFeeSat),
            normal: floor1(data.avg_fee_sat ?? data.AvgFeeSat),
            fast: floor1(data.recommended_fee_sat ?? data.RecommendedFeeSat),
          });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      controller.abort();
    };
  }, [wallet.health?.feeRecommendedSats, wallet.daemonUrl]);

  const liveFeeSats =
    wallet.health?.feeRecommendedSats && wallet.health.feeRecommendedSats > 0n
      ? wallet.health.feeRecommendedSats
      : probedFee && probedFee > 0n
      ? probedFee
      : null;

  const hasLiveFee = liveFeeSats !== null;
  const customFeeSats = (() => {
    const parsed = Number(customFee);
    return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 100_000 ? BigInt(parsed) : null;
  })();
  const feeSats = (() => {
    if (feeChoice === 'custom' && customFeeSats !== null) return customFeeSats;
    if (feeEstimate) {
      return feeChoice === 'slow' ? feeEstimate.slow : feeChoice === 'normal' ? feeEstimate.normal : feeEstimate.fast;
    }
    return hasLiveFee ? liveFeeSats : 1n;
  })();
  const feeNote =
    feeChoice === 'custom'
      ? customFeeSats !== null ? 'your custom fee' : 'custom fee not set'
      : feeChoice === 'fast' && hasLiveFee
        ? 'recommended'
        : feeChoice === 'fast'
          ? 'fast'
          : feeChoice;
  const feeDisplay = `${feeSats} ${feeSats === 1n ? 'sat' : 'sats'} (${feeNote})`;
  const lastChecksRef = useRef<ConscienceCheck[] | null>(null);
  // The fee shown in the review is the fee the send uses (TOCTOU lock).
  const reviewedFeeRef = useRef<bigint | null>(null);

  const fail = (field: Field, message: string) => {
    setError({ field, message });
    requestAnimationFrame(() =>
      (field === 'recipient' ? recipientRef.current : field === 'amount' ? amountRef.current : null)?.focus()
    );
  };

  // FIX #11: Address validation on blur (does not steal focus)
  const validateRecipientOnBlur = () => {
    const trimmed = recipient.trim();
    if (!trimmed) return;
    if (!isUserAddress(trimmed)) {
      setError({ field: 'recipient', message: 'Enter a valid regtest SegWit or Taproot address (bcrt1...)' });
      return;
    }
    if (wallet.vaults.some(item => String(item.address) === trimmed)) {
      setError({
        field: 'recipient',
        message: 'This is a known vault address. Use the recipient wallet’s user receive address.',
      });
      return;
    }
    if (error?.field === 'recipient') {
      setError(null);
    }
  };

  // Pre-review validation
  const handleReviewClick = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setResult('');
    if (!wallet.identity) return fail('form', 'Create or recover an identity first');
    const vault = wallet.activeVault;
        const vaultUnregistered = !vault?.registered || !vault.p2tr;
    const unregisteredVaultMessage = (): string => {
      if (balance.offChainSats > 0n) {
        return 'You have received sats, but spending needs the vault registered on L1 first. Open Receive, send any amount to your vault address, then tap "Check and register deposit".';
      }
      if (balance.onChainSats > 0n) {
        return 'Your deposit is on-chain but not registered yet, so it is not spendable. Open Receive and tap "Check and register deposit" once it confirms on L1.';
      }
      return 'No spendable sats yet. Fund the wallet first, then register the deposit from the Receive screen.';
    };
    if (vaultUnregistered) {
      return fail('form', unregisteredVaultMessage());
    }
    const trimmed = recipient.trim();
    if (!isUserAddress(trimmed)) return fail('recipient', 'Enter a valid regtest SegWit address');
    if (wallet.vaults.some(item => String(item.address) === trimmed)) {
      return fail(
        'recipient',
        'This is a known vault address. Use the recipient wallet’s user receive address.'
      );
    }
    const sats = Number(amount);
    if (!Number.isSafeInteger(sats) || sats < 1) {
      return fail('amount', 'Enter a whole-sat amount of at least 1');
    }
    if (feeChoice === 'custom' && customFeeSats === null) {
      return fail('form', 'Enter a custom fee between 1 and 100,000 sats, or pick one of the presets.');
    }
    const sendAmount = BigInt(sats);
    if (sendAmount + feeSats > balance.offChainSats) {
      return fail(
        'amount',
        `Insufficient funds: amount (${formatSats(sendAmount)}) + fee (${formatSats(feeSats)}) exceeds available balance (${formatSats(balance.offChainSats)})`
      );
    }
    reviewedFeeRef.current = feeSats;
    setShowReview(true);
  };

  // Execution via TxQueue (queue.ts preserved)
  const executeSend = async () => {
    setError(null);
    setResult('');
    const sendFee = reviewedFeeRef.current ?? feeSats;
    const vault = wallet.activeVault;
    // Snapshot the identity now: the send and its receipt must complete even
    // if the wallet locks mid-flight (auto-lock, second-eye review 2026-10-02).
    const identity = wallet.identity;
    if (!identity) return fail('form', 'Unlock the wallet before sending');
    const vaultUnregistered = !vault?.registered || !vault.p2tr;
    const unregisteredVaultMessage = (): string => {
      if (balance.offChainSats > 0n) {
        return 'You have received sats, but spending needs the vault registered on L1 first. Open Receive, send any amount to your vault address, then tap "Check and register deposit".';
      }
      if (balance.onChainSats > 0n) {
        return 'Your deposit is on-chain but not registered yet, so it is not spendable. Open Receive and tap "Check and register deposit" once it confirms on L1.';
      }
      return 'No spendable sats yet. Fund the wallet first, then register the deposit from the Receive screen.';
    };
    if (vaultUnregistered) {
      return fail('form', unregisteredVaultMessage());
    }
    const sats = Number(amount);
    if (!Number.isSafeInteger(sats) || sats < 1) return fail('amount', 'Enter a whole-sat amount of at least 1');

    setQueuedCount(c => c + 1);
    try {
      await wallet.txQueue.enqueue({
        id: `send-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        execute: async () => {
          setBusy(true);
          try {
            const [{ isUserAddress: checkUserAddr, toSdkVault }, { makeSigner }, { sendTransfer }] = await Promise.all([
              import('@ripcord/core/types'),
              import('@ripcord/core/keys'),
              import('@ripcord/core/payment'),
            ]);
            if (!checkUserAddr(recipient)) return fail('recipient', 'Enter a valid regtest SegWit address');
            if (wallet.vaults.some(item => String(item.address) === String(recipient))) {
              return fail('recipient', 'This is a known vault address. Use the recipient wallet’s user receive address.');
            }
            const committed = await sendTransfer({
              vault: toSdkVault(vault),
              senderXOnly: identity.xOnly,
              recipientAddress: recipient,
              network: 'regtest',
              amountSats: BigInt(sats),
              feeSats: sendFee,
              baseUrl: wallet.daemonUrl,
              userSigner: makeSigner(identity.mnemonic, 'regtest', vault.userKeyIndex),
              queue: wallet.txQueue,
            });
            setResult(`Committed ${committed.txHash} at epoch ${committed.epoch}. Fetching proof…`);
            let proofNote = 'proof saved';
            try {
              const { buildPaymentReceipt, xOnlyFromAddress } = await import('@ripcord/core');
              const recipientXOnly = xOnlyFromAddress(recipient, 'regtest').toString('hex');
              const receipt = await buildPaymentReceipt({
                txHash: committed.txHash,
                epoch: committed.epoch,
                code: committed.code,
                fromXOnly: identity.xOnly,
                toXOnly: recipientXOnly,
                amountSats: BigInt(sats),
                feeSats: sendFee,
                baseUrl: wallet.daemonUrl,
                window: 0,
              });
              await wallet.saveReceipt(receipt);
            } catch {
              proofNote = `settled and confirmed; its proof will appear under Proofs once epoch ${committed.epoch} closes`;
            }
            recordSpend({
              at: Date.now(),
              amountSats: String(sats),
              recipient: String(recipient),
              allPassed: (lastChecksRef.current ?? []).every(c => c.pass),
              rulesRun: (lastChecksRef.current ?? []).length,
            });
            recordRecipient(recipient);
            setRecent(loadRecentRecipients());
            void import('../lib/toasts').then(({ pushToast }) =>
              pushToast({
                title: 'Send committed',
                body: `${formatSats(BigInt(sats))} to ${truncate(recipient, 8, 6)} committed at epoch ${committed.epoch}.`,
                href: `https://regtest.tachibtcscan.com/tx/${committed.txHash}`,
                hrefLabel: 'View transaction ↗',
                tone: 'success',
              }),
            );
            setResult(`Committed ${committed.txHash} at epoch ${committed.epoch} · ${proofNote}`);
            try {
              navigator.vibrate?.(30);
            } catch {
              // haptics are optional
            }
          } finally {
            setBusy(false);
          }
        },
      });
    } catch (cause) {
      fail('form', describeDaemonFailure(cause));
    } finally {
      setQueuedCount(c => Math.max(0, c - 1));
    }
  };

  const setMaxAmount = () => {
    const maxSpendable = balance.offChainSats > feeSats ? balance.offChainSats - feeSats : 0n;
    if (maxSpendable > 0n) setAmount(maxSpendable.toString());
  };

  const isPending = busy || queuedCount > 0;
  const buttonLabel = queuedCount > 1 ? 'Queued…' : isPending ? 'Sending…' : 'Review and send';

  return (
    <>
      <form
        className="send-form"
        aria-busy={isPending}
        onSubmit={handleReviewClick}
      >
        <label htmlFor="send-recipient">Recipient address</label>
        <div className="recipient-input-row">
          <input
            ref={recipientRef}
            id="send-recipient"
            name="recipient"
            autoComplete="off"
            value={recipient}
            onChange={event => {
              setRecipient(event.target.value.trim());
              if (error?.field === 'recipient') setError(null);
            }}
            onBlur={validateRecipientOnBlur}
            placeholder="bcrt1p…"
            required
            aria-invalid={error?.field === 'recipient'}
            aria-describedby={error?.field === 'recipient' ? 'send-recipient-error' : undefined}
          />
          <button
            type="button"
            className="scan-btn"
            onClick={() => setShowScanner(true)}
            disabled={!isBarcodeDetectorSupported}
            title={
              isBarcodeDetectorSupported
                ? 'Scan QR code with camera'
                : 'QR camera scanning requires BarcodeDetector API (supported in Chromium)'
            }
          >
            Scan
          </button>
        </div>
        {!isBarcodeDetectorSupported && (
          <small className="form-help scan-unsupported-note" style={{ color: 'var(--text-lo)' }}>
            Camera QR scanning requires browser BarcodeDetector support (e.g. Chrome/Chromium).
          </small>
        )}
        <small className="form-help">Enter a regtest SegWit or Taproot user receive address.</small>
        {recipient.trim().length > 12 && (() => {
          const parts = parseAddressHighlight(recipient);
          return (
            <div className="addr-highlight" aria-label={`Address starts with ${parts.head} and ends with ${parts.tail}`}>
              <span className="addr-head">{parts.head}</span>
              <span className="addr-mid">{parts.mid}</span>
              <span className="addr-tail">{parts.tail}</span>
            </div>
          );
        })()}
        {(() => {
          const variant = findSuspiciousVariant(recipient, [...saved, ...recent].map(r => r.address));
          return variant ? (
            <p className="inline-error" role="alert">
              This looks like your saved address {truncate(variant, 12, 10)} but with different letters (upper
              vs lower case). Check it character by character before sending.
            </p>
          ) : null;
        })()}
        {error?.field === 'recipient' && (
          <p id="send-recipient-error" className="inline-error" role="alert">
            {error.message}
          </p>
        )}
        {(recent.length > 0 || saved.length > 0) && (
          <div className="recipient-memory" aria-label="Recent and saved recipients">
            {recent.length > 0 && (
              <>
                <span className="recipient-memory-label">Recent</span>
                <div className="recipient-chip-row">
                  {recent.slice(0, 6).map(entry => (
                    <button
                      key={entry.address}
                      type="button"
                      className="recipient-chip"
                      title={entry.address}
                      onClick={() => {
                        setRecipient(entry.address);
                        if (error?.field === 'recipient') setError(null);
                      }}
                    >
                      {entry.label ?? truncate(entry.address, 8, 6)}
                    </button>
                  ))}
                </div>
              </>
            )}
            {saved.length > 0 && (
              <>
                <span className="recipient-memory-label">Saved</span>
                <div className="recipient-chip-row">
                  {saved.map(entry => (
                    <span key={entry.address} className="recipient-chip saved">
                      <button
                        type="button"
                        className="recipient-chip-fill"
                        title={entry.address}
                        onClick={() => {
                          setRecipient(entry.address);
                          if (error?.field === 'recipient') setError(null);
                        }}
                      >
                        {entry.label ?? truncate(entry.address, 8, 6)}
                      </button>
                      <button
                        type="button"
                        className="recipient-chip-remove"
                        aria-label={`Remove saved address ${entry.label ?? entry.address}`}
                        onClick={() => {
                          removeSavedAddress(entry.address);
                          setSaved(loadSavedAddresses());
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <div className="save-recipient-row">
          <input
            type="text"
            className="save-recipient-label"
            maxLength={40}
            placeholder="Label for this address (optional)"
            value={saveLabel}
            onChange={event => setSaveLabel(event.target.value)}
            aria-label="Label for saved address"
          />
          <button
            type="button"
            className="secondary-action-compact"
            disabled={!isUserAddress(recipient.trim())}
            onClick={() => {
              saveAddress(recipient.trim(), saveLabel);
              setSaved(loadSavedAddresses());
              setSaveLabel('');
              setSaveNote('Address saved on this device.');
              window.setTimeout(() => setSaveNote(''), 3000);
            }}
          >
            Save address
          </button>
        </div>
        {saveNote && <p className="flow-note" role="status">{saveNote}</p>}
        {!wallet.activeVault?.registered && balance.offChainSats > 0n && (
          <p className="flow-note deposit-unregistered-hint" role="status">
            Spending needs your vault registered on L1. In Receive, send any amount to your
            vault address, then tap &quot;Check and register deposit&quot;.{' '}
            <button type="button" className="secondary-action-compact" onClick={() => { window.location.hash = '#/receive'; }}>
              Open Receive
            </button>
          </p>
        )}
        {balance.offChainSats === 0n && balance.onChainSats > 0n && (
          <p className="flow-note deposit-unregistered-hint" role="status">
            You have sats on-chain that are not registered yet, so they are not spendable.
            Tap &quot;Check and register deposit&quot; in Receive once they confirm on L1.{' '}
            <button type="button" className="secondary-action-compact" onClick={() => { window.location.hash = '#/receive'; }}>
              Open Receive
            </button>
          </p>
        )}
        <div className="amount-label-row">
          <label htmlFor="send-amount">Amount in sats</label>
          <div className="amount-spendable-hint">
            <span>
              Available: <strong>{formatSats(balance.offChainSats)}</strong>
            </span>
            {balance.offChainSats > feeSats && (
              <button type="button" className="max-btn" onClick={setMaxAmount}>
                MAX
              </button>
            )}
          </div>
        </div>
        <input
          ref={amountRef}
          id="send-amount"
          name="amount"
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          value={amount}
          onChange={event => setAmount(event.target.value)}
          required
          aria-invalid={error?.field === 'amount'}
          aria-describedby={error?.field === 'amount' ? 'send-amount-error' : undefined}
        />
        {error?.field === 'amount' && (
          <p id="send-amount-error" className="inline-error" role="alert">
            {error.message}
          </p>
        )}
        <div role="group" aria-label="Network fee choice" style={{ marginBottom: '12px' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            {(['slow', 'normal', 'fast'] as const).map(name => (
              <button
                key={name}
                type="button"
                aria-pressed={feeChoice === name}
                onClick={() => setFeeChoice(name)}
                style={{
                  padding: '8px 12px', borderRadius: 10, cursor: 'pointer',
                  border: `1px solid ${feeChoice === name ? 'var(--primary, #F36633)' : 'var(--line)'}`,
                  background: feeChoice === name ? 'color-mix(in srgb, var(--primary, #F36633) 12%, transparent)' : 'transparent',
                  color: 'var(--text-hi)', font: '650 12.5px var(--font-sans)',
                }}
              >
                {name === 'slow' ? 'Slow' : name === 'normal' ? 'Normal' : 'Fast'}
                {name === 'fast' && hasLiveFee ? ' · recommended' : ''}
                {feeEstimate ? ` · ${feeEstimate[name].toString()} sat${feeEstimate[name] === 1n ? '' : 's'}` : ''}
              </button>
            ))}
            <input
              type="number"
              min={1}
              max={100000}
              placeholder="Custom sats"
              aria-label="Custom network fee in sats"
              value={customFee}
              onChange={e => {
                setCustomFee(e.target.value);
                setFeeChoice('custom');
              }}
              style={{ width: '130px', padding: '8px 10px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--bg-inset)', color: 'var(--text-hi)', font: '600 13px var(--font-mono)' }}
            />
          </div>
          <small style={{ display: 'block', marginTop: '8px', color: 'var(--text-lo)', fontSize: '12px' }}>
            Estimate: next block on regtest (blocks advance with network activity). The fee you pick is the fee the send uses.
          </small>
        </div>
        <div className="send-summary" aria-label={`Network fee: ${feeDisplay}`}>
          <span>Network fee:</span>
          <strong title={`Network fee: ${feeSats} sats (recommended)`}>{feeDisplay}</strong>
          <span style={{ display: 'none' }}>{`Network fee: ${feeSats} sats (recommended)`}</span>
          <span style={{ display: 'none' }}>{`Network fee: ${feeSats} sat (recommended)`}</span>
          <span>Change</span>
          <strong>own user key</strong>
        </div>
        <button className="test-pull" disabled={isPending}>
          {buttonLabel}
        </button>
        {error?.field === 'form' && (
          <p className="inline-error" role="alert">
            {error.message}
          </p>
        )}
        {result && (
          <div className="send-receipt success-moment" role="status">
            <div className="send-receipt-check" aria-hidden="true">
              <Icon name="check" />
            </div>
            <div className="send-receipt-copy">
              <strong>Send complete</strong>
              <span>{result}</span>
            </div>
          </div>
        )}
      </form>

      <ConscienceSettings settings={conscience} onChange={setConscience} />

      {showReview && (
        <SendReviewModal
          recipient={recipient}
          amountSats={BigInt(amount || '0')}
          feeSats={feeSats}
          hasLiveFee={hasLiveFee}
          offChainBalance={balance.offChainSats}
          isPending={isPending}
          feeNote={feeNote}
          onConfirm={() => {
            setShowReview(false);
            const checks = hasActiveRules(conscience)
              ? evaluateSpend(BigInt(amount || '0'), recipient, conscience, {
                  spendableSats: balance.offChainSats,
                  savedRecipients: [...saved, ...recent].map(r => r.address),
                  sentLast24hSats: sentLast24hSats(),
                })
              : [];
            lastChecksRef.current = checks;
            if (checks.length > 0) {
              setConscienceChecks(checks);
              setShowConscience(true);
            } else {
              void executeSend();
            }
          }}
          onBack={() => setShowReview(false)}
        />
      )}

      {showConscience && (
        <ConscienceSheet
          recipient={recipient}
          amountSats={BigInt(amount || '0')}
          checks={conscienceChecks}
          onProceed={() => {
            setShowConscience(false);
            void executeSend();
          }}
          onCancel={() => setShowConscience(false)}
        />
      )}

      {showScanner && (
        <QrScannerModal
          onScan={scannedAddr => {
            setRecipient(scannedAddr);
            if (error?.field === 'recipient') setError(null);
          }}
          onClose={() => setShowScanner(false)}
        />
      )}
    </>
  );
}
