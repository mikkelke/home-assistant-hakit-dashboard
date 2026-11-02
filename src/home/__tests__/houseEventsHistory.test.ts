import { describe, expect, it } from 'vitest';
import { parseHouseEvents, type HouseEvent } from '../houseEvents';
import { fetchHouseEventsPage, HISTORY_OVERLAP_MS, HISTORY_PAGE_MS, houseEventsFromHistory, mergeHouseEvents } from '../houseEventsHistory';
import feed from './fixtures/house-events.json';
import { fakeRecorder, HOUSE_EVENTS_ID, loggedRows } from './houseEventsRecorder';

const row = (ts: string, text: string, extra: Partial<HouseEvent> = {}): HouseEvent => ({
  tsMs: Date.parse(ts),
  icon: 'mdi:door-open',
  text,
  ...extra,
});

const raw = (ts: string, text: string, extra: Record<string, unknown> = {}) => ({ ts, icon: 'mdi:door-open', text, ...extra });

/** A state as the websocket sends it with `minimal_response` off: state, attributes and `lu` in seconds. */
const compressed = (luS: number, events: unknown[], extra: Record<string, unknown> = {}) => ({
  s: (events[0] as { ts?: string } | undefined)?.ts ?? 'unknown',
  a: { friendly_name: 'House events', icon: 'mdi:timeline-clock-outline', events },
  lu: luS,
  ...extra,
});

const DAY_MS = 24 * 3_600_000;

describe('mergeHouseEvents', () => {
  const live = [row('2026-10-13T10:00:00Z', 'c'), row('2026-10-13T09:00:00Z', 'b')];

  it('adds the rows the primary lacks, newest first', () => {
    const merged = mergeHouseEvents(live, [row('2026-10-13T08:00:00Z', 'a'), row('2026-10-13T09:30:00Z', 'b2')]);
    expect(merged.map(event => event.text)).toEqual(['c', 'b2', 'b', 'a']);
  });

  it('is the primary itself when nothing is added', () => {
    expect(mergeHouseEvents(live, [])).toBe(live);
    expect(mergeHouseEvents(live, [row('2026-10-13T09:00:00Z', 'b')])).toBe(live);
  });

  it('takes a row for the same when its time and text are, and keeps the primary copy', () => {
    const primary = [row('2026-10-13T09:00:00Z', 'Washer emptied', { by: 'Kristine' })];
    const merged = mergeHouseEvents(primary, [row('2026-10-13T09:00:00Z', 'Washer emptied'), row('2026-10-13T08:00:00Z', 'older')]);
    expect(merged).toEqual([primary[0], row('2026-10-13T08:00:00Z', 'older')]);
  });

  it('keeps rows with the same time and another text apart, and a row the secondary repeats once', () => {
    const merged = mergeHouseEvents(live, [
      row('2026-10-13T09:00:00Z', 'other'),
      row('2026-10-13T08:00:00Z', 'a'),
      row('2026-10-13T08:00:00Z', 'a'),
    ]);
    expect(merged.map(event => event.text)).toEqual(['c', 'b', 'other', 'a']);
  });

  it('keeps the primary rows ahead of equal times', () => {
    const merged = mergeHouseEvents(
      [row('2026-10-13T09:00:00Z', 'b')],
      [row('2026-10-13T09:00:00Z', 'a'), row('2026-10-13T10:00:00Z', 'c')]
    );
    expect(merged.map(event => event.text)).toEqual(['c', 'b', 'a']);
  });
});

