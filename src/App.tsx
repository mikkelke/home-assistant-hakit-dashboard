import { useEffect } from 'react';
import { ThemeProvider } from '@hakit/components';
import { HassConnect } from '@hakit/core';
import { Dashboard } from './components/Dashboard';

function App() {
  // In dev, use localhost so all HA traffic goes through Vite proxy; in production use VITE_HA_URL or same-origin
  const hassUrl = import.meta.env.DEV
    ? window.location.origin
    : import.meta.env.VITE_HA_URL && import.meta.env.VITE_HA_URL.length > 0
      ? import.meta.env.VITE_HA_URL
      : window.location.origin;

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    [html, body, root].forEach(el => {
      if (!el) return;
      el.style.overflow = 'hidden';
      el.style.height = '100%';
      el.style.minHeight = '100%';
      // @ts-expect-error vendor property
      el.style.webkitOverflowScrolling = 'touch';
      el.style.touchAction = 'pan-y';
      el.style.overscrollBehavior = 'none';
    });
  }, []);

  // Token only in dev to avoid embedding secrets in production builds. For production, use same-origin or HA auth.
  const hassToken = import.meta.env.DEV ? import.meta.env.VITE_HA_TOKEN : undefined;
  return (
    <>
      <HassConnect hassUrl={hassUrl} hassToken={hassToken}>
        <ThemeProvider />
        <Dashboard />
      </HassConnect>
    </>
  );
}

export default App;
