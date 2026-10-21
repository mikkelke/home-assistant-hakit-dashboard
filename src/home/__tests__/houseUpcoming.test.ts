import { describe, expect, it } from 'vitest';
import type { HouseEventViewer } from '../houseEvents';
import {
  canViewerSeeUpcoming,
  dueRows,
  hasSheet,
  isDue,
  isDueAt,
  isUpcomingFor,
  MAX_HOUSE_UPCOMING_ROWS,
  opensRoom,
  parseHouseUpcoming,
  type HouseUpcomingRow,
} from '../houseUpcoming';

const MIKKEL: HouseEventViewer = { isAdmin: true, name: 'Mikkel' };
const KRISTINE: HouseEventViewer = { isAdmin: false, name: 'Kristine' };
const CLAUDIA: HouseEventViewer = { isAdmin: false, name: 'Claudia' };
const RESOLVING: HouseEventViewer = { isAdmin: null, name: null };

const NOW = Date.parse('2026-10-14T05:00:00Z');
const LEASE = '2026-10-14T05:15:00+00:00';

/** The rows the publisher's dry run on 14.10.2026 gave, plus a train and a rain row. */
const ROWS = [
  {
    id: 'train:kristine',
    kind: 'train',
    at: '2026-10-14T05:46:00+00:00',
    icon: 'mdi:train',
    title: 'Train to Odense',
    detail: '07:46, 08:02 +5',
    chip: 'S-tog delayed',
    audience_users: ['Kristine'],
  },
  {
    id: 'rain:terrace',
    kind: 'rain',
    at: '2026-10-14T07:00:00+00:00',
    icon: 'mdi:weather-pouring',
    title: 'Rain forecast',
    detail: 'living-room terrace door open',
    area: 'living_room',
  },
  {
    id: 'maint:battery:sensor.ecowitt_battery_8351',
    kind: 'maint',
    icon: 'mdi:battery-alert-variant-outline',
    title: 'Roof weather station',
    detail: 'replace, 2x AA',
    area: 'rooftop',
    audience: 'admin',
  },
  {
    id: 'maint:washer:drum',
    kind: 'maint',
    icon: 'mdi:washing-machine',
    title: 'Washer drum clean',
    detail: 'Bomuld 90 monthly, last unknown',
    area: 'guest_bathroom',
    audience: 'admin',
  },
];

const parse = (rows: unknown, expires: unknown = LEASE, nowMs = NOW) => parseHouseUpcoming({ expires, rows }, nowMs);
const ids = (rows: HouseUpcomingRow[]) => rows.map(row => row.id);
const seenBy = (rows: HouseUpcomingRow[], viewer: HouseEventViewer) => ids(rows.filter(row => canViewerSeeUpcoming(row, viewer)));

describe('parseHouseUpcoming', () => {
  it('reads every field of a row', () => {
    const [train, rain, ws90] = parse(ROWS);
    expect(train).toEqual({
      id: 'train:kristine',
      kind: 'train',
      atMs: Date.parse('2026-10-14T05:46:00Z'),
      icon: 'mdi:train',
      title: 'Train to Odense',
      detail: '07:46, 08:02 +5',
      chip: 'S-tog delayed',
      areaId: null,
      adminOnly: false,
      users: ['Kristine'],
      skipNext: false,
      tapDone: false,
      info: [],
      steps: [],
      warn: null,
    });
    expect(rain).toMatchObject({ areaId: 'living_room', adminOnly: false, users: null, chip: null });
    expect(ws90).toMatchObject({ atMs: null, adminOnly: true, users: null, areaId: 'rooftop' });
  });

  it('drops every row once the lease has run out, and without a lease or rows', () => {
    expect(ids(parse(ROWS, LEASE, Date.parse(LEASE) - 1))).toHaveLength(4);
    expect(parse(ROWS, LEASE, Date.parse(LEASE))).toEqual([]);
    expect(parseHouseUpcoming({ rows: ROWS }, NOW)).toEqual([]);
    expect(parse(ROWS, 'soon')).toEqual([]);
    expect(parseHouseUpcoming({ expires: LEASE }, NOW)).toEqual([]);
    expect(parseHouseUpcoming(undefined, NOW)).toEqual([]);
  });

  it('drops junk rows and keeps the rest', () => {
    const junk = [
      { kind: 'rain', title: 'No id' },
      { id: 'x1', kind: 'rain' },
      { id: 'x2', kind: 'storm', title: 'Unknown kind' },
      { id: 'x3', kind: 'rain', title: 'Bad time', at: 'tomorrow' },
      { id: 'x4', kind: 'rain', title: 'A number', detail: 5 },
      { id: 'x5', kind: 'rain', title: 'A boolean', chip: true },
      { id: 'x6', kind: 'rain', title: 'A null', area: null },
      { id: 'x7', kind: 'rain', title: 'A numeric time', at: 1760420760 },
      { id: 'x8', kind: 'rain', title: 'A nested object', icon: { name: 'x' } },
      { id: 'x9', kind: 'rain', title: 'A list of numbers', audience_users: [1] },
      'not a row',
      null,
    ];
    expect(ids(parse([...junk, ...ROWS]))).toEqual(ids(parse(ROWS)));
  });

  it('caps the rows and falls back to a plain icon', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `rain:${i}`, kind: 'rain', title: 'Rain', icon: 'javascript:x' }));
    const rows = parse(many);
    expect(rows).toHaveLength(MAX_HOUSE_UPCOMING_ROWS);
    expect(rows[0].icon).toBe('mdi:information-outline');
  });
});