describe('houseEventsFromHistory', () => {
  const e1 = raw('2026-10-13T08:00:00.000000+02:00', 'one');
  const e2 = raw('2026-10-13T09:00:00.000000+02:00', 'two');
  const e3 = raw('2026-10-13T10:00:00.000000+02:00', 'three', { cause: 'Rang', effect: 'Opened' });
  const e4 = raw('2026-10-13T11:00:00.000000+02:00', 'four');

  it('takes every row of every state once, newest first', () => {
    const result = {
      [HOUSE_EVENTS_ID]: [compressed(100, [e2, e1]), compressed(200, [e3, e2, e1]), compressed(300, [e4, e3, e2])],
    };
    const { states, events } = houseEventsFromHistory(result, HOUSE_EVENTS_ID);
    expect(states).toBe(3);
    expect(events.map(event => event.text)).toEqual(['four', 'three', 'two', 'one']);
    expect(events[1]).toMatchObject({ cause: 'Rang', effect: 'Opened' });
  });

  it('keeps the newest state’s copy of a row that gains a field or has it revised', () => {
    const bare = raw('2026-10-13T09:00:00+02:00', 'Dishwasher finished');
    const result = {
      [HOUSE_EVENTS_ID]: [
        compressed(100, [bare]),
        compressed(200, [{ ...bare, by: 'Kristine' }]),
        compressed(300, [{ ...bare, by: 'Mikkel' }]),
      ],
    };
    expect(houseEventsFromHistory(result, HOUSE_EVENTS_ID).events).toEqual([
      row('2026-10-13T09:00:00+02:00', 'Dishwasher finished', { by: 'Mikkel' }),
    ]);
  });

  it('keeps a row that only an older state carries, as the backend may drop one later', () => {
    const result = { [HOUSE_EVENTS_ID]: [compressed(100, [e2, e1]), compressed(200, [e3, e2])] };
    expect(houseEventsFromHistory(result, HOUSE_EVENTS_ID).events.map(event => event.text)).toEqual(['three', 'two', 'one']);
  });

  it('reads rows with `lc` and states in the full form as well', () => {
    const result = {
      [HOUSE_EVENTS_ID]: [
        { state: e1.ts, attributes: { events: [e1] }, last_updated: '2026-10-13T06:00:00Z', last_changed: '2026-10-13T06:00:00Z' },
        compressed(200, [e2, e1], { lc: 150 }),
      ],
    };
    const { states, events } = houseEventsFromHistory(result, HOUSE_EVENTS_ID);
    expect(states).toBe(2);
    expect(events.map(event => event.text)).toEqual(['two', 'one']);
  });

  it('counts a state whose attributes are gone or malformed, and reads nothing from it', () => {
    const result = {
      [HOUSE_EVENTS_ID]: [
        { s: e1.ts, lu: 100 },
        { s: 'x', a: 'nope', lu: 150 },
        { s: 'x', a: { events: 'nope' }, lu: 160 },
        { s: 'x', a: { events: [{ ts: 'yesterday', text: 'bad time' }, null, 7] }, lu: 170 },
        null,
        compressed(200, [e2]),
      ],
    };
    const { states, events } = houseEventsFromHistory(result, HOUSE_EVENTS_ID);
    expect(states).toBe(6);
    expect(events.map(event => event.text)).toEqual(['two']);
  });

  it('has no states for a window before the entity existed', () => {
    for (const result of [{}, { [HOUSE_EVENTS_ID]: [] }, { 'sensor.other': [compressed(100, [e1])] }, null, undefined, 'nope', [], 7]) {
      expect(houseEventsFromHistory(result, HOUSE_EVENTS_ID)).toEqual({ states: 0, events: [] });
    }
  });

  it('reads the fixture feed back from states that each hold fewer of its rows', () => {
    const rows = feed.attributes.events;
    const result = { [HOUSE_EVENTS_ID]: [compressed(100, rows.slice(30)), compressed(200, rows.slice(10)), compressed(300, rows)] };
    const { states, events } = houseEventsFromHistory(result, HOUSE_EVENTS_ID);
    expect(states).toBe(3);
    expect(events).toEqual(parseHouseEvents(rows));
  });
});

