import { defineConfig, type ProxyOptions, type Plugin } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';
import fs from 'node:fs';
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

const BUILD_ID =
  process.env.BUILD_ID ||
  `v${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Phase 1 Correction: Ensures build output places the standalone landing page
 * at dist/index.html and preserves the compiled SPA shell at dist/app.html.
 *
 * Runs with order: 'pre' on closeBundle so that dist/app.html is generated
 * BEFORE VitePWA runs generateSW (which requires navigateFallback to exist).
 */
function ripcordHtmlPlugin(): Plugin {
  return {
    name: 'ripcord-html',
    closeBundle: {
      order: 'pre',
      sequential: true,
      async handler() {
        const distDir = fileURLToPath(new URL('./dist', import.meta.url));
        const indexHtml = resolve(distDir, 'index.html');
        const appHtml = resolve(distDir, 'app.html');
        const landingHtml = resolve(distDir, 'landing/index.html');
        const vercelJsonSrc = fileURLToPath(new URL('./vercel.json', import.meta.url));
        const vercelJsonDest = resolve(distDir, 'vercel.json');
        const buildIdDest = resolve(distDir, 'build-id.json');

        // Emit build stamp file for stale-cache self-healing
        fs.writeFileSync(
          buildIdDest,
          JSON.stringify({ buildId: BUILD_ID, timestamp: Date.now() }, null, 2),
          'utf-8',
        );

        if (fs.existsSync(indexHtml) && fs.existsSync(landingHtml)) {
          // 1. Preserve the compiled wallet SPA shell as dist/app.html
          fs.copyFileSync(indexHtml, appHtml);
          // 2. Place the standalone landing page at dist/index.html
          fs.copyFileSync(landingHtml, indexHtml);

          // 3. Inject modulepreload/prefetch for app bundle assets into landing and docs
          try {
            const appContent = fs.readFileSync(appHtml, 'utf-8');
            const assetMatches = appContent.match(/<(?:script type="module"|link rel="(?:modulepreload|stylesheet)")[^>]+>/g) || [];
            if (assetMatches.length > 0) {
              const prefetchTags = assetMatches.map(tag => {
                const srcMatch = tag.match(/(?:src|href)="([^"]+)"/);
                if (!srcMatch) return '';
                const url = srcMatch[1];
                if (url.endsWith('.css')) {
                  return `<link rel="prefetch" href="${url}" as="style">`;
                }
                return `<link rel="modulepreload" href="${url}">`;
              }).filter(Boolean).join('\n    ');

              const docsHtml = resolve(distDir, 'docs/index.html');
              for (const targetPath of [indexHtml, docsHtml]) {
                if (fs.existsSync(targetPath)) {
                  let content = fs.readFileSync(targetPath, 'utf-8');
                  content = content.replace('</head>', `    ${prefetchTags}\n</head>`);
                  fs.writeFileSync(targetPath, content, 'utf-8');
                }
              }
            }
          } catch (e) {
            console.error('Failed to inject prefetch links:', e);
          }
        }
        if (fs.existsSync(vercelJsonSrc)) {
          fs.copyFileSync(vercelJsonSrc, vercelJsonDest);
        }
      },
    },
  };
}

/**
 * Phase 1: Ripcord routing middleware for local dev and preview.
 *
 * In dev:
 * - "/" serves the standalone landing page (/landing/index.html)
 * - "/docs" serves the standalone documentation page (/docs/index.html)
 * - "/app" serves the wallet SPA (/index.html)
 *
 * In preview:
 * - "/" serves the standalone landing page (/index.html)
 * - "/docs" serves the standalone documentation page (/docs/index.html)
 * - "/app" serves the wallet SPA (/app.html)
 */
function ripcordRoutingPlugin(): Plugin {
  return {
    name: 'ripcord-routing',
    configureServer(server) {
      server.middlewares.use((req: any, _res: any, next: any) => {
        const rawUrl = req.url || '';
        const pathname = rawUrl.split('?')[0];
        const query = rawUrl.includes('?') ? '?' + rawUrl.split('?')[1] : '';

        if (pathname === '/build-id.json') {
          _res.setHeader('Content-Type', 'application/json');
          _res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
          _res.end(JSON.stringify({ buildId: BUILD_ID, timestamp: Date.now() }));
          return;
        }

        if (pathname === '/' || pathname === '/index.html') {
          req.url = '/landing/index.html' + query;
        } else if (pathname === '/docs' || pathname === '/docs/') {
          req.url = '/docs/index.html' + query;
        } else if (pathname === '/app' || pathname === '/app/' || pathname.startsWith('/app/')) {
          req.url = '/index.html' + query;
        }
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req: any, _res: any, next: any) => {
        const rawUrl = req.url || '';
        const pathname = rawUrl.split('?')[0];
        const query = rawUrl.includes('?') ? '?' + rawUrl.split('?')[1] : '';

        if (pathname === '/build-id.json') {
          _res.setHeader('Content-Type', 'application/json');
          _res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
          _res.end(JSON.stringify({ buildId: BUILD_ID, timestamp: Date.now() }));
          return;
        }

        if (pathname === '/' || pathname === '/index.html') {
          req.url = '/index.html' + query;
        } else if (pathname === '/docs' || pathname === '/docs/') {
          req.url = '/docs/index.html' + query;
        } else if (pathname === '/app' || pathname === '/app/' || pathname.startsWith('/app/')) {
          req.url = '/app.html' + query;
        }
        next();
      });
    },
  };
}

/**
 * Rewrites the retired explorer domain out of vendor code (explorer rewire
 * 2026-10-03). The vendor's bundled network config carries the dead
 * explorer-regtest.tachibtc.com as a fallback literal, and Vite replaces the
 * vendor's process.env reads at build time so a runtime env override cannot
 * reach it. This build-time rewrite makes the new explorer absolute in every
 * shipped bundle.
 */
function retireDeadExplorerPlugin(): Plugin {
  return {
    name: 'ripcord-retire-dead-explorer',
    enforce: 'post',
    transform(code) {
      if (code.includes('explorer-regtest.tachibtc.com')) {
        return code.split('explorer-regtest.tachibtc.com').join('regtest.tachibtcscan.com');
      }
      return undefined;
    },
  };
}

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
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
    ripcordHtmlPlugin(),
    // SW removed deliberately: the precache service worker was the root
    // cause of clients being stranded on stale app shells. The wallet has
    // no offline requirement; network-first with immutable hashed assets
    // is simpler and cannot wedge. Old clients heal via kill-switch sw.js.
    ripcordRoutingPlugin(),
    retireDeadExplorerPlugin(),
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
