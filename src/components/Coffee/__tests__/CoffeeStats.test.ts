// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoffeeBeans, CoffeeBrews } from '../../../coffee/model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@hakit/core', () => ({ useHass: Object.assign(() => undefined, { getState: () => ({ connection: null }) }) }));
vi.mock('@iconify/react', () => ({ Icon: () => null }));
vi.mock('../parts', async importOriginal => ({
  ...(await importOriginal<typeof import('../parts')>()),
  CoffeeSheet: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}));

const { parseCoffeeBeans, parseCoffeeBrews, parseWhoCounts } = await import('../../../coffee/model');
const { StatsSheet, WhoBar } = await import('../CoffeeStats');

let root: Root;
beforeEach(() => {
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

const NOW = Date.parse('2026-11-23T12:00:00Z');
const HOURS = Array.from({ length: 24 }, (_, hour) => (hour === 7 ? 2 : 0)).join(',');
const feed = (attributes: Record<string, string>): CoffeeBrews =>
  parseCoffeeBrews({
    state: '2026-11-23T08:00:00+00:00',
    attributes: { v: '1', weeks: '2,3', hours: HOURS, taste: 'sour:2,balanced:2,bitter:0', ...attributes },
  })!;

function renderBar(label: string, csv: string) {
  act(() => root.render(createElement(WhoBar, { label, counts: parseWhoCounts(csv) })));
}

function renderSheet(brews: CoffeeBrews, beans: CoffeeBeans | null = null) {
  act(() =>
    root.render(
      createElement(StatsSheet, {
        brews,
        beans,
        baseline: null,
        advice: null,
        recent: null,
        nowMs: NOW,
        onBeans: () => {},
        onClose: () => {},
      })
    )
  );
}

const tiles = () => [...document.querySelectorAll('.coffee-tile')].map(tile => tile.querySelector('h4')?.firstChild?.textContent);
const parts = () =>
  [...document.querySelectorAll<HTMLElement>('.cst-who-bar span')].map(part => ({
    text: part.textContent,
    grow: part.style.getPropertyValue('flex-grow'),
    colour: part.style.getPropertyValue('--who') || null,
    none: part.classList.contains('is-none'),
  }));

describe('the Beans tile of the stats sheet', () => {
  it('shows each open bag with its own grams and brews, and labels taste for the primary bag', () => {
    const beans = parseCoffeeBeans({
      state: '340',
      attributes: {
        bean_id: 'b5',
        bean_name: 'Signature Brew',
        dose_g: '17',
        brews_left: '20',
        last_op_id: 'add-1',
        undo_until: '2026-11-23T12:10:00Z',
        bags: [
          { bean_id: 'b5', bean_name: 'Signature Brew', remaining: '340', brews_left: '20' },
          { bean_id: 'b4', bean_name: 'Daybreak', remaining: '125', brews_left: '7' },
        ],
      },
    });
    renderSheet(feed({}), beans);
    const bags = [...document.querySelectorAll('.cst-bag')];
    expect(bags.map(bag => bag.querySelector('h4')?.textContent)).toEqual(['Signature Brew', 'Daybreak']);
    expect(bags.map(bag => bag.querySelector('.coffee-big')?.textContent)).toEqual(['≈340g left', '≈125g left']);
    expect(bags.map(bag => bag.querySelector('.cst-beans-bar span')?.textContent)).toEqual(['≈ 20 brews', '≈ 7 brews']);
    expect([...document.querySelectorAll('button')].map(button => button.textContent?.trim())).toEqual(['Added beans', 'Undo the top-up']);
    expect(tiles()).toContain('Taste · Signature Brew');
  });

  it('preserves the single-bag dose in legacy feeds and the add action when there is no bag', () => {
    renderSheet(feed({}), parseCoffeeBeans({ state: '17', attributes: { bean_name: 'Daybreak', brews_left: '1', dose_g: '17' } }));
    expect(document.querySelector('.cst-bag h4')?.textContent).toBe('Daybreak');
    expect(document.querySelector('.cst-beans-bar span')?.textContent).toBe('≈ 1 brew at 17 g');

    renderSheet(feed({}), parseCoffeeBeans({ state: 'unknown', attributes: { bags: [] } }));
    expect(document.querySelector('.cst-bag h4')?.textContent).toBe('Beans');
    expect(document.querySelector('.cst-beans-acts button')?.textContent?.trim()).toBe('Added beans');
  });
});

describe('the Who bar', () => {
  it('splits a row by who, each part as wide as its count, with the name capitalised and nobody named in grey', () => {
    renderBar('Brews', 'mikkel:19,claudia:6,none:27');
    expect(document.querySelector('.cst-who-label')?.textContent).toBe('Brews');
    expect(parts()).toEqual([
      { text: 'Mikkel 19', grow: '19', colour: '#5b6b7d', none: false },
      { text: 'Claudia 6', grow: '6', colour: '#7d8aa0', none: false },
      { text: 'Not named 27', grow: '27', colour: null, none: true },
    ]);
  });

  it('is nothing for a row that has no counts', () => {
    renderBar('Water fills', '');
    expect(document.querySelector('.cst-who')).toBeNull();
  });
});

describe('the Who tile of the stats sheet', () => {
  it('sits after the taste tile and before the time of day, with 60 days on its title row', () => {
    renderSheet(feed({ who_brews: 'mikkel:19,claudia:6,none:27', who_fills: 'mikkel:9,claudia:1,none:5' }));
    expect(tiles()).toEqual(['Cups a week', 'Taste on these beans', 'Who', 'When']);
    const tile = [...document.querySelectorAll('.coffee-tile')][2];
    expect(tile.querySelector('.coffee-tile-r')?.textContent).toBe('60 days');
    expect([...tile.querySelectorAll('.cst-who-label')].map(label => label.textContent)).toEqual(['Brews', 'Water fills']);
  });

  it('shows only the row that has counts', () => {
    renderSheet(feed({ who_brews: 'none:4', who_fills: '' }));
    expect([...document.querySelectorAll('.cst-who-label')].map(label => label.textContent)).toEqual(['Brews']);
    renderSheet(feed({ who_brews: 'none:0', who_fills: 'mikkel:2' }));
    expect([...document.querySelectorAll('.cst-who-label')].map(label => label.textContent)).toEqual(['Water fills']);
  });

  it('is hidden when neither row has counts, as it is for a coffee app that does not publish them', () => {
    renderSheet(feed({ who_brews: '', who_fills: 'none:0' }));
    expect(tiles()).not.toContain('Who');
    renderSheet(feed({}));
    expect(tiles()).toEqual(['Cups a week', 'Taste on these beans', 'When']);
  });
});