describe('fetchHouseEventsPage', () => {
  it('asks the recorder for the pages window of the entity with every state and its attributes', async () => {
    const log = loggedRows(5, '2026-10-13T12:00:00Z', 3_600_000);
    const { connection, sendMessagePromise } = fakeRecorder(log);
    const cursorMs = Date.parse('2026-10-13T12:00:00Z');
    const page = await fetchHouseEventsPage(connection, HOUSE_EVENTS_ID, cursorMs);

    expect(sendMessagePromise).toHaveBeenCalledTimes(1);
    const message = sendMessagePromise.mock.calls[0][0];
    expect(message).toEqual({
      type: 'history/history_during_period',
      start_time: new Date(cursorMs - HISTORY_PAGE_MS).toISOString(),
      end_time: new Date(cursorMs + HISTORY_OVERLAP_MS).toISOString(),
      entity_ids: [HOUSE_EVENTS_ID],
      include_start_time_state: true,
      significant_changes_only: false,
      minimal_response: false,
      no_attributes: false,
    });
    expect(message).not.toHaveProperty('id');
    expect(HISTORY_PAGE_MS).toBe(3 * DAY_MS);
    expect(page.nextCursorMs).toBe(cursorMs - HISTORY_PAGE_MS);
    expect(page.states).toBe(5);
    expect(page.events.map(event => event.text)).toEqual([
      'Door opened 5',
      'Door opened 4',
      'Door opened 3',
      'Door opened 2',
      'Door opened 1',
    ]);
  });

  it('returns the rows of a window in which nothing changed, from the state at its start', async () => {
    const log = loggedRows(50, '2026-10-01T12:00:00Z', 3_600_000);
    const { connection } = fakeRecorder(log);
    const page = await fetchHouseEventsPage(connection, HOUSE_EVENTS_ID, Date.parse('2026-10-20T12:00:00Z'));
    expect(page.states).toBe(1);
    expect(page.events).toHaveLength(40);
    expect(page.events[0].text).toBe('Door opened 50');
  });

  it('finds no states before the first one', async () => {
    const { connection } = fakeRecorder(loggedRows(5, '2026-10-13T12:00:00Z', 3_600_000));
    const page = await fetchHouseEventsPage(connection, HOUSE_EVENTS_ID, Date.parse('2026-09-01T00:00:00Z'));
    expect(page).toEqual({ states: 0, events: [], nextCursorMs: Date.parse('2026-09-01T00:00:00Z') - HISTORY_PAGE_MS });
  });

  it('lets a failed request reject', async () => {
    const failing = { sendMessagePromise: async () => Promise.reject(new Error('lost')) };
    await expect(fetchHouseEventsPage(failing, HOUSE_EVENTS_ID, Date.now())).rejects.toThrow('lost');
  });

  describe('paged back from the live feed', () => {
    /** Every page from the live feed's oldest row back, until the recorder has no state. */
    async function readBack(log: ReturnType<typeof loggedRows>, options?: Parameters<typeof fakeRecorder>[1]) {
      const { connection } = fakeRecorder(log, options);
      const live = parseHouseEvents(log.slice(-40).reverse());
      let older: HouseEvent[] = [];
      let cursorMs = live[live.length - 1].tsMs;
      let pages = 0;
      for (;;) {
        const page = await fetchHouseEventsPage(connection, HOUSE_EVENTS_ID, cursorMs);
        pages++;
        if (page.states === 0) break;
        older = mergeHouseEvents(older, page.events);
        cursorMs = page.nextCursorMs;
      }
      return { all: mergeHouseEvents(live, older), pages, live };
    }

    it('ends with every row of the history once, in order', async () => {
      const log = loggedRows(400, '2026-10-13T12:00:00Z', 20 * 60_000);
      const { all, pages } = await readBack(log);
      expect(all.map(event => event.text)).toEqual(log.map(event => event.text).reverse());
      expect(pages).toBe(3);
    });

    it('does not lose the row whose state is written after the next row’s own time', async () => {
      const burst = [
        ...loggedRows(20, '2026-10-12T12:00:00Z', 3_600_000, 'before'),
        { ts: '2026-10-12T12:30:00.000Z', icon: 'mdi:door-open', text: 'first of two' },
        { ts: '2026-10-12T12:30:00.005Z', icon: 'mdi:door-open', text: 'second of two' },
        ...loggedRows(39, '2026-10-14T04:30:00Z', 3_600_000, 'after'),
      ];
      const { all, live } = await readBack(burst);
      expect(live[live.length - 1].tsMs).toBe(Date.parse('2026-10-12T12:30:00.005Z'));
      expect(all.map(event => event.text)).toEqual(burst.map(event => event.text).reverse());
    });

    it('crosses a stretch in which nothing was written', async () => {
      const log = [
        ...loggedRows(30, '2026-08-01T12:00:00Z', 3_600_000, 'summer'),
        ...loggedRows(45, '2026-10-13T12:00:00Z', 3_600_000, 'autumn'),
      ];
      const { all, pages } = await readBack(log);
      expect(all.map(event => event.text)).toEqual(log.map(event => event.text).reverse());
      expect(pages).toBeGreaterThan(20);
    });
  });
});
