/* ──────────────────────────────────────────────────────────────────
   ErrorBoundary — catches render-time crashes anywhere in the tree and
   shows a recoverable message instead of a black/blank window. Without
   this, one unhandled error (e.g. a bad component) blanks the whole app.
   ────────────────────────────────────────────────────────────────── */

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep it in the console for debugging; never re-throw (that re-blanks the app).
    // eslint-disable-next-line no-console
    console.error('App error boundary caught:', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });
  private reload = () => {
    try {
      window.location.reload();
    } catch {
      /* ignore */
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          padding: 32,
          textAlign: 'center',
          background: 'var(--al-bg, #121013)',
          color: 'var(--al-ink, #e9e4d8)',
          fontFamily: 'var(--al-font-body, system-ui, sans-serif)',
        }}
      >
        <div style={{ fontSize: 30, color: 'var(--al-gold, #E8C36B)' }}>◆</div>
        <div style={{ fontSize: 17, fontWeight: 600 }}>發生了一個錯誤 · Something went wrong</div>
        <div style={{ fontSize: 13, opacity: 0.7, maxWidth: 440, lineHeight: 1.5 }}>
          畫面遇到問題，但你的檔案沒事。可以「再試一次」回到上一個畫面，或「重新整理」重載 App。
          <br />
          The view hit an error (your files are safe). Try again to recover, or reload the app.
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <button
            type="button"
            onClick={this.reset}
            style={btn('var(--al-gold, #E8C36B)', '#121013')}
          >
            再試一次 · Try again
          </button>
          <button
            type="button"
            onClick={this.reload}
            style={btn('transparent', 'var(--al-ink, #e9e4d8)', '1px solid var(--al-hairline, #2a2630)')}
          >
            重新整理 · Reload
          </button>
        </div>
        {import.meta.env.DEV && (
          <pre style={{ marginTop: 12, fontSize: 11, opacity: 0.6, maxWidth: 600, overflow: 'auto', textAlign: 'left' }}>
            {String(this.state.error?.message ?? this.state.error)}
          </pre>
        )}
      </div>
    );
  }
}

function btn(bg: string, color: string, border = 'none'): React.CSSProperties {
  return {
    padding: '8px 18px',
    borderRadius: 999,
    border,
    background: bg,
    color,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  };
}
