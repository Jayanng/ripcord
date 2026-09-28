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
