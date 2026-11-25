// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HassEntities } from '../../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@hakit/core', () => ({ useHass: () => undefined }));
vi.mock('home-assistant-js-websocket', () => ({ getUser: () => undefined }));
vi.mock('@iconify/react', async () => {
  const { createElement } = await import('react');
  return { Icon: ({ icon }: { icon: string }) => createElement('i', { 'data-icon': icon }) };
});
/** The week is another test's business: it stands in as a marker that says whether it draws the water. */
vi.mock('../TerraceChart', async () => {
  const { createElement } = await import('react');
  return { TerraceChart: ({ showWater }: { showWater: boolean }) => createElement('div', { 'data-chart': showWater ? 'water' : 'air' }) };
});
vi.mock('../TemperatureHistoryChart', () => ({ TemperatureHistoryChart: () => null }));

const { TerraceSection } = await import('../TerraceSection');

const HOUR = 3_600_000;
const KEY = 'terrace-collapsed';
const ICE_ROW = { id: 'ice:bath', kind: 'rain', icon: 'mdi:snowflake', area: 'rooftop' };
const ICE_ROWS = {
  thin: { ...ICE_ROW, title: 'Ice bath: thin ice at 0.1 C since 03:10', level: 'thin' },
  thick: { ...ICE_ROW, title: 'Ice bath: thick ice at 0.1 C since 03:10', level: 'thick' },
  /** As the publisher sent it before it told two levels apart. */
  plain: { ...ICE_ROW, title: 'Ice bath at 0.1 C since 03:10' },
};

const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const reading = (entity_id: string, state: string, msAgo = 60_000) => ({ entity_id, state, attributes: {}, last_updated: at(msAgo) });

interface House {
  /** The bath's state and how long ago it last updated. */
  water?: [state: string, msAgo: number] | null;
  station?: boolean;
  /** The ice bath's row the publisher has up, if any. */
  ice?: keyof typeof ICE_ROWS;
}

/** The roof as `sensor.gw2000a_*` and the bath report it: air 4.2, wind 19.08 km/h, which feels like 0.2. */
function house({ water = ['6.0', 60_000], station = true, ice }: House = {}): HassEntities {
  const entities = [
    ...(water ? [reading('sensor.ice_bath_temperature', water[0], water[1])] : []),
    ...(station
      ? [
          reading('sensor.gw2000a_outdoor_temperature', '4.2'),
          reading('sensor.gw2000a_humidity', '88'),
          reading('sensor.gw2000a_wind_speed', '19.08'),
        ]
      : []),
    {
      entity_id: 'sensor.house_upcoming',
      state: 'x',
      attributes: { expires: new Date(Date.now() + 600_000).toISOString(), rows: ice ? [ICE_ROWS[ice]] : [] },
    },
  ];
  return Object.fromEntries(entities.map(entity => [entity.entity_id, entity])) as HassEntities;
}

let root: Root;
let kept: Map<string, string>;

beforeEach(() => {
  kept = new Map();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    },
  });
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

const show = (entities: HassEntities, requested = false) => act(() => root.render(createElement(TerraceSection, { entities, requested })));
const toggle = () => document.querySelector<HTMLButtonElement>('.terrace-toggle');
const tap = () => act(() => toggle()!.click());
const summary = () => document.querySelector('.terrace-summary')?.textContent ?? null;
const body = () => document.querySelector('.terrace-grid');

