import type { Door } from './mapDoc';
import type { EntityLike } from './live';

/** A door's state as the map draws it: `none` when it has no contact sensor, `unknown` when the sensor says nothing. */
export type DoorState = 'open' | 'closed' | 'unknown' | 'none';

export function doorState(sensorId: string | undefined, entity: EntityLike | undefined): DoorState {
  if (!sensorId) return 'none';
  if (entity?.state === 'on') return 'open';
  if (entity?.state === 'off') return 'closed';
  return 'unknown';
}

/** The names of the doors whose sensor reports them closed. Only these stop lamp light. */
export function closedDoorNames(
  doors: readonly Door[],
  sensors: Readonly<Record<string, string>>,
  read: (id: string) => EntityLike | undefined
): string[] {
  return doors.filter(door => doorState(sensors[door.name], read(sensors[door.name] ?? '')) === 'closed').map(door => door.name);
}
