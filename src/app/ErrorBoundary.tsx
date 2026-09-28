import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="app">
        <main className="page">
          <div className="card">
            <h2>Κάτι πήγε στραβά</h2>
            <p>Ανανέωσε τη σελίδα για να συνεχίσεις.</p>
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Ανανέωση
            </button>
          </div>
        </main>
      </div>
    );
  }
}
