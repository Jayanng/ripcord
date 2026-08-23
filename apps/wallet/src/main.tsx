import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { WalletProvider } from './context/WalletContext';
import './styles/tokens.css';

registerSW({ immediate: true, onRegisteredSW(_url, registration) { registration?.update(); } });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WalletProvider><App /></WalletProvider>
  </React.StrictMode>,
);
