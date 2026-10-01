import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { WalletProvider } from './context/WalletContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  runBootGuard,
  setupControllerChangeListener,
  setupChunkErrorListeners,
} from './lib/selfHeal';
import './styles/tokens.css';

// Clean up any stale service workers from previous builds - the app no
// longer registers one, so any registration found is a leftover to remove.
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const r of regs) r.unregister();
  }).catch(() => {});
}

// Client-side self-heal guards for stale caches and chunk loading failures
setupChunkErrorListeners();
void runBootGuard();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <WalletProvider>
        <App />
      </WalletProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
