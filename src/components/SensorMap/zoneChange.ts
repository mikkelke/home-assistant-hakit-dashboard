import type { MapDoc, Point, Zone, ZoneChange } from '../../sensorMap/mapDoc';

/** The outline each zone gets from a change, for drawing before it is accepted; a zone that only changes in other ways has none. */
export const outlinesOf = (change: ZoneChange): Point[][] => (change.zones ?? []).flatMap(zone => (zone.poly ? [zone.poly] : []));

/** The zones a change touches, by name when there are one or two of them; a change without zones is a plain zone change. */
export function zoneChangeTitle(change: ZoneChange, zones: readonly Zone[]): string {
  const touched = change.zones ?? [];
  if (touched.length === 0) return 'Zone change';
  if (touched.length > 2) return `${touched.length} zones`;
  return touched.map(entry => zones.find(zone => zone.zone_id === entry.zone_id)?.name ?? entry.zone_id).join(', ');
}

/** What a change does, one short line each, in the names the plan uses. */
export function zoneChangeLines(change: ZoneChange, doc: MapDoc): string[] {
  const zoneName = (id: string) => doc.plan.zones.find(zone => zone.zone_id === id)?.name ?? id;
  const textOf = (id: string) => doc.plan.annotations.find(note => note.id === id)?.lines.join(' ') ?? id;
  const partsOf = (entry: NonNullable<ZoneChange['zones']>[number]) =>
    [
      entry.poly ? 'new outline' : null,
      entry.label ? 'label point' : null,
      entry.ceiling_m === undefined ? null : entry.ceiling_m === null ? 'no ceiling height' : `ceiling ${entry.ceiling_m} m`,
    ].filter(part => part !== null);
  return [
    ...(change.zones ?? []).map(entry => `${zoneName(entry.zone_id)}: ${partsOf(entry).join(', ')}`),
    ...(change.remove_zone_lines ?? []).map(x => `Zone line at x ${x} dropped`),
    ...(change.add_zone_lines ?? []).map(line => `Zone line at x ${line.x} drawn`),
    ...Object.entries(change.annotations ?? {}).map(([id, lines]) =>
      lines === null ? `Label "${textOf(id)}" removed` : `Label "${textOf(id)}" becomes "${lines.join(' ')}"`
    ),
    ...Object.entries(change.device_zones ?? {}).map(([key, zone]) => `${doc.devices[key]?.name ?? key} goes to ${zoneName(zone)}`),
  ];
}
