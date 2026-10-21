import { readFileSync } from 'node:fs';
import type { HouseBuilder } from './builder';
import { DAY, HOUR, MINUTE, iso } from './time';

const houseEvents = JSON.parse(readFileSync(new URL('../../src/home/__tests__/fixtures/house-events.json', import.meta.url), 'utf8')) as {
  attributes: { events: Array<{ ts: string }> };
};

/** The synthetic feed, moved in time so its newest row is `minutesAgo` before `now`. */
function events(now: number, minutesAgo: number) {
  const rows = houseEvents.attributes.events;
  const shift = now - minutesAgo * MINUTE - Date.parse(rows[0].ts);
  return rows.map(row => ({ ...row, ts: new Date(Date.parse(row.ts) + shift).toISOString() }));
}

const clock = (ms: number) => {
  const d = new Date(ms + 2 * HOUR);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

interface Departure {
  at: number;
  line: string;
  delay?: number;
  cancelled?: boolean;
  category?: string;
  travel?: number;
}

function transit(h: HouseBuilder, key: string, name: string, status: string, departures: Departure[], icon: string) {
  const { now } = h;
  h.put(`input_select.transit_${key}_status`, status, {
    friendly_name: `${name} status`,
    options: ['OK', 'Delayed', 'Disrupted', 'Unavailable'],
  });
  h.put(`input_boolean.transit_${key}_enabled`, 'on', { friendly_name: `${name} enabled` });
  h.put(
    `sensor.transit_${key}`,
    departures.length,
    {
      friendly_name: name,
      icon,
      data_as_of: iso(now - 2 * MINUTE),
      delay_threshold_min: 10,
      rescue_window_min: 5,
      departures: departures.map(d => ({
        time: clock(d.at + (d.delay ?? 0) * MINUTE),
        scheduled_time: clock(d.at),
        line: d.line,
        delay_min: d.delay ?? 0,
        cancelled: d.cancelled === true,
        problematic: (d.delay ?? 0) >= 10 || d.cancelled === true,
        ...(d.category ? { category: d.category } : {}),
        ...(d.travel ? { travel_min: d.travel, arrival_time: clock(d.at + d.travel * MINUTE) } : {}),
      })),
    },
    { ago: 2 }
  );
}

export function addFeed(h: HouseBuilder): void {
  const { now } = h;

  h.put(
    'sensor.house_events',
    iso(now - 11 * MINUTE),
    { friendly_name: 'House events', icon: 'mdi:history', events: events(now, 11) },
    { ago: 11 }
  );

  h.put(
    'sensor.house_upcoming',
    iso(now),
    {
      friendly_name: 'House upcoming',
      expires: iso(now + 30 * MINUTE),
      rows: [
        {
          id: 'rain:terrace',
          kind: 'rain',
          at: iso(now + 20 * MINUTE),
          title: 'Rain from 19:00 with the terrace door open',
          detail: 'About 1.4 mm in the next hour',
          icon: 'mdi:weather-pouring',
          area: 'living_room',
          chip: '19:00',
        },
        {
          id: 'train:kristine',
          kind: 'train',
          at: iso(now + 72 * MINUTE),
          title: 'Train to Odense',
          detail: 'Leaves København H 19:52, platform 5',
          icon: 'mdi:train',
          chip: '19:52',
          audience_users: ['Kristine'],
        },
        {
          id: 'maint:plants:living_room',
          kind: 'maint',
          title: 'Water the plants',
          detail: 'Last watered 8 days ago',
          icon: 'mdi:flower',
          area: 'living_room',
          done: 'tap',
          info: ['Every 7 days', 'Last done 8 days ago'],
          steps: ['Fill the can with lukewarm water', 'Water until the saucer fills', 'Empty the saucer after ten minutes'],
        },
        {
          id: 'maint:washer:filter',
          kind: 'maint',
          title: 'Clean the washer filter',
          detail: 'Every 40 washes, 43 done',
          icon: 'mdi:washing-machine',
          area: 'guest_bathroom',
          done: 'tap',
          info: ['Every 40 washes', 'Last done 47 washes ago'],
          steps: [
            'Switch the washer off at the wall',
            'Open the flap at the bottom right',
            'Turn the filter out slowly into a shallow tray',
            'Rinse it and screw it back in',
          ],
          warn: 'Water will run out of the filter. Keep a tray and a towel ready.',
        },
        {
          id: 'maint:coffee:descale',
          kind: 'maint',
          title: 'Descale the coffee kettle',
          detail: 'Last done 71 days ago',
          icon: 'mdi:coffee-maker-outline',
          area: 'kitchen',
          done: 'tap',
          info: ['Every 60 days', 'Last done 71 days ago'],
        },
        {
          id: 'maint:battery:hallway_sensor',
          kind: 'maint',
          title: 'Change the battery in the hallway sensor',
          detail: 'About 9 % left',
          icon: 'mdi:battery-alert-variant-outline',
          area: 'hallway',
          info: ['Reads 9 %'],
        },
        {
          id: 'maint:smoke:test',
          kind: 'maint',
          at: iso(now + 6 * DAY),
          title: 'Test the smoke alarm',
          detail: 'Due in 6 days',
          icon: 'mdi:smoke-detector-variant',
          area: 'kitchen',
          done: 'tap',
          info: ['Every 30 days'],
        },
      ],
    },
    { ago: 1 }
  );

  h.put('input_datetime.quiet_hours_start', '22:00:00', { friendly_name: 'Quiet hours start', has_time: true, has_date: false });
  h.put('input_datetime.quiet_hours_end', '07:00:00', { friendly_name: 'Quiet hours end', has_time: true, has_date: false });
  h.put('input_boolean.wakeup_bedroom', 'on', { friendly_name: 'Wake-up alarm' });
  h.put('input_datetime.wakeup_bedroom', '07:15:00', { friendly_name: 'Wake-up time', has_time: true, has_date: false });
  h.put('input_button.wake_up_now', 'unknown', { friendly_name: 'Wake up now' });
  h.put('sensor.bedroom_blind_owner', 'idle', {
    friendly_name: 'Bedroom blind owner',
    position: 0,
    manual_pause_until: '',
    claims: [],
    reason: 'Nothing holds the blind.',
  });

  transit(
    h,
    'kbh_ic_odense',
    'København H to Odense',
    'OK',
    [
      { at: now + 12 * MINUTE, line: 'IC', category: 'IC', travel: 74 },
      { at: now + 44 * MINUTE, line: 'ICL', category: 'ICL', travel: 82 },
      { at: now + 72 * MINUTE, line: 'ECE', category: 'ECE', travel: 71, delay: 4 },
      { at: now + 104 * MINUTE, line: 'RE', category: 'Re', travel: 88 },
    ],
    'mdi:train'
  );
  transit(
    h,
    'carlsberg_stog_kbh',
    'Carlsberg to København H',
    'Delayed',
    [
      { at: now + 4 * MINUTE, line: 'F', delay: 11 },
      { at: now + 14 * MINUTE, line: 'A' },
      { at: now + 24 * MINUTE, line: 'F', cancelled: true },
      { at: now + 34 * MINUTE, line: 'A' },
    ],
    'mdi:train'
  );
  transit(
    h,
    'enghave_metro_kbh',
    'Enghave Plads to København H',
    'OK',
    [
      { at: now + 2 * MINUTE, line: 'M3' },
      { at: now + 6 * MINUTE, line: 'M3' },
      { at: now + 11 * MINUTE, line: 'M3' },
      { at: now + 15 * MINUTE, line: 'M3' },
    ],
    'mdi:subway-variant'
  );
  transit(
    h,
    'enghave_metro_frb',
    'Enghave Plads to Frederiksberg',
    'OK',
    [
      { at: now + 4 * MINUTE, line: 'M3' },
      { at: now + 9 * MINUTE, line: 'M3' },
      { at: now + 13 * MINUTE, line: 'M3' },
    ],
    'mdi:subway-variant'
  );
  h.put('input_button.transit_refresh', 'unknown', { friendly_name: 'Transit refresh' });
  h.put(
    'sensor.transit_last_updated',
    iso(now - 2 * MINUTE),
    { friendly_name: 'Transit last updated', device_class: 'timestamp' },
    { ago: 2 }
  );
}
