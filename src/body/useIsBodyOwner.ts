import { useHass } from '@hakit/core';
import { useViewer } from '../hooks';
import { BODY_PERSON } from './weighings';

/** Whether this viewer is the one whose scale readings the page shows. */
export function useIsBodyOwner(): boolean | null {
  const viewer = useViewer();
  const ownerId = useHass(s => s.entities[BODY_PERSON]?.attributes?.user_id) as string | undefined;
  if (viewer.id == null || ownerId == null) return viewer.isAdmin === false && viewer.id == null ? false : null;
  return viewer.id === ownerId;
}
