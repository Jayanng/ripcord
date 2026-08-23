import { useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';

export function HoldToConfirmButton({ disabled, onConfirm }: { disabled?: boolean; onConfirm: () => void | Promise<void> }) {
  const timer = useRef<number | undefined>(undefined); const completed = useRef(false); const active = useRef(false); const [holding, setHolding] = useState(false); const [message, setMessage] = useState('Hold for 1.2 seconds');
  const start = () => { if (disabled || active.current) return; completed.current = false; active.current = true; setHolding(true); setMessage('Keep holding…'); timer.current = window.setTimeout(() => { completed.current = true; active.current = false; setHolding(false); setMessage('Confirmed'); void onConfirm(); }, 1200); };
  const stop = () => { if (timer.current) window.clearTimeout(timer.current); if (active.current && !completed.current) setMessage('Hold cancelled'); active.current = false; setHolding(false); };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => { if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) { event.preventDefault(); start(); } };
  const keyUp = (event: KeyboardEvent<HTMLButtonElement>) => { if (event.key === 'Enter' || event.key === ' ') stop(); };
  return <div className="hold-wrap"><button className={`hold-button ${holding ? 'holding' : ''}`} disabled={disabled} onPointerDown={(e: PointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); start(); }} onPointerUp={stop} onPointerCancel={stop} onKeyDown={keyDown} onKeyUp={keyUp}><span className="hold-progress" />PULL RIPCORD</button><span className="hold-message" aria-live="polite">{disabled ? 'Exit must be LIVE before broadcast' : message}</span></div>;
}
