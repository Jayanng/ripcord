import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { VitePWA } from 'vite-plugin-pwa';

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
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 1200,
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
    proxy: {
      '/health': { target: 'https://rpc-regtest.tachibtc.com', changeOrigin: true },
      '/tachi': { target: 'https://rpc-regtest.tachibtc.com', changeOrigin: true },
      '/rpc': {
        target: 'https://rpc-regtest.tachibtc.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/rpc/, ''),
      },
    },
  },
});
