import React, { Component, type ReactNode } from 'react';
import { isChunkLoadError, handleChunkLoadError, purgeServiceWorkersAndCaches } from '../lib/selfHeal';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Caught render error:', error, errorInfo);
    if (isChunkLoadError(error)) {
      void handleChunkLoadError(error);
    }
  }

  handleReload = async () => {
    try {
      await purgeServiceWorkersAndCaches();
    } catch {
      // ignore
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const isChunk = isChunkLoadError(this.state.error);
      return (
        <div
          role="alert"
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            textAlign: 'center',
            background: 'var(--bg-base, #FAFAF8)',
            color: 'var(--text-hi, #0F172A)',
            fontFamily: 'var(--font-sans, -apple-system, sans-serif)',
          }}
        >
          <div
            style={{
              maxWidth: '420px',
              width: '100%',
              background: '#FFFFFF',
              border: '1px solid var(--line, #E2E4E9)',
              borderRadius: '16px',
              padding: '28px 24px',
              boxShadow: '0 4px 20px rgba(15, 23, 42, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '16px',
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: '#FFF7ED',
                border: '1px solid #FED7AA',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#EA580C',
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>
              {isChunk ? 'Update Required' : 'Something went wrong'}
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--text-lo, #64748B)', margin: 0, lineHeight: 1.5 }}>
              {isChunk
                ? 'A newer version of Ripcord is available or required application assets could not be loaded.'
                : 'An unexpected application error occurred while displaying this screen.'}
            </p>
            {this.state.error && !isChunk && (
              <p
                style={{
                  fontSize: '12px',
                  color: 'var(--text-lo, #64748B)',
                  margin: 0,
                  lineHeight: 1.45,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  background: '#F8FAFC',
                  border: '1px solid var(--line, #E2E4E9)',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  wordBreak: 'break-word',
                  maxHeight: '120px',
                  overflowY: 'auto',
                  width: '100%',
                  textAlign: 'left',
                }}
                aria-label="Error details"
              >
                {String(this.state.error.message ?? this.state.error).slice(0, 600)}
              </p>
            )}
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                background: '#F36633',
                color: '#FFFFFF',
                border: 'none',
                padding: '12px 24px',
                borderRadius: '9999px',
                fontSize: '14px',
                fontWeight: 700,
                cursor: 'pointer',
                minHeight: '44px',
                width: '100%',
                marginTop: '8px',
              }}
            >
              Reload Ripcord
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
