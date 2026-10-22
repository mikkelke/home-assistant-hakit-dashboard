import type { MapDoc, Point, Zone, ZoneChange } from '../../sensorMap/mapDoc';

/** The outline each zone gets from a change, for drawing before it is accepted. */
export const outlinesOf = (change: ZoneChange): Point[][] => (change.zones ?? []).map(zone => zone.poly);

/** The zones a change redraws, by name; a change that redraws none is a plain zone change. */
export function zoneChangeTitle(change: ZoneChange, zones: readonly Zone[]): string {
  const names = (change.zones ?? []).map(redrawn => zones.find(zone => zone.zone_id === redrawn.zone_id)?.name ?? redrawn.zone_id);
  return names.length > 0 ? names.join(', ') : 'Zone change';
}

/** What a change does, one short line each, in the names the plan uses. */
export function zoneChangeLines(change: ZoneChange, doc: MapDoc): string[] {
  const zoneName = (id: string) => doc.plan.zones.find(zone => zone.zone_id === id)?.name ?? id;
  const textOf = (id: string) => doc.plan.annotations.find(note => note.id === id)?.lines.join(' ') ?? id;
  return [
    ...(change.zones ?? []).map(redrawn => `${zoneName(redrawn.zone_id)}: new outline${redrawn.label ? ' and label point' : ''}`),
    ...(change.remove_zone_lines ?? []).map(x => `Zone line at x ${x} dropped`),
    ...(change.add_zone_lines ?? []).map(line => `Zone line at x ${line.x} drawn`),
    ...Object.entries(change.annotations ?? {}).map(([id, lines]) =>
      lines === null ? `Label "${textOf(id)}" removed` : `Label "${textOf(id)}" becomes "${lines.join(' ')}"`
    ),
    ...Object.entries(change.device_zones ?? {}).map(([key, zone]) => `${doc.devices[key]?.name ?? key} goes to ${zoneName(zone)}`),
  ];
}
