import { useRef, useState, type ReactNode } from 'react';

type Props = {
  onRefresh: () => Promise<void> | void;
  children: ReactNode;
};

const THRESHOLD_PX = 70;

/**
 * Pull-to-refresh (Phase 4): touch gesture with a branded spinner, a haptic
 * tick on release, and a hard rule to never hijack normal scrolling (only
 * engages at scroll top while pulling down).
 */
export function PullToRefresh({ onRefresh, children }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const onTouchStart = (event: React.TouchEvent) => {
    if (refreshing) return;
    if ((container.current?.scrollTop ?? 0) > 0) return;
    startY.current = event.touches[0].clientY;
  };

  const onTouchMove = (event: React.TouchEvent) => {
    if (startY.current === null || refreshing) return;
    const distance = event.touches[0].clientY - startY.current;
    if (distance <= 0) {
      setPull(0);
      return;
    }
    // Dampened drag: half the finger distance, capped at the threshold.
    setPull(Math.min(THRESHOLD_PX, distance / 2));
  };

  const onTouchEnd = () => {
    if (startY.current === null) return;
    startY.current = null;
    const reached = pull >= THRESHOLD_PX;
    setPull(0);
    if (!reached) return;
    try {
      navigator.vibrate?.(10);
    } catch {
      // haptics are optional
    }
    setRefreshing(true);
    void Promise.resolve(onRefresh()).finally(() => setRefreshing(false));
  };

  return (
    <div
      ref={container}
      className="pull-to-refresh"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div
        className={`pull-indicator${refreshing ? ' refreshing' : ''}`}
        style={{ height: refreshing ? 44 : pull, opacity: refreshing ? 1 : pull / THRESHOLD_PX }}
        aria-hidden="true"
      >
        <span className="pull-cord" />
        {refreshing ? 'Refreshing…' : pull >= THRESHOLD_PX ? 'Release to refresh' : 'Pull to refresh'}
      </div>
      {children}
    </div>
  );
}
