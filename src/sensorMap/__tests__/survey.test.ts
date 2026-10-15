import { describe, expect, it } from 'vitest';
import { zoneAt } from '../geometry';
import type { Plan } from '../mapDoc';
import { WALL_CLEARANCE_M, nextPoint, surveyPoints, surveyProgress, type SurveyPoint } from '../survey';
import { T0, makeDoc, makeFingerprint, rect } from './docFixtures';
import { noWifi } from '../mapDoc';

const plan = (): Plan => makeDoc().plan;

const wallDistance = (p: Plan, x: number, y: number) =>
  Math.min(...p.walls.map(wall => Math.hypot(Math.max(wall.x0 - x, 0, x - wall.x1), Math.max(wall.y0 - y, 0, y - wall.y1))));

describe('the points of a survey', () => {
  it('gives every zone at least two points, and a large one more, up to four', () => {
    const points = surveyPoints(plan());
    const per = (zone: string) => points.filter(point => point.zone_id === zone).length;
    expect(['alpha', 'beta', 'gamma', 'delta'].map(per)).toEqual([3, 3, 3, 3]);
    expect(surveyPoints(plan(), { areaPerPointM2: 1000 }).filter(point => point.kind === 'room')).toHaveLength(8);
    expect(surveyPoints(plan(), { areaPerPointM2: 1, maxPerZone: 4 }).filter(point => point.zone_id === 'alpha')).toHaveLength(4);
  });

  it('keeps every room point at least 0.4 m from every wall and from the edge of its zone, and inside the zone', () => {
    const p = plan();
    const rooms = surveyPoints(p).filter(point => point.kind === 'room');
    expect(rooms.length).toBeGreaterThan(8);
    for (const point of rooms) {
      expect(wallDistance(p, point.at[0], point.at[1])).toBeGreaterThanOrEqual(WALL_CLEARANCE_M - 1e-9);
      expect(zoneAt(p.zones, point.at[0], point.at[1])?.zone_id).toBe(point.zone_id);
      const zone = p.zones.find(candidate => candidate.zone_id === point.zone_id);
      const xs = zone?.poly.map(corner => corner[0]) ?? [];
      const ys = zone?.poly.map(corner => corner[1]) ?? [];
      expect(
        Math.min(point.at[0] - Math.min(...xs), Math.max(...xs) - point.at[0], point.at[1] - Math.min(...ys), Math.max(...ys) - point.at[1])
      ).toBeGreaterThan(0);
    }
  });

  it('spreads the points of a zone rather than bunching them', () => {
    const points = surveyPoints(plan(), { areaPerPointM2: 1000 }).filter(point => point.zone_id === 'alpha');
    const [a, b] = points.map(point => point.at);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(1.5);
  });

  it('puts one point in each doorway, in the middle of the opening', () => {
    const doorway = surveyPoints(plan()).filter(point => point.kind === 'door');
    expect(doorway).toHaveLength(1);
    expect(doorway[0]).toMatchObject({ at: [4, 2.5], label: 'Test door', zone_id: null });
  });

  it('takes the middle of the glazing box for a door that has one', () => {
    const p = plan();
    p.doors = [{ name: 'Front door', hinge: [0, 2], closed: [0, 3], open: [-1, 2] }];
    p.windows = [{ name: 'Front door', box: [-0.2, 2, 0.1, 3], door: true }];
    expect(surveyPoints(p).find(point => point.kind === 'door')?.at).toEqual([-0.05, 2.5]);
  });

  it('puts a point outside a terrace door, on the side its leaf swings to', () => {
    const p = plan();
    p.doors = [{ name: 'Terrace door, left', hinge: [0, 5], closed: [0, 6], open: [-1, 5] }];
    p.windows = [];
    const points = surveyPoints(p);
    expect(points.filter(point => point.kind === 'door')).toHaveLength(1);
    expect(points.find(point => point.kind === 'terrace')).toMatchObject({
      at: [-1, 5.5],
      label: 'Terrace door, left (outside)',
      zone_id: null,
    });
  });

  it('uses the other side of a terrace door when the leaf swings into a room, and none when both sides are blocked', () => {
    const p = plan();
    p.doors = [{ name: 'Terrace door', hinge: [0, 5], closed: [0, 6], open: [1, 5] }];
    expect(surveyPoints(p).find(point => point.kind === 'terrace')?.at).toEqual([-1, 5.5]);
    p.doors = [{ name: 'Terrace door', hinge: [2, 5], closed: [2, 6], open: [3, 5] }];
    expect(surveyPoints(p).some(point => point.kind === 'terrace')).toBe(false);
  });

  it('numbers the points from 1 along a walking order that starts at the front door when there is one', () => {
    const p = plan();
    p.doors = [...p.doors, { name: 'Front door', hinge: [12, 2], closed: [12, 3], open: [13, 2] }];
    const points = surveyPoints(p);
    expect(points.map(point => point.n)).toEqual(points.map((_, index) => index + 1));
    expect(points[0].label).toBe('Front door');
    expect(new Set(points.map(point => point.id)).size).toBe(points.length);
  });

  it('walks in a shorter path than the order the zones are listed in', () => {
    const points = surveyPoints(plan());
    const length = (list: readonly SurveyPoint[]) =>
      list.slice(1).reduce((sum, point, i) => sum + Math.hypot(point.at[0] - list[i].at[0], point.at[1] - list[i].at[1]), 0);
    const listed = [...points].sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(length(points)).toBeLessThan(length(listed));
  });

  it('gives the same points every time, with stable ids', () => {
    expect(surveyPoints(plan())).toEqual(surveyPoints(plan()));
    expect(surveyPoints(plan()).map(point => point.id)).toContain('alpha-1');
  });

  it('shrinks the clearance for a zone too narrow to keep 0.4 m, so it still gets its points', () => {
    const p = plan();
    p.zones = [
      {
        zone_id: 'slot',
        name: 'Slot',
        poly: rect(20, 0, 20.6, 3),
        ha_area_id: null,
        active_entity: null,
        label: [20.3, 1.5],
        ceiling_m: null,
      },
    ];
    p.doors = [];
    const points = surveyPoints(p);
    expect(points).toHaveLength(2);
    expect(points.every(point => point.zone_id === 'slot')).toBe(true);
  });

  it('copes with a plan that has no zone and no door', () => {
    const p = plan();
    p.zones = [];
    p.doors = [];
    expect(surveyPoints(p)).toEqual([]);
  });
});

