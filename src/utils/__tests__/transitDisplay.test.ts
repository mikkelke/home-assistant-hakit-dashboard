import { describe, expect, it } from 'vitest';
import { TRANSIT_LINES, type TransitStatus } from '../../config/transit';
import type { HassEntities } from '../../types';
import {
  OPERATOR_STATUS_NORMAL,
  formatTravelTime,
  getTransitLineDisplayStatus,
  groupTransitRows,
  isOperatorDisruption,
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
    expect(readOperatorStatus('  Normal togdrift ')).toBe('Normal togdrift');
  });

  it('is empty when the sensor has none: absent, null or not text', () => {
    for (const raw of [undefined, null, '', '   ', 0, false, ['Normal togdrift']]) {
      expect(readOperatorStatus(raw)).toBe('');
    }
  });
});

describe('isOperatorDisruption', () => {
  it('is false without a status and for the normal one', () => {
    expect(isOperatorDisruption('')).toBe(false);
    expect(isOperatorDisruption(OPERATOR_STATUS_NORMAL)).toBe(false);
  });

  it('is true for any other text', () => {
    expect(isOperatorDisruption('Driftsforstyrrelse på M3')).toBe(true);
    expect(isOperatorDisruption('Normal togdrift | Sporarbejde')).toBe(true);
  });
});

describe('transitEmptyMessage', () => {
  it('says the service is normal when the operator does and there are no times', () => {
    expect(transitEmptyMessage(false, 'Normal togdrift')).toBe('Normal service · no times');
  });

  it('says no data when the operator says nothing or announces a disruption', () => {
    expect(transitEmptyMessage(false, '')).toBe('No data');
    expect(transitEmptyMessage(false, 'Driftsforstyrrelse på M3')).toBe('No data');
  });

  it('asks for a refresh when the departures it has are all past, whatever the operator says', () => {
    expect(transitEmptyMessage(true, '')).toBe('Please refresh data');
    expect(transitEmptyMessage(true, 'Normal togdrift')).toBe('Please refresh data');
  });
});

describe('transitOperatorNote', () => {
  const line = (operatorStatus: string, enabled = true) => ({ enabled, operatorStatus });

  it('is empty without a disruption text', () => {
    expect(transitOperatorNote([line(''), line('Normal togdrift')])).toBe('');
  });

  it('names a disruption once when both directions carry it', () => {
    expect(transitOperatorNote([line('Driftsforstyrrelse på M3'), line('Driftsforstyrrelse på M3')])).toBe('Driftsforstyrrelse på M3');
  });

  it('joins different texts', () => {
    expect(transitOperatorNote([line('Sporarbejde'), line('Driftsforstyrrelse')])).toBe('Sporarbejde · Driftsforstyrrelse');
  });

  it('leaves out the routes that are off', () => {
    expect(transitOperatorNote([line('Driftsforstyrrelse', false)])).toBe('');
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

  it('is Disrupted whatever the departures say when the operator announces a disruption', () => {
    const live = entities({ departures: healthy, operator_status: 'Driftsforstyrrelse på M3' });
    expect(getTransitLineDisplayStatus(metro, live, now)).toBe('Disrupted');
    expect(getTransitLineDisplayStatus(sparse, live, now)).toBe('Disrupted');
  });

  it('is Disrupted for a route without times when the operator announces a disruption', () => {
    expect(getTransitLineDisplayStatus(metro, entities({ departures: [], operator_status: 'Driftsforstyrrelse' }), now)).toBe('Disrupted');
  });

  it('keeps the status of the backend for a route without times when the operator says normal', () => {
    const normal = { departures: [], operator_status: OPERATOR_STATUS_NORMAL };
    expect(getTransitLineDisplayStatus(metro, entities(normal), now)).toBe('OK');
    expect(getTransitLineDisplayStatus(metro, entities(normal, 'Unavailable'), now)).toBe('Unavailable');
  });

  it('does not let a normal operator hide the cancellations the departures show', () => {
    const cancelled = [
      departure('12:02', true),
      departure('12:04', true),
      departure('12:06', true),
      departure('12:18'),
      departure('12:20'),
    ];
    expect(getTransitLineDisplayStatus(metro, entities({ departures: cancelled, operator_status: OPERATOR_STATUS_NORMAL }), now)).toBe(
      'Disrupted'
    );
  });

  it('is what the departures say without an operator status', () => {
    expect(getTransitLineDisplayStatus(metro, entities({ departures: healthy }), now)).toBe('OK');
    expect(getTransitLineDisplayStatus(metro, entities({ departures: healthy, operator_status: null }), now)).toBe('OK');
  });
});
