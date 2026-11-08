import { describe, expect, it } from 'vitest';
import { TRANSIT_LINES, type TransitStatus } from '../../config/transit';
import type { HassEntities } from '../../types';
import {
  formatTravelTime,
  getTransitLineDisplayStatus,
  groupTransitRows,
  isOperatorDisruption,
  readOperatorOk,
  readOperatorStatus,
  transitBadgeLabel,
  transitEmptyMessage,
  transitOperatorNote,
  type TransitRowLine,
} from '../transitDisplay';

describe('formatTravelTime', () => {
  it('shows bare minutes under an hour', () => {
    expect(formatTravelTime(55)).toBe('55m');
    expect(formatTravelTime(59)).toBe('59m');
  });

  it('shows hours and two-digit minutes from an hour up', () => {
    expect(formatTravelTime(60)).toBe('1h00');
    expect(formatTravelTime(71)).toBe('1h11');
    expect(formatTravelTime(125)).toBe('2h05');
  });
});

describe('transitBadgeLabel', () => {
  const departure = { line: 'C', category: 'ICL' };

  it('names the line on a line badge', () => {
    expect(transitBadgeLabel({ badge: 'line' }, departure)).toBe('C');
  });

  it('names the train category on a category badge', () => {
    expect(transitBadgeLabel({ badge: 'category' }, departure)).toBe('ICL');
  });

  it('names the route on a direction badge, whatever the departure says', () => {
    expect(transitBadgeLabel({ badge: 'direction', directionBadge: 'KBH' }, departure)).toBe('KBH');
    expect(transitBadgeLabel({ badge: 'direction' }, departure)).toBe('');
  });

  it('is empty on a route without a badge, or when the departure lacks the field', () => {
    expect(transitBadgeLabel({}, departure)).toBe('');
    expect(transitBadgeLabel({ badge: 'category' }, { line: 'IC 125' })).toBe('');
  });

  it('follows the configured routes: S-tog by line, Odense by category, each metro direction by its own name', () => {
    const badgeOf = (name: string) => TRANSIT_LINES.find(line => line.name === name)?.badge;
    expect(badgeOf('S-tog')).toBe('line');
    expect(badgeOf('ECE/IC/ICL/Re')).toBe('category');
    const metro = TRANSIT_LINES.filter(line => line.name === 'Metro');
    expect(metro.map(line => transitBadgeLabel(line, { line: 'M3' }))).toEqual(['KBH', 'FRB']);
  });

  it('keeps only the Frederiksberg metro out of Home Pulse', () => {
    const outOfPulse = TRANSIT_LINES.filter(line => line.homePulse === false).map(line => line.destination);
    expect(outOfPulse).toEqual(['Frederiksberg']);
  });
});

