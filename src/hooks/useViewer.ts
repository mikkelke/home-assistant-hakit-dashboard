import { useEffect, useState } from 'react';
import { useHass } from '@hakit/core';
import { getUser, type Connection } from 'home-assistant-js-websocket';

export interface Viewer {
  /** null while the user lookup resolves (or if the connection isn't up yet). */
  isAdmin: boolean | null;
  /** The HA user's display name (case preserved). */
  name: string | null;
}

/** Who is looking at the dashboard. `isAdmin` stays `null` while resolving and `false` on
 * failure: the restricted view is the safe default, so a slow user fetch briefly hides admin
 * surfaces from Mikkel rather than ever flashing them at a housemate. */
export function useViewer(): Viewer {
  const connection = useHass(s => s.connection);
  const [viewer, setViewer] = useState<Viewer>({ isAdmin: null, name: null });
  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    getUser(connection as Connection)
      .then(user => {
        if (!cancelled) setViewer({ isAdmin: user.is_admin === true, name: typeof user.name === 'string' ? user.name : null });
      })
      .catch(() => {
        if (!cancelled) setViewer({ isAdmin: false, name: null });
      });
    return () => {
      cancelled = true;
    };
  }, [connection]);
  return viewer;
}
