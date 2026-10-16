import { useEffect } from 'react';
import { useHass } from '@hakit/core';
import { trackAppOpen } from '../utils/trackUiTap';
import { loadedByUpdate } from '../utils/updateCheck';

/** Counts the dashboard as opened once it is connected, unless an update's reload has just brought the page up, and again
 * whenever the page becomes visible. */
export function useAppOpenTracking(): void {
  const connected = useHass(s => s.connection != null);
  useEffect(() => {
    if (!connected) return;
    if (!loadedByUpdate()) trackAppOpen();
    const onVisible = () => {
      if (document.visibilityState === 'visible') trackAppOpen();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [connected]);
}
