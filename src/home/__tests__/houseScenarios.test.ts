import { describe, expect, it } from 'vitest';
import { doorLines } from '../eventDetail';
import { parseHouseEvents, type HouseEvent } from '../houseEvents';
import {
  doorScenarioLines,
  mergeHouseScenarios,
  ongoingCandidates,
  ongoingScenarios,
  parseHouseScenarios,
  scenarioDetail,
  scenarioEpisodes,
  scenarioWho,
  scenarioWords,
  scenariosFromHistory,
  type HouseScenario,
} from '../houseScenarios';
import fixture from './fixtures/house-scenarios.json';

const events = parseHouseEvents(fixture.events, Infinity);
const scenarios = parseHouseScenarios(fixture.scenarios);
const oldestMs = Math.min(...events.map(event => event.tsMs));
const exists = () => true;
const byType = (type: HouseScenario['type']) => scenarios.filter(scenario => scenario.type === type);

describe('parseHouseScenarios', () => {
  it('reads every scenario of the live sensor, a running washer with no end', () => {
    expect(scenarios.map(scenario => scenario.type)).toEqual(['door', 'cooking', 'door', 'night', 'machine', 'machine']);
    const washer = scenarios.at(-1)!;
    expect(washer.endMs).toBeNull();
    expect(washer.summary).toBe('running since 11:59');
  });

  it('drops entries without an id, a known type, a start or a headline', () => {
    const good = fixture.scenarios[0];
    expect(
      parseHouseScenarios([{ ...good, id: '' }, { ...good, type: 'tv' }, { ...good, start: 'later' }, { ...good, headline: '' }, null, 'x'])
    ).toEqual([]);
  });
});

describe('mergeHouseScenarios', () => {
  it('keeps the ended copy and the members of every copy', () => {
    const [night] = byType('night');
    const live = { ...night, endMs: null, memberMs: [] };
    const merged = mergeHouseScenarios([live], [night]);
    expect(merged).toHaveLength(1);
    expect(merged[0].endMs).toBe(night.endMs);
    expect(merged[0].memberMs).toEqual(night.memberMs);
  });

  it('reads the scenarios of every recorder state', () => {
    const [door, cooking] = fixture.scenarios;
    const result = { 'sensor.house_scenarios': [{ a: { scenarios: [door] } }, { attributes: { scenarios: [door, cooking] } }] };
    expect(scenariosFromHistory(result, 'sensor.house_scenarios').map(s => s.id)).toEqual([door.id, cooking.id]);
  });
});

describe('scenarioEpisodes', () => {
  const episodes = scenarioEpisodes(events, scenarios, oldestMs);

  it('folds each scenario’s rows into one episode and leaves the rest as they were', () => {
    const ids = episodes.map(episode => episode.id);
    expect(ids.filter(id => id.startsWith('scn:'))).toEqual([
      'scn:machine:1795137918',
      'scn:night:1795124201',
      'scn:door:1795115431',
      'scn:cooking:1795112981',
      'scn:door:1795112306',
    ]);
    const loose = episodes.filter(episode => !episode.scenario);
    expect(loose.map(episode => episode.rows.map(row => row.text))).toEqual([['Watered Pothos, soil 15% to 69%']]);
    const owned = episodes.flatMap(episode => (episode.scenario ? episode.rows : []));
    expect(owned).toHaveLength(events.length - 1);
  });

  it('gives a door visit the ring kind and its Wolt row', () => {
    const wolt = episodes.find(episode => episode.id === 'scn:door:1795115431')!;
    expect(wolt.kind).toBe('ring');
    expect(wolt.rows.map(row => row.icon)).toEqual(['mdi:bell-ring', 'mdi:door-open', 'mdi:moped']);
  });

  it('leaves a running machine to its card and still shows nothing before the oldest loaded row', () => {
    expect(episodes.some(episode => episode.id === 'scn:machine:1795172366')).toBe(false);
    const later = scenarioEpisodes(events, scenarios, Date.parse('2026-11-20T00:00:00+01:00'));
    expect(later.some(episode => episode.id === 'scn:night:1795124201')).toBe(false);
  });

  it('keeps the rows of a night still going on for its card on the NOW line', () => {
    const [night] = byType('night');
    const ongoing = { ...night, endMs: null };
    const live = scenarioEpisodes(events, [ongoing], oldestMs);
    expect(live.some(episode => episode.rows.some(row => row.text === 'Night mode on'))).toBe(false);
    expect(ongoingScenarios([ongoing])).toEqual([ongoing]);
    expect(ongoingCandidates([ongoing], events).map(c => c.id)).toEqual([
      'scn:night:1795124201',
      'scn:night:1795124201',
      'scn:night:1795124201',
    ]);
  });
});