/** A tapped maintenance row as the publisher sends it on 15.10.2026. */
const SHEET_ROW = {
  id: 'maint:dishwasher:filters',
  kind: 'maint',
  at: '2026-12-27T08:00:00+00:00',
  icon: 'mdi:dishwasher',
  title: 'Dishwasher filters + spray arms',
  detail: 'rinse filter + arms, 30 runs left, ~27.12',
  area: 'kitchen',
  audience: 'admin',
  done: 'tap',
  info: ['Every 30 runs (~2 months)', 'Counting from 15.10'],
  steps: ['Switch the dishwasher off.', 'Rinse the filters under running water.', 'Refit in reverse.'],
  warn: 'Never run the dishwasher without the filters and the lower spray arm.',
};

describe('the sheet of a maintenance row', () => {
  it('reads the Done button, the info lines, the steps and the safety note', () => {
    const [row] = parse([SHEET_ROW]);
    expect(row).toMatchObject({
      tapDone: true,
      info: ['Every 30 runs (~2 months)', 'Counting from 15.10'],
      steps: ['Switch the dishwasher off.', 'Rinse the filters under running water.', 'Refit in reverse.'],
      warn: 'Never run the dishwasher without the filters and the lower spray arm.',
      areaId: 'kitchen',
      adminOnly: true,
    });
    expect(hasSheet(row)).toBe(true);
  });

  it('opens a sheet for a guide alone, a Done button alone and info lines alone, and for nothing else', () => {
    const without = (...keys: string[]) => Object.fromEntries(Object.entries(SHEET_ROW).filter(([key]) => !keys.includes(key)));
    const [guide, done, info, plain] = parse([
      without('done', 'info'),
      without('steps', 'warn', 'info'),
      without('done', 'steps', 'warn'),
      without('done', 'steps', 'warn', 'info'),
    ]);
    expect([hasSheet(guide), hasSheet(done), hasSheet(info), hasSheet(plain)]).toEqual([true, true, true, false]);
    expect(done.warn).toBeNull();
    expect(info).toMatchObject({ tapDone: false, steps: [], warn: null, info: ['Every 30 runs (~2 months)', 'Counting from 15.10'] });
    expect(plain).toMatchObject({ tapDone: false, info: [], steps: [], warn: null });
  });

  it('keeps only the non-empty lines and trims them', () => {
    const [row] = parse([{ ...SHEET_ROW, info: [' one ', '', '  '], steps: ['', ' Rinse. '], warn: '  ' }]);
    expect(row).toMatchObject({ info: ['one'], steps: ['Rinse.'], warn: null });
  });

  it('gives only a maintenance row a sheet', () => {
    const [rain] = parse([{ ...ROWS[1], done: 'tap', info: ['x'], steps: ['Close the door.'], warn: 'Careful.' }]);
    expect(rain).toMatchObject({ tapDone: false, info: [], steps: [], warn: null });
    expect(hasSheet(rain)).toBe(false);
  });

  it('is a Done button only for done "tap"', () => {
    for (const bad of ['true', 'Tap', '']) {
      expect(parse([{ ...SHEET_ROW, done: bad }])[0].tapDone, bad).toBe(false);
    }
  });

  it('drops a row whose lines are not strings, as for any other field', () => {
    expect(
      parse([
        { ...SHEET_ROW, steps: ['Rinse.', 3] },
        { ...SHEET_ROW, info: [null] },
        { ...SHEET_ROW, warn: 5 },
      ])
    ).toEqual([]);
  });

  it('is seen by admins only', () => {
    const rows = parse([SHEET_ROW]);
    expect(seenBy(rows, MIKKEL)).toEqual(['maint:dishwasher:filters']);
    expect(seenBy(rows, KRISTINE)).toEqual([]);
    expect(seenBy(rows, RESOLVING)).toEqual([]);
  });
});

