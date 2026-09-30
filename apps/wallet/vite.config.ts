import { defineConfig, type ProxyOptions, type Plugin } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Host-proxy contract for the wallet's live services.
 *
 * The wallet fetches same-origin paths (/health, /tachi_*, /rpc, /faucet) and
 * this proxy carries them to the Tachi daemon and faucet. That contract is
 * deliberate: the daemon CORS-enables GETs but NOT POSTs (verified live
 * 2026-09-27), so a browser wallet cannot call it cross-origin. Production
 * MUST mirror these rules (apps/wallet/vercel.json is the shipped reference;
 * see docs/DEPLOYMENT.md). Keep them in sync: drift is exactly the failure
 * class this comment exists to prevent (on 2026-09-27 a deployed wallet's
 * probes silently 404'd because production did not mirror dev).
 *
 * Both `server` (npm run dev) and `preview` (npm run preview of the built
 * app) use this proxy, so the built app behaves exactly like dev. Without the
 * preview proxy, `npm run preview` used to break every live call.
 */
const SERVICE_PROXY: Record<string, ProxyOptions> = {
  '/health': { target: 'https://rpc-regtest.tachibtc.com', changeOrigin: true },
  '/tachi': { target: 'https://rpc-regtest.tachibtc.com', changeOrigin: true },
  '/rpc': {
    target: 'https://rpc-regtest.tachibtc.com',
    changeOrigin: true,
    rewrite: path => path.replace(/^\/rpc/, ''),
  },
  '/faucet': {
    target: 'https://faucet.tachibtc.com',
    changeOrigin: true,
    rewrite: path => path.replace(/^\/faucet/, ''),
  },
};

/**
 * Phase 1: Ripcord routing middleware for local dev and preview.
 * - "/" serves the standalone landing page (/landing/index.html)
 * - "/docs" serves the standalone documentation page (/docs/index.html)
 * - "/app" serves the wallet SPA (/index.html)
 */
function ripcordRoutingPlugin(): Plugin {
  const rewriteRouting = (req: any, _res: any, next: any) => {
    const rawUrl = req.url || '';
    const pathname = rawUrl.split('?')[0];
    const query = rawUrl.includes('?') ? '?' + rawUrl.split('?')[1] : '';

    if (pathname === '/' || pathname === '/index.html') {
      req.url = '/landing/index.html' + query;
    } else if (pathname === '/docs' || pathname === '/docs/') {
      req.url = '/docs/index.html' + query;
    } else if (pathname === '/app' || pathname === '/app/' || pathname.startsWith('/app/')) {
      req.url = '/index.html' + query;
    }
    next();
  };

  return {
    name: 'ripcord-routing',
    configureServer(server) {
      server.middlewares.use(rewriteRouting);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewriteRouting);
    },
  };
}

export default defineConfig({
  resolve: {
    alias: { vm: fileURLToPath(new URL('./src/shims/vm.ts', import.meta.url)) },
  },
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'crypto', 'events', 'process', 'stream', 'util'],
      globals: { Buffer: true, global: true, process: true },
      protocolImports: true,
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['ripcord-mark.svg'],
      manifest: false,
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackAllowlist: [/^\/app/],
        runtimeCaching: [],
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
    ripcordRoutingPlugin(),
  ],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // bitcoinjs-lib has internal circular imports. Keep the package in one
          // chunk so lazy wallet flows cannot create a cross-chunk cycle.
          if (id.includes('/node_modules/bitcoinjs-lib/') || id.includes('\\node_modules\\bitcoinjs-lib\\')) {
            return 'bitcoinjs';
          }
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
    proxy: SERVICE_PROXY,
  },
  preview: {
    proxy: SERVICE_PROXY,
  },
});