describe('the terrace heading', () => {
  it('is a full-width button with a chevron, open by default, and the section keeps its name', () => {
    show(house());
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
    expect(toggle()?.closest('h3')).not.toBeNull();
    expect(toggle()?.querySelector('i')?.getAttribute('data-icon')).toBe('mdi:chevron-up');
    expect(toggle()?.getAttribute('aria-controls')).toBe(body()?.id);
    expect(document.querySelector('section')?.getAttribute('aria-labelledby')).toBe('terrace-title');
    expect(document.getElementById('terrace-title')?.textContent).toBe('Terrace');
    expect(body()).not.toBeNull();
    expect(summary()).toBeNull();
  });

  it('folds to one line that names the bath, the air and how it feels, and unfolds again', () => {
    show(house());
    tap();
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle()?.hasAttribute('aria-controls')).toBe(false);
    expect(toggle()?.querySelector('i')?.getAttribute('data-icon')).toBe('mdi:chevron-down');
    expect(body()).toBeNull();
    expect(document.querySelector('.terrace-hero')).toBeNull();
    expect(summary()).toBe('Ice bath 6.0° cold · air 4.2° · feels 0.2°');
    tap();
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
    expect(body()).not.toBeNull();
    expect(summary()).toBeNull();
  });

  it('says how thick the ice is in the folded line when the ice row is published', () => {
    show(house({ ice: 'thin' }));
    tap();
    expect(summary()).toBe('Ice bath 6.0° · Thin ice · air 4.2° · feels 0.2°');
    show(house({ ice: 'thick' }));
    expect(summary()).toBe('Ice bath 6.0° · Thick ice · air 4.2° · feels 0.2°');
  });

  it('calls the ice thin when the row names no level', () => {
    show(house({ ice: 'plain' }));
    tap();
    expect(summary()).toBe('Ice bath 6.0° · Thin ice · air 4.2° · feels 0.2°');
  });

  it('leaves out of the folded line what has no reading', () => {
    show(house({ water: ['unavailable', HOUR] }));
    tap();
    expect(summary()).toBe('Air 4.2° · feels 0.2°');
  });

  it('is remembered by the device, and read back from it', () => {
    show(house());
    tap();
    expect(kept.get(KEY)).toBe('true');
    tap();
    expect(kept.get(KEY)).toBe('false');
    act(() => root.unmount());
    kept.set(KEY, 'true');
    root = createRoot(document.body.appendChild(document.createElement('div')));
    show(house());
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
    expect(body()).toBeNull();
  });

  it('draws the week only while it is open, so a folded section fetches nothing', () => {
    show(house());
    expect(document.querySelector('[data-chart="water"]')).not.toBeNull();
    tap();
    expect(document.querySelector('[data-chart]')).toBeNull();
  });
});

describe('a request for the terrace', () => {
  it('opens it for this visit and leaves what the device keeps as it was', () => {
    kept.set(KEY, 'true');
    show(house(), true);
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
    expect(body()).not.toBeNull();
    expect(kept.get(KEY)).toBe('true');
  });

  it('opens it when it comes while the room is already open, and stays open when the request is spent', () => {
    kept.set(KEY, 'true');
    show(house());
    expect(body()).toBeNull();
    show(house(), true);
    expect(body()).not.toBeNull();
    show(house(), false);
    expect(body()).not.toBeNull();
    expect(kept.get(KEY)).toBe('true');
  });

  it('folds on a tap like any open section, and the device keeps it folded', () => {
    kept.set(KEY, 'true');
    show(house(), true);
    tap();
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
    expect(body()).toBeNull();
    expect(kept.get(KEY)).toBe('true');
    show(house(), false);
    expect(body()).toBeNull();
  });

  it('is a tap that folds what the device keeps open, when it was open anyway', () => {
    kept.set(KEY, 'false');
    show(house(), true);
    tap();
    expect(body()).toBeNull();
    expect(kept.get(KEY)).toBe('true');
  });
});

describe('the ice on the hero', () => {
  const hero = () => document.querySelector('.terrace-hero');
  const badge = () => document.querySelector('.terrace-badge')?.textContent ?? null;
  const line = () => document.querySelector('.terrace-hero-row')?.textContent ?? null;

  it('is thin or thick as the row says, in the sheet, the badge and the line under the word', () => {
    show(house({ ice: 'thin' }));
    expect([hero()?.getAttribute('data-ice'), badge(), line()]).toEqual(['thin', 'Thin ice', 'At 0.1 C since 03:10']);
    show(house({ ice: 'thick' }));
    expect([hero()?.getAttribute('data-ice'), badge(), line()]).toEqual(['thick', 'Thick ice', 'At 0.1 C since 03:10']);
  });

  it('is thin for a row from before the publisher told two levels apart', () => {
    show(house({ ice: 'plain' }));
    expect([hero()?.getAttribute('data-ice'), badge(), line()]).toEqual(['thin', 'Thin ice', 'At 0.1 C since 03:10']);
  });

  it('is none without the row', () => {
    show(house());
    expect(hero()?.hasAttribute('data-ice')).toBe(false);
    expect([badge(), line()]).toEqual([null, null]);
  });
});