describe('groupTransitRows', () => {
  const route = (statusEntityId: string, over: Partial<TransitRowLine> = {}): TransitRowLine => ({
    station: 'Enghave Plads',
    name: 'Metro',
    icon: 'mdi:subway-variant',
    destination: statusEntityId,
    statusEntityId,
    enabled: true,
    displayStatus: 'OK',
    ...over,
  });
  const kbh = (over: Partial<TransitRowLine> = {}) => route('København H', { row: 'metro', ...over });
  const frb = (over: Partial<TransitRowLine> = {}) => route('Frederiksberg', { row: 'metro', ...over });
  const status = (lines: TransitRowLine[]): TransitStatus => groupTransitRows(lines)[0].displayStatus;

  it('puts both configured metro directions in one row, København H first, and every other route in a row of its own', () => {
    const live = TRANSIT_LINES.map(line => ({ ...line, enabled: true, displayStatus: 'OK' }));
    const stations = [...new Set(live.map(line => line.station))];
    const rows = stations.flatMap(station => groupTransitRows(live.filter(line => line.station === station)));
    const metroRows = rows.filter(row => row.name === 'Metro');
    expect(metroRows).toHaveLength(1);
    expect(metroRows[0].lines.map(line => line.destination)).toEqual(['København H', 'Frederiksberg']);
    expect(rows.filter(row => row.name !== 'Metro').every(row => row.lines.length === 1)).toBe(true);
  });

  it('merges the routes that share a row, in the order given', () => {
    const stog = route('S-tog', { name: 'S-tog' });
    const rows = groupTransitRows([kbh(), stog, frb()]);
    expect(rows.map(row => row.lines.map(line => line.statusEntityId))).toEqual([['København H', 'Frederiksberg'], ['S-tog']]);
  });

  it('keeps a route without a row to itself, even beside another of the same name', () => {
    expect(groupTransitRows([route('a'), route('b')])).toHaveLength(2);
  });

  it('describes a merged row by its first route and names every destination', () => {
    expect(groupTransitRows([kbh(), frb()])[0]).toMatchObject({
      key: 'København H',
      station: 'Enghave Plads',
      name: 'Metro',
      icon: 'mdi:subway-variant',
      destination: 'København H · Frederiksberg',
    });
  });

  it('describes a single route as itself', () => {
    const [row] = groupTransitRows([route('Odense', { name: 'ECE/IC/ICL/Re', displayStatus: 'Delayed' })]);
    expect(row).toMatchObject({ key: 'Odense', name: 'ECE/IC/ICL/Re', destination: 'Odense', enabled: true, displayStatus: 'Delayed' });
    expect(row.lines).toHaveLength(1);
  });

  it('takes the most severe status of the routes', () => {
    expect(status([kbh({ displayStatus: 'OK' }), frb({ displayStatus: 'Disrupted' })])).toBe('Disrupted');
    expect(status([kbh({ displayStatus: 'Disrupted' }), frb({ displayStatus: 'Delayed' })])).toBe('Disrupted');
    expect(status([kbh({ displayStatus: 'Delayed' }), frb({ displayStatus: 'OK' })])).toBe('Delayed');
  });

  it('lets the first route name the status between equals', () => {
    expect(status([kbh({ displayStatus: 'Unavailable' }), frb({ displayStatus: 'OK' })])).toBe('Unavailable');
    expect(status([kbh({ displayStatus: 'Delayed' }), frb({ displayStatus: 'Delayed' })])).toBe('Delayed');
  });

  it('judges only the routes that are on', () => {
    const [row] = groupTransitRows([kbh(), frb({ enabled: false, displayStatus: 'Disrupted' })]);
    expect(row.enabled).toBe(true);
    expect(row.displayStatus).toBe('OK');
  });

  it('is off only when every route is, and then reports all of them', () => {
    const [row] = groupTransitRows([kbh({ enabled: false }), frb({ enabled: false, displayStatus: 'Delayed' })]);
    expect(row.enabled).toBe(false);
    expect(row.displayStatus).toBe('Delayed');
    expect(groupTransitRows([route('S-tog', { enabled: false, displayStatus: 'Disrupted' })])[0]).toMatchObject({
      enabled: false,
      displayStatus: 'Disrupted',
    });
  });
});

describe('readOperatorStatus', () => {
  it('trims the text', () => {
    expect(readOperatorStatus('  Vi kører efter planen ')).toBe('Vi kører efter planen');
  });

  it('is empty when the sensor has none: absent, null or not text', () => {
    for (const raw of [undefined, null, '', '   ', 0, false, ['Vi kører efter planen']]) {
      expect(readOperatorStatus(raw)).toBe('');
    }
  });
});

describe('readOperatorOk', () => {
  it('is true for true and for the string a true attribute arrives as', () => {
    expect(readOperatorOk(true)).toBe(true);
    expect(readOperatorOk('true')).toBe(true);
  });

  it('is false for anything else: absent, null, false or other text', () => {
    for (const raw of [undefined, null, false, 'false', 'True', '', 'on', 1, 0]) {
      expect(readOperatorOk(raw)).toBe(false);
    }
  });
});

describe('isOperatorDisruption', () => {
  it('is false without a status text, whatever the flag says', () => {
    expect(isOperatorDisruption('', false)).toBe(false);
    expect(isOperatorDisruption('', true)).toBe(false);
  });

  it('is false for an all-clear', () => {
    expect(isOperatorDisruption('Vi kører efter planen', true)).toBe(false);
  });

  it('is true for a text the operator does not call ok', () => {
    expect(isOperatorDisruption('Signalfejl mellem Nørrebro og Østerport', false)).toBe(true);
  });
});

