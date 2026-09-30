import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { WalletProvider } from './context/WalletContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  runBootGuard,
  setupControllerChangeListener,
  setupChunkErrorListeners,
} from './lib/selfHeal';
import './styles/tokens.css';

// Clean up any stale root-scoped service worker so it does not intercept '/'
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const r of regs) {
      if (r.scope === window.location.origin + '/' || r.scope === window.location.origin) {
        r.unregister();
      }
    }
  });
}

// Client-side self-heal guards for stale caches, SW updates, and chunk loading failures
setupControllerChangeListener();
setupChunkErrorListeners();
void runBootGuard();

registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    registration?.update();
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <WalletProvider>
        <App />
      </WalletProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
