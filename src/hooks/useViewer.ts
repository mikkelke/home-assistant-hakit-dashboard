import { useEffect, useState } from 'react';
import { useHass } from '@hakit/core';
import { getUser, type Connection } from 'home-assistant-js-websocket';

export interface Viewer {
  /** null while the user lookup resolves (or if the connection isn't up yet). */
  isAdmin: boolean | null;
  /** The HA user's display name (case preserved). */
  name: string | null;
}

const UNRESOLVED: Viewer = { isAdmin: null, name: null };

/** One user lookup per connection, shared by every caller. */
const lookups = new WeakMap<object, Promise<Viewer>>();
const resolved = new WeakMap<object, Viewer>();

function lookUpViewer(connection: Connection): Promise<Viewer> {
  let lookup = lookups.get(connection);
  if (!lookup) {
    lookup = getUser(connection)
      .then(user => ({ isAdmin: user.is_admin === true, name: typeof user.name === 'string' ? user.name : null }))
      .catch(() => ({ isAdmin: false, name: null }))
      .then(viewer => {
        resolved.set(connection, viewer);
        return viewer;
      });
    lookups.set(connection, lookup);
  }
  return lookup;
}

/** Who is looking at the dashboard. `isAdmin` stays `null` while resolving and `false` on
 * failure: the restricted view is the safe default, so a slow user fetch briefly hides admin
 * surfaces from the admin user rather than ever flashing them at a housemate. */
export function useViewer(): Viewer {
  const connection = useHass(s => s.connection) as Connection | null;
  const [viewer, setViewer] = useState<Viewer>(() => (connection && resolved.get(connection)) || UNRESOLVED);
  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    void lookUpViewer(connection).then(next => {
      if (!cancelled) setViewer(current => (current.isAdmin === next.isAdmin && current.name === next.name ? current : next));
    });
    return () => {
      cancelled = true;
    };
  }, [connection]);
  return viewer;
}
