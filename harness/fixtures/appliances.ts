import { readFileSync } from 'node:fs';
import type { HouseBuilder } from './builder';
import { MINUTE, iso, rng } from './time';

const runProfiles = JSON.parse(readFileSync(new URL('../../src/energy/__tests__/fixtures/run-profiles.json', import.meta.url), 'utf8')) as {
  attributes: Record<string, unknown>;
};

const PROGRAMMES = {
  washer: [
    'Auto (unconfirmed)',
    'Ekspres 20',
    'Uld 30',
    'Bomuld 20',
    'Finvask 40',
    'Strygelet 30',
    'ECO',
    'Bomuld 40',
    'Bomuld 60',
    'Bomuld 90/70',
  ],
  dishwasher: ['Auto (unconfirmed)', 'Quick', 'Normal', 'ECO', 'ECO Short', 'Rinse', 'Intensive', 'Unknown'],
  dryer: [
    'Auto (unconfirmed)',
    'Bomuld eco',
    'Bomuld',
    'Strygelet',
    'Finvask',
    'Finish uld',
    'Skjorter',
    'Ekspres',
    'Denim',
    'Sengetøj',
    'Imprægnering',
    'Udglatning',
    'Varm luft',
  ],
};

function cycles(kind: 'washer' | 'dishwasher' | 'dryer', now: number) {
  const noise = rng(kind.length * 17);
  const labels = {
    washer: ['bomuld_60', 'bomuld_40', 'ekspres', 'finvask'],
    dishwasher: ['eco', 'quick', 'normal'],
    dryer: ['ekspres_cupboard', 'bomuld'],
  }[kind];
  return Array.from({ length: 14 }, (_, index) => {
    const label = labels[index % labels.length];
    const confirmedByHuman = index % 3 !== 1;
    return {
      ts: iso(now - (index * 1.4 + 0.6) * 24 * 60 * MINUTE),
      duration_min: Math.round({ washer: 160, dishwasher: 175, dryer: 98 }[kind] * (0.8 + noise() * 0.4)),
      energy_kwh: Math.round({ washer: 0.9, dishwasher: 0.85, dryer: 1.1 }[kind] * (0.7 + noise() * 0.6) * 1000) / 1000,
      predicted: label,
      confirmed: confirmedByHuman ? label : 'unknown',
      programme_confirmed_by_human: confirmedByHuman,
      max_power_w: Math.round(1800 + noise() * 400),
    };
  });
}

export function addAppliances(h: HouseBuilder): void {
  const { now } = h;

  h.put(
    'sensor.washer_state',
    'Unemptied',
    {
      friendly_name: 'Washer state',
      programme_label: 'Bomuld 60',
      detected_programme: 'bomuld_60',
      run_time_minutes: 162,
      energy_used: 1.04,
      cycle_start_time: iso(now - 184 * MINUTE),
      started_by: 'claudia',
      started_by_method: 'dashboard_action',
    },
    { ago: 22 }
  );
  h.put('input_select.washer_confirmed_programme', 'Bomuld 60', {
    friendly_name: 'Washer confirmed programme',
    options: PROGRAMMES.washer,
  });
  h.put('input_select.washer_temperature', '60', { friendly_name: 'Washer temperature', options: ['—', '20', '30', '40', '60'] });
  h.put('input_select.washer_spin_speed', '1200', { friendly_name: 'Washer spin speed', options: ['—', '800', '1000', '1200', '1400'] });
  h.put('input_boolean.washer_announce', 'on', { friendly_name: 'Washer announce' });
  h.put('input_boolean.washer_option_soak', 'off', { friendly_name: 'Washer soak' });
  h.put('input_button.washer_emptied', 'unknown', { friendly_name: 'Washer emptied' });
  h.put(
    'sensor.washer_plug_power',
    2.4,
    { friendly_name: 'Washer plug power', unit_of_measurement: 'W', device_class: 'power' },
    { ago: 1 }
  );

  h.put(
    'sensor.dryer_state',
    'Running',
    {
      friendly_name: 'Dryer state',
      programme_label: 'Ekspres Skabstørt',
      detected_programme: 'ekspres_cupboard',
      progress_pct: 31,
      estimated_remaining_min: 68,
      estimated_end_time: iso(now + 68 * MINUTE),
      cycle_start_time: iso(now - 30 * MINUTE),
      programme_duration_min: 98,
    },
    { ago: 30 }
  );
  h.put('input_select.dryer_programme', 'Ekspres', { friendly_name: 'Dryer programme', options: PROGRAMMES.dryer });
  h.put('input_select.dryer_dryness', 'Skabstørt', { friendly_name: 'Dryer dryness', options: ['Skabstørt', 'Strygetørt'] });
  h.put('input_boolean.dryer_skane_plus', 'off', { friendly_name: 'Dryer Skåne plus' });
  h.put('input_select.dryer_time_minutes', '60', { friendly_name: 'Dryer time', options: ['20', '30', '60', '90', '120'] });
  h.put('input_boolean.dryer_announce', 'off', { friendly_name: 'Dryer announce' });
  h.put('input_button.dryer_emptied', 'unknown', { friendly_name: 'Dryer emptied' });
  h.put(
    'sensor.dryer_plug_power',
    1184,
    { friendly_name: 'Dryer plug power', unit_of_measurement: 'W', device_class: 'power' },
    { ago: 1 }
  );

  h.put(
    'sensor.dishwasher_state',
    'Running',
    {
      friendly_name: 'Dishwasher state',
      programme_label: 'ECO',
      detected_programme: 'eco',
      progress_pct: 25,
      estimated_remaining_min: 135,
      estimated_end_time: iso(now + 135 * MINUTE),
      cycle_start_time: iso(now - 45 * MINUTE),
      programme_duration_min: 180,
    },
    { ago: 45 }
  );
  h.put('input_select.dishwasher_state', 'Running', {
    friendly_name: 'Dishwasher state',
    options: ['Off', 'Running', 'Paused', 'Unemptied', 'Emptied'],
  });
  h.put('input_select.dishwasher_confirmed_programme', 'ECO', {
    friendly_name: 'Dishwasher confirmed programme',
    options: PROGRAMMES.dishwasher,
  });
  h.put('input_select.dishwasher_short', '—', { friendly_name: 'Dishwasher short', options: ['—', 'Yes', 'No'] });
  h.put('input_button.dishwasher_emptied', 'unknown', { friendly_name: 'Dishwasher emptied' });
  h.put(
    'sensor.athom_smart_plug_v3_50ec44_power',
    112,
    { friendly_name: 'Dishwasher plug power', unit_of_measurement: 'W', device_class: 'power' },
    { ago: 1 }
  );

  h.put('sensor.appliance_run_profiles', new Date(now - 6 * 24 * 60 * MINUTE).toISOString(), runProfiles.attributes, { ago: 8000 });

  for (const kind of ['washer', 'dishwasher', 'dryer'] as const) {
    h.rest.push({
      match: new RegExp(`/feedback/${kind}\\.json$`),
      respond: () => ({ body: JSON.stringify({ version: 2, cycles: cycles(kind, now) }) }),
    });
  }
}
