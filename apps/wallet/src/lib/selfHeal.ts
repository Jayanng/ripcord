/**
 * Stale-cache self-healing and service worker lifecycle guard.
 *
 * Prevents stale service worker caches and old HTML referencing superseded
 * hashed chunks from stranding clients with broken layouts or blank screens.
 */

export const STALE_RELOAD_KEY = 'ripcord:stale_reload_attempted';
export const CONTROLLER_RELOAD_KEY = 'ripcord:controller_reload_attempted';
export const CHUNK_RELOAD_KEY = 'ripcord:chunk_reload_attempted';

/**
 * Unregisters ALL service workers across any scope and purges all CacheStorage entries.
 */
export async function purgeServiceWorkersAndCaches(): Promise<void> {
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(r => r.unregister()));
    } catch (e) {
      console.warn('[self-heal] Failed to unregister service workers:', e);
    }
  }

  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    } catch (e) {
      console.warn('[self-heal] Failed to clear CacheStorage:', e);
    }
  }
}

/**
 * Renders a lightweight, persistent banner indicating an update is available.
 * Shown when reload loop prevention prevents an automatic reload.
 */
export function showUpdateBanner(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('ripcord-update-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'ripcord-update-banner';
  banner.setAttribute('role', 'alert');
  banner.setAttribute('aria-live', 'assertive');

  banner.style.cssText = [
    'position: fixed',
    'top: 14px',
    'left: 50%',
    'transform: translateX(-50%)',
    'z-index: 999999',
    'display: inline-flex',
    'align-items: center',
    'gap: 12px',
    'background: #0F172A',
    'color: #F8FAFC',
    'padding: 8px 14px',
    'border-radius: 9999px',
    'box-shadow: 0 4px 20px rgba(0, 0, 0, 0.28)',
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    'font-size: 13px',
    'font-weight: 600',
    'max-width: calc(100vw - 32px)',
  ].join(';');

  const label = document.createElement('span');
  label.textContent = 'Update available';
  label.style.whiteSpace = 'nowrap';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Tap to refresh';
  btn.style.cssText = [
    'background: #F36633',
    'color: #FFFFFF',
    'border: none',
    'padding: 6px 14px',
    'border-radius: 9999px',
    'font-family: inherit',
    'font-size: 12px',
    'font-weight: 700',
    'cursor: pointer',
    'white-space: nowrap',
    'min-height: 44px',
    'display: inline-flex',
    'align-items: center',
    'justify-content: center',
  ].join(';');

  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Refreshing…';
    try {
      sessionStorage.removeItem(STALE_RELOAD_KEY);
      sessionStorage.removeItem(CONTROLLER_RELOAD_KEY);
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      await purgeServiceWorkersAndCaches();
    } catch {
      // ignore
    }
    window.location.reload();
  };

  banner.appendChild(label);
  banner.appendChild(btn);
  document.body.appendChild(banner);
}

/**
 * Boot guard: compares running bundle build ID against /build-id.json from server.
 * If mismatched, purges SW/caches and reloads once. If mismatch persists after one reload,
 * displays update banner instead of looping.
 */
export async function runBootGuard(): Promise<void> {
  if (typeof window === 'undefined') return;

  const currentBuildId = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : undefined;
  if (!currentBuildId) return;

  try {
    const res = await fetch(`/build-id.json?_t=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
    });

    if (!res.ok) {
      // Server returned non-200 (e.g. offline, 404); do not treat as stale mismatch
      return;
    }

    const data = await res.json();
    const remoteId = data?.buildId || data?.id;
    if (!remoteId || typeof remoteId !== 'string') return;

    if (remoteId !== currentBuildId) {
      console.warn(`[self-heal] Build ID mismatch (baked: ${currentBuildId}, server: ${remoteId})`);
      const alreadyAttempted = sessionStorage.getItem(STALE_RELOAD_KEY);
      if (!alreadyAttempted) {
        sessionStorage.setItem(STALE_RELOAD_KEY, remoteId);
        await purgeServiceWorkersAndCaches();
        window.location.reload();
        return;
      }
      showUpdateBanner();
    } else {
      // Current build matches server build: clear reload flag
      sessionStorage.removeItem(STALE_RELOAD_KEY);
    }
  } catch (err) {
    // Network error or offline: skip check without interrupting app
    console.debug('[self-heal] Boot guard skipped:', err);
  }
}

/**
 * Controller change guard: when a new SW activates and claims clients,
 * reloads once to ensure consistent asset retrieval across all chunks.
 */
export function setupControllerChangeListener(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const hadController = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only reload when transitioning from an existing controller to a new one
    if (!hadController) return;
    if (refreshing) return;
    refreshing = true;

    const alreadyAttempted = sessionStorage.getItem(CONTROLLER_RELOAD_KEY);
    if (!alreadyAttempted) {
      sessionStorage.setItem(CONTROLLER_RELOAD_KEY, '1');
      window.location.reload();
    } else {
      showUpdateBanner();
    }
  });

  if (sessionStorage.getItem(CONTROLLER_RELOAD_KEY)) {
    setTimeout(() => {
      sessionStorage.removeItem(CONTROLLER_RELOAD_KEY);
    }, 4000);
  }
}

/**
 * Checks whether an error represents a failed dynamic chunk or module load.
 */
export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const message = (
    typeof err === 'string'
      ? err
      : (err as any).message || (err as any).reason?.message || (err as any).name || ''
  ).toLowerCase();

  return (
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('importing a module script failed') ||
    message.includes('error loading dynamically imported module') ||
    message.includes('loading chunk') ||
    message.includes('chunkloaderror') ||
    message.includes('failed to load module script') ||
    message.includes('error loading chunk')
  );
}

/**
 * Triggers self-healing on dynamic chunk load failure:
 * purges SW and caches, reloads once; shows banner if loop guard tripped.
 */
export async function handleChunkLoadError(err?: unknown): Promise<void> {
  console.warn('[self-heal] Chunk load error caught:', err);
  const alreadyAttempted = sessionStorage.getItem(CHUNK_RELOAD_KEY);
  if (!alreadyAttempted) {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
    await purgeServiceWorkersAndCaches();
    window.location.reload();
  } else {
    showUpdateBanner();
  }
}

/**
 * Registers global listeners for Vite preload errors and dynamic import rejections.
 */
export function setupChunkErrorListeners(): void {
  if (typeof window === 'undefined') return;

  // Vite specific preload error event
  window.addEventListener('vite:preloadError', (event) => {
    void handleChunkLoadError((event as any)?.payload || 'vite:preloadError');
  });

  // Unhandled dynamic import rejection
  window.addEventListener('unhandledrejection', (event) => {
    if (isChunkLoadError(event.reason)) {
      event.preventDefault();
      void handleChunkLoadError(event.reason);
    }
  });

  // Window error event
  window.addEventListener('error', (event) => {
    if (isChunkLoadError(event.error) || isChunkLoadError(event.message)) {
      void handleChunkLoadError(event.error || event.message);
    }
  });

  if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
    setTimeout(() => {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    }, 4000);
  }
}
