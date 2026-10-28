import React from 'react';

/**
 * Catches render errors so a single broken component cannot blank the whole
 * app. The original had no boundary, which is part of why a module-scope
 * throw produced an empty page with nothing on screen to explain it.
 */

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Chimeway crashed while rendering:', error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  override render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-dvh items-center justify-center bg-base p-6">
        <div className="w-full max-w-md rounded-xl border border-line bg-raised p-6 text-center">
          <h1 className="text-lg font-semibold text-ink">Something went wrong</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Chimeway hit an unexpected error and stopped rendering. Your saved messages are
            unaffected.
          </p>
          <pre className="mt-4 max-h-40 overflow-auto rounded-md bg-sunken p-3 text-left text-xs text-ink-muted">
            {error.message}
          </pre>
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-5 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            Reload Chimeway
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
