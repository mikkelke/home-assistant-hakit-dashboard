/** `sensor.house_scenarios` (AppDaemon HouseScenarios): what was going on in the house, each scenario owning the feed
 * rows it was built from, and the episodes the timeline draws once those rows are folded into their scenario. Pure,
 * apart from the connection a history page is handed. */
import type { Connection } from 'home-assistant-js-websocket';
import { formatHomeClock } from '../energy/homeTime';
import { COOKING_POWER, detailSpec, type CookingSource, type DetailSpec } from './eventDetail';
import { houseEpisodes, houseEventKind, type HouseEpisode, type HouseEvent } from './houseEvents';
import { HISTORY_OVERLAP_MS, HISTORY_PAGE_MS } from './houseEventsHistory';
import type { NowCandidate } from './nowResolve';

export type ScenarioType = 'door' | 'night' | 'machine' | 'cooking';

const TYPES: ReadonlySet<string> = new Set<ScenarioType>(['door', 'night', 'machine', 'cooking']);

export interface HouseScenario {
  id: string;
  type: ScenarioType;
  startMs: number;
  /** null while it is still going on. */
  endMs: number | null;
  where: string | null;
  who: string[];
  /** The times of the feed rows it owns, in epoch ms. */
  memberMs: number[];
  headline: string;
  summary: string;
  /** The words for a viewer who is not the admin, when a row only the admin sees would show in them. */
  publicHeadline: string | null;
  publicSummary: string | null;
  facts: Record<string, unknown>;
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const timeMs = (value: unknown) => (typeof value === 'string' ? new Date(value).getTime() : NaN);

/** Defensive parse of `attributes.scenarios`: entries without an id, a known type, a start or a headline are dropped. */
export function parseHouseScenarios(value: unknown): HouseScenario[] {
  if (!Array.isArray(value)) return [];
  const out: HouseScenario[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const id = text(item.id);
    const type = text(item.type);
    const startMs = timeMs(item.start);
    const headline = text(item.headline);
    if (!id || !TYPES.has(type) || !Number.isFinite(startMs) || !headline) continue;
    const endMs = item.end == null ? null : timeMs(item.end);
    if (endMs != null && !Number.isFinite(endMs)) continue;
    out.push({
      id,
      type: type as ScenarioType,
      startMs,
      endMs,
      where: text(item.where) || null,
      who: Array.isArray(item.who) ? item.who.map(text).filter(Boolean) : [],
      memberMs: Array.isArray(item.members) ? item.members.map(timeMs).filter(Number.isFinite) : [],
      headline,
      summary: text(item.summary),
      publicHeadline: text(item.public_headline) || null,
      publicSummary: text(item.public_summary) || null,
      facts: typeof item.facts === 'object' && item.facts !== null ? (item.facts as Record<string, unknown>) : {},
    });
  }
  return out;
}

/** Every scenario once, by id, oldest first. An ended copy wins over a copy still going on, then the copy built from
 * more rows (one built before a backfill row reached the backend lacks it, and its words with it), then the first
 * list's; members are the union of every copy's, as a copy built after the rows left the backend's window lacks them. */
export function mergeHouseScenarios(...lists: readonly (readonly HouseScenario[])[]): HouseScenario[] {
  const byId = new Map<string, HouseScenario>();
  for (const list of lists) {
    for (const scenario of list) {
      const known = byId.get(scenario.id);
      if (!known) {
        byId.set(scenario.id, scenario);
        continue;
      }
      const ends = Number(scenario.endMs != null) - Number(known.endMs != null);
      const kept = ends > 0 || (ends === 0 && scenario.memberMs.length > known.memberMs.length) ? scenario : known;
      const memberMs = [...new Set([...known.memberMs, ...scenario.memberMs])].sort((a, b) => a - b);
      byId.set(scenario.id, { ...kept, memberMs });
    }
  }
  return [...byId.values()].sort((a, b) => a.startMs - b.startMs);
}

/** The scenarios of every state in a `history/history_during_period` result for `entityId`. */
export function scenariosFromHistory(result: unknown, entityId: string): HouseScenario[] {
  const states = typeof result === 'object' && result !== null ? (result as Record<string, unknown>)[entityId] : undefined;
  if (!Array.isArray(states)) return [];
  return mergeHouseScenarios(
    ...states.map(state => {
      const { a, attributes } = (typeof state === 'object' && state !== null ? state : {}) as { a?: unknown; attributes?: unknown };
      const attrs = (a ?? attributes) as { scenarios?: unknown } | undefined;
      return parseHouseScenarios(attrs?.scenarios);
    })
  );
}

/** The scenarios the recorder holds for the same window as the feed page that ends at `cursorMs`. */
export async function fetchHouseScenariosPage(
  connection: Pick<Connection, 'sendMessagePromise'>,
  entityId: string,
  cursorMs: number
): Promise<HouseScenario[]> {
  const result = await connection.sendMessagePromise<unknown>({
    type: 'history/history_during_period',
    start_time: new Date(cursorMs - HISTORY_PAGE_MS).toISOString(),
    end_time: new Date(cursorMs + HISTORY_OVERLAP_MS).toISOString(),
    entity_ids: [entityId],
    include_start_time_state: true,
    significant_changes_only: false,
    minimal_response: false,
    no_attributes: false,
  });
  return scenariosFromHistory(result, entityId);
}

/** A scenario row's words for the viewer. */
export function scenarioWords(scenario: HouseScenario, isAdmin: boolean): { headline: string; summary: string } {
  if (isAdmin) return { headline: scenario.headline, summary: scenario.summary };
  return { headline: scenario.publicHeadline ?? scenario.headline, summary: scenario.publicSummary ?? scenario.summary };
}

/** Who a scenario names for the viewer. Cooking names who was in the kitchen by their phones, which only the admin
 * sees; everyone else's names come from rows the household sees. */
export function scenarioWho(scenario: HouseScenario, isAdmin: boolean): string[] {
  return scenario.type === 'cooking' && !isAdmin ? [] : scenario.who;
}

const MACHINE_ICONS: Record<string, string> = { washer: 'mdi:washing-machine', dryer: 'mdi:tumble-dryer', dish: 'mdi:dishwasher' };

/** The kind of a scenario's machine (the first one of a laundry), else null. */
export function scenarioMachine(scenario: HouseScenario): 'washer' | 'dryer' | 'dish' | null {
  const first = Array.isArray(scenario.facts.machines) ? scenario.facts.machines[0] : null;
  return first === 'washer' || first === 'dryer' || first === 'dish' ? first : null;
}

export function scenarioIcon(scenario: HouseScenario, rows: readonly HouseEvent[]): string {
  switch (scenario.type) {
    case 'door':
      return rows.some(row => row.icon === 'mdi:moped') ? 'mdi:moped' : 'mdi:bell-ring';
    case 'night':
      return 'mdi:weather-night';
    case 'machine':
      return MACHINE_ICONS[scenarioMachine(scenario) ?? 'washer'];
    case 'cooking':
      return 'mdi:stove';
  }
}

export function scenarioTone(scenario: HouseScenario): string {
  switch (scenario.type) {
    case 'door':
      return 'gold';
    case 'night':
      return 'sun';
    case 'machine':
      return scenarioMachine(scenario) ?? 'washer';
    case 'cooking':
      return 'copper';
  }
}

export const scenarioRowId = (scenario: Pick<HouseScenario, 'id'>) => `scn:${scenario.id}`;

/** The timeline's episodes once the scenarios take their rows: an ended scenario that started since the oldest row
 * loaded (so its own stretch has been read) is one episode, `scn:` and its id, holding the rows it owns; a scenario
 * still going on keeps its rows for its card on the NOW line; every other row is grouped by cause as before. Newest
 * first. `events` are the rows the viewer sees; `oldestMs` is the oldest row loaded, whoever may see it. */
export function scenarioEpisodes(
  events: readonly HouseEvent[],
  scenarios: readonly HouseScenario[],
  oldestMs: number | null
): HouseEpisode[] {
  // A scenario's start is in whole seconds and the rows' times are not.
  const fromMs = oldestMs == null ? null : Math.floor(oldestMs / 1000) * 1000;
  const shown = scenarios.filter(scenario => scenario.endMs == null || (fromMs != null && scenario.startMs >= fromMs));
  const ownerByMs = new Map<number, HouseEpisode>();
  const episodes: HouseEpisode[] = shown.map(scenario => {
    const episode: HouseEpisode = {
      id: scenarioRowId(scenario),
      kind: scenario.type === 'door' ? 'ring' : 'evt',
      startMs: scenario.startMs,
      endMs: scenario.endMs ?? scenario.startMs,
      rows: [],
      scenario,
    };
    for (const ms of scenario.memberMs) ownerByMs.set(ms, episode);
    return episode;
  });
  const loose: HouseEvent[] = [];
  for (const event of [...events].sort((a, b) => a.tsMs - b.tsMs)) {
    const owner = ownerByMs.get(event.tsMs);
    if (owner) owner.rows.push(event);
    else loose.push(event);
  }
  for (const episode of episodes) {
    const kinds = episode.rows.map(houseEventKind).filter(kind => kind !== 'evt');
    if (episode.kind === 'evt' && kinds.length > 0) episode.kind = kinds[0];
  }
  const ended = episodes.filter(episode => episode.scenario?.endMs != null);
  return [...ended, ...houseEpisodes([...loose].reverse())].sort((a, b) => b.startMs - a.startMs);
}

/** The scenarios still going on that the NOW line shows: the night and cooking. A running machine has its own card,
 * and a door visit always has an end. */
export function ongoingScenarios(scenarios: readonly HouseScenario[]): HouseScenario[] {
  return scenarios.filter(scenario => scenario.endMs == null && (scenario.type === 'night' || scenario.type === 'cooking'));
}

/** The rows a scenario still going on owns, as resolver candidates for its card. */
export function ongoingCandidates(scenarios: readonly HouseScenario[], events: readonly HouseEvent[]): NowCandidate[] {
  return ongoingScenarios(scenarios).flatMap(scenario => {
    const members = new Set(scenario.memberMs);
    return events
      .filter(event => members.has(event.tsMs))
      .map(event => ({ id: scenarioRowId(scenario), kind: houseEventKind(event), atMs: event.tsMs, live: true }));
  });
}

/** The door sheet's lines for a visit: the ring and how the street door was answered, then the apartment door. */
export function doorScenarioLines(scenario: HouseScenario, rows: readonly HouseEvent[]): { key: string; text: string; detail: string }[] {
  const door = text(scenario.facts.door) || scenario.where || 'door';
  const street = text(scenario.facts.street);
  const lines = [
    { key: 'ring', text: `Rang the ${door}`, detail: [formatHomeClock(scenario.startMs), street].filter(Boolean).join(' · ') },
  ];
  const apartmentMs = timeMs(scenario.facts.apartment_at);
  if (Number.isFinite(apartmentMs)) {
    const row = rows.find(event => event.tsMs === apartmentMs);
    const by = row?.by;
    lines.push({
      key: 'apartment',
      text: row?.text === 'Came home' ? 'Came home' : 'Apartment door unlocked',
      detail: `${formatHomeClock(apartmentMs)} (+${Math.round((apartmentMs - scenario.startMs) / 1000)} s)${by ? ` · by ${by}` : ''}`,
    });
  }
  return lines;
}

const isCookingSource = (value: unknown): value is CookingSource => typeof value === 'string' && value in COOKING_POWER;

/** The sheet a scenario row opens: a Wolt order's when a visible row is one, else null for a door visit (the ring
 * sheet shows it); the night; the run of a machine's finished row; cooking's power. */
export function scenarioDetail(
  scenario: HouseScenario,
  rows: readonly HouseEvent[],
  exists: (entityId: string) => boolean
): { spec: DetailSpec; event: HouseEvent } | null {
  const fromRows = (kind: DetailSpec['kind']) => {
    for (const event of rows) {
      const spec = detailSpec(event, exists);
      if (spec?.kind === kind) return { spec, event };
    }
    return null;
  };
  const event: HouseEvent = rows[0] ?? { tsMs: scenario.startMs, icon: scenarioIcon(scenario, rows), text: scenario.headline };
  switch (scenario.type) {
    case 'door':
      return fromRows('wolt');
    case 'night':
      return { spec: { kind: 'night', atMs: scenario.startMs }, event: rows.find(row => row.icon === 'mdi:weather-night') ?? event };
    case 'machine':
      return fromRows('appliance');
    case 'cooking': {
      const listed = Array.isArray(scenario.facts.sources) ? scenario.facts.sources.filter(isCookingSource) : [];
      const sources = listed.length > 0 ? listed : (Object.keys(COOKING_POWER) as CookingSource[]);
      return {
        spec: { kind: 'cooking', atMs: scenario.startMs, endMs: scenario.endMs, sources },
        event: { tsMs: scenario.startMs, icon: 'mdi:stove', text: scenario.headline },
      };
    }
  }
}
