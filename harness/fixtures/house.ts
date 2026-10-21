import { HouseBuilder } from './builder';
import { addAppliances } from './appliances';
import { addArtwork } from './artwork';
import { addBatteries } from './batteries';
import { addCoffee } from './coffee';
import { addDoors } from './doors';
import { addEnergy } from './energy';
import { addFeed } from './feed';
import { addHeating } from './heating';
import { addLights } from './lights';
import { addLists } from './lists';
import { addMap } from './map';
import { addMedia } from './media';
import { applyNight } from './night';
import { addRequests } from './requests';
import { addRooms } from './rooms';
import { addVacuum } from './vacuum';
import { addWeather } from './weather';
import { DAY, HOUR, rng } from './time';
import type { Fixture, HistoryPoint, Viewer } from './types';

/** Wednesday 21 October 2026, 18:40 in Copenhagen (UTC+2). */
export const NOW = Date.UTC(2026, 9, 21, 16, 40);
const LATE = Date.UTC(2026, 9, 21, 21, 40);

/** `evening` is 18:40, `night` 23:40. */
export type Moment = 'evening' | 'night';

export type ViewerKind = 'admin' | 'resident' | 'tablet';

/** `normal`: a house in order. `unavailable`: every device offline, as after a power cut. `bare`: Home Assistant up with
 * nothing but the areas, the people, the sun and the forecast. */
export type Mood = 'normal' | 'unavailable' | 'bare';

export const VIEWERS: Record<ViewerKind, Viewer> = {
  admin: { id: 'a1f0c0de0000000000000000000000a1', name: 'Mikkel', isAdmin: true },
  resident: { id: 'b2e1d1ef0000000000000000000000b2', name: 'Kristine', isAdmin: false },
  tablet: { id: 'c3d2e2f00000000000000000000000c3', name: 'Rooftop', isAdmin: false },
};

export interface HouseOptions {
  viewer?: ViewerKind;
  mood?: Mood;
  moment?: Moment;
  /** The heating controller's advice on the season: it says the heating could go off, or come on. */
  heatingAdvice?: 'start' | 'stop';
}

const CONFIG = {
  latitude: 55.67,
  longitude: 12.57,
  elevation: 8,
  unit_system: {
    length: 'km',
    mass: 'g',
    temperature: '°C',
    volume: 'L',
    wind_speed: 'km/h',
    accumulated_precipitation: 'mm',
    pressure: 'hPa',
    area: 'm²',
  },
  location_name: 'Home',
  time_zone: 'Europe/Copenhagen',
  components: ['light', 'sensor', 'binary_sensor', 'climate', 'media_player', 'weather', 'person', 'sun'],
  config_dir: '/config',
  allowlist_external_dirs: [],
  allowlist_external_urls: [],
  version: '2026.10.1',
  config_source: 'storage',
  recovery_mode: false,
  safe_mode: false,
  state: 'RUNNING',
  external_url: null,
  internal_url: null,
  currency: 'DKK',
  country: 'DK',
  language: 'en',
  radius: 100,
};

const PEOPLE: Array<[string, string, string, 'home' | 'not_home']> = [
  ['mikkel', 'Mikkel', 'a1f0c0de0000000000000000000000a1', 'home'],
  ['kristine', 'Kristine', 'b2e1d1ef0000000000000000000000b2', 'home'],
  ['claudia', 'Claudia', 'd4c3b3a10000000000000000000000d4', 'not_home'],
];

function presenceHistory(now: number, current: 'home' | 'not_home', seed: number): HistoryPoint[] {
  const points: HistoryPoint[] = [];
  let state: 'home' | 'not_home' = 'home';
  const noise = rng(seed * 101);
  for (let day = 8; day >= 0; day -= 1) {
    const midnight = Math.floor(now / DAY) * DAY - day * DAY;
    for (const [hour, next] of [
      [7.2, 'not_home'],
      [17.4, 'home'],
      [19.8, 'not_home'],
      [21.5, 'home'],
    ] as const) {
      const at = midnight + (hour + noise() * 1.2) * HOUR - 2 * HOUR;
      if (at > now - 20 * 60_000) continue;
      if (day % 4 === 3 && next === 'not_home' && hour < 10) continue;
      state = next;
      points.push({ t: at, state });
    }
  }
  const last = points[points.length - 1];
  if (!last || last.state !== current) points.push({ t: now - (current === 'home' ? 190 : 25) * 60_000, state: current });
  return points;
}

export function createHouse({ viewer = 'admin', mood = 'normal', moment = 'evening', heatingAdvice }: HouseOptions = {}): Fixture {
  const house = new HouseBuilder(moment === 'night' ? LATE : NOW, VIEWERS[viewer]);

  for (const [key, name, userId, state] of PEOPLE) {
    house.put(
      `person.${key}`,
      state,
      { friendly_name: name, user_id: userId, source: `device_tracker.${key}_phone` },
      { ago: state === 'home' ? 190 : 25 }
    );
    house.put(`input_boolean.${key}_sleep_mode`, 'off', { friendly_name: `${name} sleep mode` }, { ago: 700 });
    house.history[`person.${key}`] = presenceHistory(house.now, state, key.length);
  }
  addWeather(house);
  addArtwork(house);

  if (mood !== 'bare') {
    addRooms(house);
    addLights(house);
    addMedia(house);
    addDoors(house);
    addAppliances(house);
    addBatteries(house);
    addCoffee(house);
    addHeating(house);
    addVacuum(house);
    addFeed(house);
    addEnergy(house);
    addLists(house);
    addRequests(house);
    addMap(house);
    if (moment === 'night') applyNight(house);
    const controller = house.states.get('sensor.heating_controller');
    if (heatingAdvice && controller) {
      house.put(
        'sensor.heating_controller',
        controller.state,
        {
          ...controller.attributes,
          season_advice: heatingAdvice,
          season_advice_reason: heatingAdvice === 'stop' ? 'warm_enough' : 'forecast_cool',
        },
        { ago: 5 }
      );
    }
  } else {
    addRooms(house);
    for (const id of [...house.states.keys()]) if (!/^(person|sun|weather)\./.test(id)) house.remove(id);
  }

  if (mood === 'unavailable') {
    delete house.query.coffee_demo;
    for (const [id, seed] of house.states) {
      if (/^(person|sun)\./.test(id)) continue;
      house.states.set(id, {
        ...seed,
        state: 'unavailable',
        attributes: { friendly_name: seed.attributes.friendly_name, restored: true, supported_features: 0 },
      });
    }
  }

  return house.toFixture(CONFIG);
}
