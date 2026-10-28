import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import AuthScreen from './components/AuthScreen';
import SetupScreen from './components/SetupScreen';
import { SessionProvider, useSession } from './store/SessionProvider';
import { StoreProvider } from './store/StoreProvider';
import { isSupabaseConfigured } from './lib/supabase';
import './index.css';

/**
 * Gates the app on configuration, then on authentication.
 *
 * Each failure mode gets its own screen. The previous build rendered nothing
 * when misconfigured, which made a config problem look identical to a crash.
 */
const Root: React.FC = () => {
  const { session, ready } = useSession();

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

  if (!session) return <AuthScreen />;

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
      {isSupabaseConfigured ? (
        <SessionProvider>
          <Root />
        </SessionProvider>
      ) : (
        <SetupScreen />
      )}
    </ErrorBoundary>
  </React.StrictMode>,
);
