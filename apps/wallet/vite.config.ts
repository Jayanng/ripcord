import { defineConfig, type ProxyOptions } from 'vite';
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
        navigateFallback: 'index.html',
        runtimeCaching: [],
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
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
