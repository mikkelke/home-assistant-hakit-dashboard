import type { Door } from './mapDoc';
import type { EntityLike } from './live';

/** How the map knows a door's state: its contact sensor's entity id, or a fixed state for a door kept shut. */
export type DoorLink = string | { closed: true };

/** A door's state as the map draws it: `none` when it has no link, `unknown` when its sensor says nothing. */
export type DoorState = 'open' | 'closed' | 'unknown' | 'none';

/** The sensor a link reads, if it reads one. */
export const sensorOf = (link: DoorLink | undefined): string | undefined => (typeof link === 'string' ? link : undefined);

export function doorState(link: DoorLink | undefined, entity: EntityLike | undefined): DoorState {
  if (!link) return 'none';
  if (typeof link !== 'string') return 'closed';
  if (entity?.state === 'on') return 'open';
  if (entity?.state === 'off') return 'closed';
  return 'unknown';
}

/** The names of the doors that are closed, by their sensor or fixed so. Only these stop lamp light. */
export function closedDoorNames(
  doors: readonly Door[],
  links: Readonly<Record<string, DoorLink>>,
  read: (id: string) => EntityLike | undefined
): string[] {
  return doors
    .filter(door => {
      const link = links[door.name];
      const sensor = sensorOf(link);
      return doorState(link, sensor ? read(sensor) : undefined) === 'closed';
    })
    .map(door => door.name);
}
