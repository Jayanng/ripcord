// Ripcord service worker kill switch.
// The app no longer uses a service worker (removed 2026-10-01 after
// stale precache shells stranded clients on old builds). This file is
// served at /sw.js so that browsers still holding an old registration
// treat it as an update: on install it unregisters every registration
// (itself included) and reloads open clients once, healing stale
// installs without any manual cache clearing.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        await self.registration.unregister();
      } catch (e) {
        // unregister during activate is best-effort; the page-side
        // cleanup also removes registrations.
      }
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        try {
          client.navigate(client.url);
        } catch (e) {
          // navigate() requires the client's own scope; ignore others
        }
        client.postMessage('ripcord-sw-killed');
      }
    })(),
  );
});