describe('scenario sheets', () => {
  const episodes = scenarioEpisodes(events, scenarios, oldestMs);
  const episode = (id: string) => episodes.find(e => e.id === id)!;
  const open = (id: string) => scenarioDetail(episode(id).scenario!, episode(id).rows, exists);

  it('opens the Wolt order for a delivery and the ring sheet for a plain ring', () => {
    expect(open('scn:door:1795115431')?.spec).toMatchObject({ kind: 'wolt', title: 'WokXpress - Vesterbro' });
    expect(open('scn:door:1795112306')).toBeNull();
  });

  it('opens the night, the dishwasher run and the cooking power', () => {
    expect(open('scn:night:1795124201')?.spec).toEqual({ kind: 'night', atMs: Date.parse('2026-11-19T22:36:41+01:00') });
    expect(open('scn:machine:1795137918')?.spec).toMatchObject({ kind: 'appliance', appliance: 'dish', kwh: 0.79, emptied: false });
    expect(open('scn:cooking:1795112981')?.spec).toEqual({
      kind: 'cooking',
      atMs: Date.parse('2026-11-19T19:29:41+01:00'),
      endMs: Date.parse('2026-11-19T19:49:50+01:00'),
      sources: ['hob'],
    });
  });

  it('lists the ring and the apartment door of a visit', () => {
    const ring: HouseEvent = {
      tsMs: Date.parse('2026-11-21T12:00:00+01:00'),
      icon: 'mdi:bell-ring',
      text: 'Someone rang the front door -> Opened after 5 s',
      cause: 'Someone rang the front door',
      effect: 'Opened after 5 s',
    };
    const unlock: HouseEvent = { tsMs: ring.tsMs + 52_000, icon: 'mdi:lock-open-variant', text: 'Apartment door unlocked', by: 'Claudia' };
    const [visit] = parseHouseScenarios([
      {
        id: 'door:1',
        type: 'door',
        start: '2026-11-21T12:00:00+01:00',
        end: '2026-11-21T12:00:52+01:00',
        members: [],
        headline: 'Claudia came home',
        summary: 'Rang the front door 12:00 · opened after 5 s · apartment door +52 s',
        facts: { door: 'front door', street: 'opened after 5 s', apartment_at: '2026-11-21T12:00:52+01:00' },
      },
    ]);
    expect(doorScenarioLines(visit, [ring, unlock]).map(line => `${line.text}: ${line.detail}`)).toEqual([
      'Rang the front door: 12:00 · opened after 5 s',
      'Apartment door unlocked: 12:00 (+52 s) · by Claudia',
    ]);
    expect(doorLines([ring], {}, ring.tsMs - 60_000, ring.tsMs + 60_000)[0].detail).toBe('12:00 · opened after 5 s');
  });
});

describe('scenarioWords', () => {
  it('gives a viewer who is not the admin the public headline', () => {
    const [visit] = parseHouseScenarios([
      { ...fixture.scenarios[0], headline: 'Airmee parcel probably outside the door', public_headline: 'Someone rang the front door' },
    ]);
    expect(scenarioWords(visit, true).headline).toBe('Airmee parcel probably outside the door');
    expect(scenarioWords(visit, false).headline).toBe('Someone rang the front door');
  });
});

describe('scenarioWho', () => {
  it('names who was cooking for the admin only', () => {
    const [cooking] = byType('cooking');
    expect(scenarioWho(cooking, true)).toEqual(['Mikkel', 'Claudia']);
    expect(scenarioWho(cooking, false)).toEqual([]);
    expect(scenarioWho(byType('machine')[0], false)).toEqual(['Claudia', 'Mikkel']);
  });
});