/** Rows as the publisher sends them: a due row has no time, a row that is not due yet has one. */
const SOON = '2026-12-27T08:00:00+00:00';
const entry = (id: string, kind: string, extra: Record<string, string> = {}, area: string | null = 'kitchen') => ({
  id,
  kind,
  title: 'A job',
  audience: kind === 'maint' ? 'admin' : undefined,
  ...extra,
  ...(area ? { area } : {}),
});
const publish = (...raws: ReturnType<typeof entry>[]) =>
  parse(raws.map(raw => Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined))));

describe('which rows are due', () => {
  it('is the row without a time that does not ask to be passed over', () => {
    const [untimed, timed, skipped] = publish(
      entry('maint:plant:fig', 'maint'),
      entry('maint:plant:palm', 'maint', { at: SOON }),
      entry('maint:dryer:plinth', 'maint', { next: 'skip' })
    );
    expect([isDue(untimed), isDue(timed), isDue(skipped)]).toEqual([true, false, false]);
  });

  it('lists the due rows that name a room and that the viewer sees, in publish order', () => {
    const rows = publish(
      entry('maint:plant:fig', 'maint'),
      entry('rain:terrace', 'rain', {}, 'living_room'),
      entry('maint:plant:palm', 'maint', { at: SOON }),
      entry('maint:dryer:plinth', 'maint', { next: 'skip' }),
      entry('maint:once:mites', 'maint', {}, null),
      entry('maint:battery:sensor.test_battery', 'maint', {}, 'hallway')
    );
    expect(ids(dueRows(rows, MIKKEL, NOW))).toEqual(['maint:plant:fig', 'rain:terrace', 'maint:battery:sensor.test_battery']);
    for (const viewer of [KRISTINE, CLAUDIA, RESOLVING])
      expect(ids(dueRows(rows, viewer, NOW)), viewer.name ?? 'resolving').toEqual(['rain:terrace']);
  });
});

describe('a rain row that is due', () => {
  const MINUTE = 60_000;
  const rainAt = (minutesAhead: number, extra: Record<string, string> = {}) =>
    publish(entry('rain:terrace', 'rain', { at: new Date(NOW + minutesAhead * MINUTE).toISOString(), ...extra }, 'living_room'))[0];

  it('is due from half an hour before its time, and after it, which is how the forecast hour can have begun', () => {
    for (const ahead of [-90, -1, 0, 29, 30]) expect(isDueAt(rainAt(ahead), NOW), `${ahead} min ahead`).toBe(true);
    for (const ahead of [31, 120]) expect(isDueAt(rainAt(ahead), NOW), `${ahead} min ahead`).toBe(false);
    expect(isDueAt(rainAt(45), NOW + 15 * MINUTE)).toBe(true);
  });

  it('is not due while it asks to be passed over', () => {
    expect(isDueAt(rainAt(10, { next: 'skip' }), NOW)).toBe(false);
  });

  it('leaves maintenance and the train to the general rule, whatever their time', () => {
    const soon = new Date(NOW + 10 * MINUTE).toISOString();
    const [job] = publish(entry('maint:plant:fig', 'maint', { at: soon }));
    const [train] = parse(ROWS);
    expect(isDueAt(job, NOW)).toBe(false);
    expect(isDueAt(train, train.atMs! - 5 * MINUTE)).toBe(false);
    expect(isDueAt(publish(entry('maint:plant:fig', 'maint'))[0], NOW)).toBe(true);
  });

  it('is listed for everyone who sees rain once its hour is near, and not before', () => {
    const rows = publish(
      entry('maint:plant:fig', 'maint'),
      entry('rain:terrace', 'rain', { at: new Date(NOW + 45 * MINUTE).toISOString() }, 'living_room')
    );
    expect(ids(dueRows(rows, KRISTINE, NOW))).toEqual([]);
    expect(ids(dueRows(rows, MIKKEL, NOW))).toEqual(['maint:plant:fig']);
    for (const viewer of [MIKKEL, KRISTINE, CLAUDIA, RESOLVING]) {
      expect(ids(dueRows(rows, viewer, NOW + 15 * MINUTE)).includes('rain:terrace'), viewer.name ?? 'resolving').toBe(true);
    }
    expect(ids(dueRows(rows, KRISTINE, NOW + 3 * 60 * MINUTE))).toEqual(['rain:terrace']);
  });
});