describe('the progress of a survey', () => {
  const points = surveyPoints(plan());
  const first = points[0];
  const second = points[1];
  const capture = (id: string, surveyId: string | null, at: number, dbm: number | null = -60) =>
    makeFingerprint(id, {
      survey_id: surveyId,
      at: new Date(Date.parse(T0) + at * 1000).toISOString(),
      wifi: dbm === null ? noWifi('stale') : { ...noWifi('stale'), dbm, readings: [{ dbm, at: T0 }], miss: {} },
    });

  it('counts a point as done once it has a capture, skipped when skipped, and to do otherwise', () => {
    const progress = surveyProgress(points, [capture('a', first.id, 1)], new Set([second.id]));
    expect(progress).toMatchObject({ total: points.length, done: 1, skipped: 1, noWifi: 0 });
    expect(progress.status[first.id]).toBe('done');
    expect(progress.status[second.id]).toBe('skipped');
    expect(progress.status[points[2].id]).toBe('todo');
  });

  it('lets a capture win over a skip, and ignores a capture made for no point', () => {
    const progress = surveyProgress(points, [capture('a', first.id, 1), capture('b', null, 2)], new Set([first.id]));
    expect([progress.done, progress.skipped]).toEqual([1, 0]);
    expect(Object.keys(progress.latest)).toEqual([first.id]);
  });

  it('keeps the newest capture of a point, and counts the point once', () => {
    const progress = surveyProgress(points, [capture('new', first.id, 9), capture('old', first.id, 1)], new Set());
    expect(progress.done).toBe(1);
    expect(progress.latest[first.id].id).toBe('new');
  });

  it('counts a done point whose newest capture has no Wi-Fi reading, until it is captured again', () => {
    const first1 = surveyProgress(points, [capture('a', first.id, 1, null)], new Set());
    expect(first1.noWifi).toBe(1);
    const retaken = surveyProgress(points, [capture('a', first.id, 1, null), capture('b', first.id, 5, -61)], new Set());
    expect(retaken.noWifi).toBe(0);
  });

  it('finds the next point to do after a given one, wraps round, and gives null when none is left', () => {
    const progress = surveyProgress(points, [capture('a', points[3].id, 1)], new Set([points[4].id]));
    expect(nextPoint(points, progress, null)?.id).toBe(points[0].id);
    expect(nextPoint(points, progress, points[2].id)?.id).toBe(points[5].id);
    const last = points[points.length - 1];
    expect(nextPoint(points, progress, last.id)?.id).toBe(points[0].id);
    const all = surveyProgress(
      points,
      points.map((point, i) => capture(`c${i}`, point.id, i)),
      new Set()
    );
    expect(nextPoint(points, all, null)).toBeNull();
  });
});
