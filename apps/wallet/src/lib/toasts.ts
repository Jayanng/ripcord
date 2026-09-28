/**
 * Toast notifications (Phase 8, #32). Module-level store so any component
 * can raise a toast without prop drilling; <ToastStack /> renders them.
 */

export interface Toast {
  readonly id: string;
  readonly title: string;
  readonly body?: string;
  readonly href?: string;
  readonly hrefLabel?: string;
  readonly tone: 'info' | 'success' | 'error';
  readonly at: number;
}

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
const listeners = new Set<Listener>();
let counter = 0;

function emit(): void {
  for (const listener of listeners) listener([...toasts]);
}

export function pushToast(toast: Omit<Toast, 'id' | 'at'>, lifetimeMs = 12_000): string {
  const id = `toast-${++counter}`;
  toasts = [...toasts, { ...toast, id, at: Date.now() }].slice(-4);
  emit();
  if (lifetimeMs > 0) {
    setTimeout(() => dismissToast(id), lifetimeMs);
  }
  return id;
}

export function dismissToast(id: string): void {
  const next = toasts.filter(toast => toast.id !== id);
  if (next.length !== toasts.length) {
    toasts = next;
    emit();
  }
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener([...toasts]);
  return () => {
    listeners.delete(listener);
  };
}