describe('transitEmptyMessage', () => {
  it('says the service is normal when the operator says ok and there are no times', () => {
    expect(transitEmptyMessage(false, true)).toBe('Normal service · no times');
  });

  it('says no data when the operator is not ok or says nothing', () => {
    expect(transitEmptyMessage(false, false)).toBe('No data');
  });

  it('asks for a refresh when the departures it has are all past, whatever the operator says', () => {
    expect(transitEmptyMessage(true, false)).toBe('Please refresh data');
    expect(transitEmptyMessage(true, true)).toBe('Please refresh data');
  });
});

describe('transitOperatorNote', () => {
  const line = (operatorStatus: string, operatorOk: boolean, enabled = true) => ({ enabled, operatorStatus, operatorOk });

  it('is empty without a disruption text: an all-clear or nothing', () => {
    expect(transitOperatorNote([line('', false), line('Vi kører efter planen', true)])).toBe('');
  });

  it('names a disruption once when both directions carry it', () => {
    expect(transitOperatorNote([line('Signalfejl på M3', false), line('Signalfejl på M3', false)])).toBe('Signalfejl på M3');
  });

  it('joins different texts', () => {
    expect(transitOperatorNote([line('Sporarbejde', false), line('Signalfejl', false)])).toBe('Sporarbejde · Signalfejl');
  });

  it('leaves out the routes that are off', () => {
    expect(transitOperatorNote([line('Signalfejl', false, false)])).toBe('');
  });
});

describe('getTransitLineDisplayStatus with the operator status', () => {
  const now = new Date(2026, 10, 7, 12, 0, 0);
  const metro = { sensorEntityId: 'sensor.transit_metro', statusEntityId: 'input_select.transit_metro_status', highFrequency: true };
  const sparse = { sensorEntityId: 'sensor.transit_metro', statusEntityId: 'input_select.transit_metro_status' };
  const departure = (time: string, cancelled = false) => ({
    time,
    scheduled_time: time,
    delay_min: 0,
    cancelled,
    problematic: cancelled,
  });
  const healthy = [departure('12:02'), departure('12:05'), departure('12:08')];
  const entities = (attributes: Record<string, unknown>, backend = 'OK'): HassEntities => ({
    'sensor.transit_metro': { entity_id: 'sensor.transit_metro', state: backend, attributes },
    'input_select.transit_metro_status': { entity_id: 'input_select.transit_metro_status', state: backend, attributes: {} },
  });
  const allClear = { operator_status: 'Vi kører efter planen', operator_status_ok: 'true' };
  const disruption = { operator_status: 'Signalfejl mellem Nørrebro og Østerport' };

  it('is Disrupted whatever the departures say when the operator announces a disruption', () => {
    for (const operator of [disruption, { ...disruption, operator_status_ok: false }, { ...disruption, operator_status_ok: 'false' }]) {
      const live = entities({ departures: healthy, ...operator });
      expect(getTransitLineDisplayStatus(metro, live, now)).toBe('Disrupted');
      expect(getTransitLineDisplayStatus(sparse, live, now)).toBe('Disrupted');
    }
  });

  it('is Disrupted for a route without times when the operator announces a disruption', () => {
    expect(getTransitLineDisplayStatus(metro, entities({ departures: [], ...disruption }), now)).toBe('Disrupted');
  });

  it('keeps the status of the backend for a route without times when the operator says ok', () => {
    for (const ok of ['true', true]) {
      const normal = { departures: [], ...allClear, operator_status_ok: ok };
      expect(getTransitLineDisplayStatus(metro, entities(normal), now)).toBe('OK');
      expect(getTransitLineDisplayStatus(metro, entities(normal, 'Unavailable'), now)).toBe('Unavailable');
    }
  });

  it('is not Disrupted by an operator that says ok without a text', () => {
    expect(getTransitLineDisplayStatus(metro, entities({ departures: healthy, operator_status_ok: 'true' }), now)).toBe('OK');
  });

  it('does not let an all-clear hide the cancellations the departures show', () => {
    const cancelled = [
      departure('12:02', true),
      departure('12:04', true),
      departure('12:06', true),
      departure('12:18'),
      departure('12:20'),
    ];
    expect(getTransitLineDisplayStatus(metro, entities({ departures: cancelled, ...allClear }), now)).toBe('Disrupted');
  });

  it('is what the departures say without an operator status', () => {
    expect(getTransitLineDisplayStatus(metro, entities({ departures: healthy }), now)).toBe('OK');
    expect(getTransitLineDisplayStatus(metro, entities({ departures: healthy, operator_status: null }), now)).toBe('OK');
  });
});