describe('the room a row opens', () => {
  const opens = (raw: ReturnType<typeof entry>) => opensRoom(publish(raw)[0]);

  it('is the room of an appliance row, whose room panel has a card for the appliance, due or not', () => {
    for (const id of ['maint:washer:drum', 'maint:dryer:plinth', 'maint:dishwasher:hygiene', 'maint:coffee:rinse', 'maint:rober2:filter']) {
      expect(opens(entry(id, 'maint', { at: SOON })), id).toBe(true);
      expect(opens(entry(id, 'maint', { next: 'skip' })), id).toBe(true);
    }
  });

  it('is none for a plant, a battery or a one off task that is not due yet, whose room panel has nothing about it', () => {
    for (const id of ['maint:plant:fig', 'maint:once:mites', 'maint:battery:sensor.test_battery']) {
      expect(opens(entry(id, 'maint', { at: SOON })), id).toBe(false);
      expect(opens(entry(id, 'maint', { next: 'skip' })), id).toBe(false);
    }
  });

  it('is the room of any row that is due, since the room panel lists it under To do', () => {
    for (const id of ['maint:plant:fig', 'maint:once:mites', 'maint:battery:sensor.test_battery']) {
      expect(opens(entry(id, 'maint')), id).toBe(true);
    }
  });

  it('is none for a row that names no room, and still the room of a rain row, which is no maintenance', () => {
    expect(opens(entry('maint:washer:drum', 'maint', {}, null))).toBe(false);
    expect(opens(entry('maint:plant:fig', 'maint', {}, null))).toBe(false);
    expect(opensRoom(parse(ROWS)[1])).toBe(true);
    expect(opensRoom(parse(ROWS)[0])).toBe(false);
  });
});

describe('who sees which row', () => {
  it('shows maintenance to admins only, the train to Kristine and admins, rain to everyone', () => {
    const rows = parse(ROWS);
    expect(seenBy(rows, MIKKEL)).toEqual(ids(rows));
    expect(seenBy(rows, KRISTINE)).toEqual(['train:kristine', 'rain:terrace']);
    expect(seenBy(rows, CLAUDIA)).toEqual(['rain:terrace']);
    expect(seenBy(rows, RESOLVING)).toEqual(['rain:terrace']);
  });

  it('keeps a maintenance row admin only whatever its audience says, or without one', () => {
    const rows = parse([{ id: 'maint:x', kind: 'maint', title: 'Rober2 filter' }]);
    expect(seenBy(rows, MIKKEL)).toEqual(['maint:x']);
    expect(seenBy(rows, KRISTINE)).toEqual([]);
    expect(seenBy(rows, RESOLVING)).toEqual([]);
    expect(seenBy(parse([{ id: 'maint:y', kind: 'maint', title: 'X', audience_users: ['Kristine'] }]), KRISTINE)).toEqual([]);
  });

  it('drops a row with a misspelled, empty or conflicting audience instead of showing it to everyone', () => {
    const base = { id: 'rain:x', kind: 'rain', title: 'Rain forecast' };
    for (const audience of [
      { audience: 'Admin' },
      { audience: 'admins' },
      { audience: '' },
      { audience_users: [] },
      { audience_users: ['  '] },
      { audience_users: ['Kristine', ''] },
      { audience_users: 'Kristine' },
      { audience: 'admin', audience_users: ['Kristine'] },
    ]) {
      expect(parse([{ ...base, ...audience }])).toEqual([]);
    }
  });

  it('drops a train row that names no one', () => {
    const unnamed: Record<string, unknown> = { ...ROWS[0] };
    delete unnamed.audience_users;
    expect(parse([unnamed])).toEqual([]);
  });

  it('keeps a row that asks to be passed over out of the next chip, but not out of sight', () => {
    const drum = { ...ROWS[3], at: '2026-10-14T05:00:00+00:00', next: 'skip' };
    const [skipped, other] = parse([drum, { ...drum, id: 'maint:other', next: 'show' }]);
    expect(skipped.skipNext).toBe(true);
    expect(isUpcomingFor(skipped, MIKKEL)).toBe(false);
    expect(canViewerSeeUpcoming(skipped, MIKKEL)).toBe(true);
    expect(other.skipNext).toBe(false);
    expect(isUpcomingFor(other, MIKKEL)).toBe(true);
  });

  it('offers the next chip a named row only for the people it names', () => {
    const [train, rain, ws90] = parse(ROWS);
    expect(isUpcomingFor(train, KRISTINE)).toBe(true);
    expect(isUpcomingFor(train, MIKKEL)).toBe(false);
    expect(isUpcomingFor(train, CLAUDIA)).toBe(false);
    expect(isUpcomingFor(rain, CLAUDIA)).toBe(true);
    expect(isUpcomingFor(ws90, MIKKEL)).toBe(true);
    expect(isUpcomingFor(ws90, KRISTINE)).toBe(false);
  });
});
