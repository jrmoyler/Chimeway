import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import AuthScreen from './components/AuthScreen';
import { SessionProvider, useSession } from './store/SessionProvider';
import { StoreProvider } from './store/StoreProvider';
import './index.css';

/**
 * Gates the app on authentication.
 *
 * Without Supabase configured the app runs in local mode (see data/api.ts)
 * rather than stopping at a setup screen, so a deployment with no backend is
 * still usable.
 */
const Root: React.FC = () => {
  const { userId, ready } = useSession();

  if (!ready) {
    return (
      <div
        className="flex h-dvh items-center justify-center bg-base"
        role="status"
        aria-live="polite"
      >
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
        <span className="sr-only">Checking your session</span>
      </div>
    );
  }

  if (!userId) return <AuthScreen />;

  return (
    <StoreProvider>
      <App />
    </StoreProvider>
  );
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find the #root element to mount Chimeway into.');
}

createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <SessionProvider>
        <Root />
      </SessionProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