describe('while the bath is packed away', () => {
  it('drops the hero and its row, and keeps the air and the wind', () => {
    show(house({ water: ['6.0', 13 * HOUR], ice: 'thick' }));
    expect(document.querySelector('.terrace-hero')).toBeNull();
    expect(document.querySelector('.terrace-badge')).toBeNull();
    expect(document.querySelector('.terrace-after')).not.toBeNull();
    expect(document.querySelector('.terrace-fact-value')?.textContent).toBe('4.2°');
    expect(body()?.getAttribute('data-water')).toBe('off');
  });

  it('draws the week without the water, as a picture and not a button, with no word about the water', () => {
    show(house({ water: ['6.0', 13 * HOUR] }));
    expect(document.querySelector('[data-chart="air"]')).not.toBeNull();
    const week = document.querySelector('.terrace-chart');
    expect(week?.tagName).toBe('DIV');
    expect(week?.classList.contains('terrace-chart--still')).toBe(true);
    expect(week?.hasAttribute('aria-haspopup')).toBe(false);
    expect(week?.querySelector('.terrace-legend-water')).toBeNull();
    expect(week?.querySelector('.terrace-caption')).toBeNull();
  });

  it('tells how the air feels without the water it was to be got out of', () => {
    show(house());
    expect(document.querySelector('.terrace-feels')?.textContent).toBe('Out of the water: air 4.2°, wind 19 km/h, feels 0.2° chilly');
    show(house({ water: ['6.0', 13 * HOUR] }));
    expect(document.querySelector('.terrace-feels')?.textContent).toBe('Air 4.2°, wind 19 km/h, feels 0.2° chilly');
  });

  it('folds to the air alone, and no ice', () => {
    show(house({ water: ['6.0', 13 * HOUR], ice: 'thick' }));
    tap();
    expect(summary()).toBe('Air 4.2° · feels 0.2°');
  });

  it('is the same for a sensor that is gone, or has said nothing for 13 hours', () => {
    show(house({ water: null }));
    expect(document.querySelector('.terrace-hero')).toBeNull();
    expect(body()).not.toBeNull();
    show(house({ water: ['unavailable', 13 * HOUR] }));
    expect(document.querySelector('.terrace-hero')).toBeNull();
  });

  it('is not there at all when the station has no readings either', () => {
    show(house({ water: ['6.0', 13 * HOUR], station: false }));
    expect(document.querySelector('section')).toBeNull();
    show(house({ water: ['unavailable', 13 * HOUR], station: false }));
    expect(document.querySelector('section')).toBeNull();
  });

  it('is not there when only a dead station is left', () => {
    const entities = house({ water: null, station: false });
    entities['sensor.gw2000a_outdoor_temperature'] = reading('sensor.gw2000a_outdoor_temperature', 'unavailable');
    show(entities);
    expect(document.querySelector('section')).toBeNull();
  });

  it('keeps the bath through an outage: the hero stays with no reading', () => {
    show(house({ water: ['unavailable', 3 * HOUR] }));
    expect(document.querySelector('.terrace-hero')).not.toBeNull();
    expect(document.querySelector('.terrace-hero-value')?.textContent).toBe('—');
    expect(document.querySelector('.terrace-hero-word')?.textContent).toBe('no reading');
    expect(document.querySelector('[data-chart="water"]')).not.toBeNull();
  });

  it('keeps a dead station in the section while the bath is out, as before', () => {
    const entities = house({ station: false });
    entities['sensor.gw2000a_outdoor_temperature'] = reading('sensor.gw2000a_outdoor_temperature', 'unavailable');
    show(entities);
    expect(document.querySelector('.terrace-hero')).not.toBeNull();
    expect(document.querySelector('.terrace-after')).not.toBeNull();
  });
});
