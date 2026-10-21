import type { Page } from '@playwright/test';
import type { Flow } from '../flow';

const GRID = '.rooms-grid .room-card';
const openMenu = (page: Page) => page.locator('section.sky .sky-menu').click();

export const homeFlows: Flow[] = [
  {
    name: 'home',
    ready: GRID,
    run: async shots => {
      await shots.scrolling('.rooms-container', 'home');
    },
  },
  {
    name: 'home at night',
    house: { moment: 'night' },
    ready: GRID,
    run: async shots => {
      await shots.scrolling('.rooms-container', 'home-night');
    },
  },
  {
    name: 'home with every device unavailable',
    house: { mood: 'unavailable' },
    ready: GRID,
    run: async shots => {
      await shots.scrolling('.rooms-container', 'home-unavailable');
    },
  },
  {
    name: 'home with nothing but the rooms',
    house: { mood: 'bare' },
    ready: GRID,
    run: async shots => {
      await shots.scrolling('.rooms-container', 'home-bare');
    },
  },
  {
    name: 'home as a resident',
    house: { viewer: 'resident' },
    ready: GRID,
    run: async shots => {
      await shots.scrolling('.rooms-container', 'home-resident');
    },
  },
  {
    name: 'menu as the administrator',
    ready: GRID,
    run: async shots => {
      await openMenu(shots.page);
      await shots.page.waitForSelector('.menu.open');
      await shots.shot('menu-admin');
    },
  },
  {
    name: 'menu as a resident',
    house: { viewer: 'resident' },
    ready: GRID,
    run: async shots => {
      await openMenu(shots.page);
      await shots.page.waitForSelector('.menu.open');
      await shots.shot('menu-resident');
    },
  },
  {
    name: 'battery overview',
    ready: GRID,
    run: async shots => {
      await openMenu(shots.page);
      await shots.page.locator('.menu-item-battery').click();
      await shots.page.waitForSelector('.battery-overview-modal');
      await shots.scrolling('.battery-overview-body', 'menu-batteries', 2);
    },
  },
  {
    name: 'smoke alarm sheet',
    ready: GRID,
    run: async shots => {
      await openMenu(shots.page);
      await shots.page.locator('.menu-item', { hasText: 'Smoke alarm' }).click();
      await shots.page.waitForSelector('.appliance-sheet');
      await shots.shot('menu-smoke-alarm');
    },
  },
  {
    name: 'quick access weather',
    ready: GRID,
    run: async shots => {
      await shots.page.locator('.quick-access .qa-button').last().click();
      await shots.page.waitForSelector('.qa-modal.weather');
      await shots.scrolling('.qa-modal-body', 'quick-weather');
    },
  },
  {
    name: 'quick access transit',
    ready: GRID,
    run: async shots => {
      await shots.page.locator('.quick-access button[title="Transit"]').click();
      await shots.page.waitForSelector('.qa-modal.transit');
      await shots.scrolling('.qa-modal-body', 'quick-transit');
    },
  },
  {
    name: 'quick access media',
    ready: GRID,
    run: async shots => {
      await shots.page.locator('.quick-access button[title="Media controls"]').click();
      await shots.page.waitForSelector('.qa-modal.media');
      await shots.scrolling('.qa-modal-body', 'quick-media');
    },
  },
  {
    name: 'quick access doors',
    ready: GRID,
    run: async shots => {
      await shots.page.locator('.quick-access button[title="Access"]').click();
      await shots.page.waitForSelector('.qa-doors');
      await shots.shot('quick-doors');
    },
  },
  {
    name: 'timeline',
    open: { hash: '#now' },
    ready: '.now-view',
    run: async shots => {
      await shots.scrolling('.now-scroll', 'timeline', 4);
    },
  },
  {
    name: 'person timeline',
    ready: GRID,
    run: async shots => {
      await shots.page.locator('section.sky .sky-av-slot').first().click();
      await shots.page.waitForSelector('.person-timeline-modal');
      await shots.shot('person-timeline');
    },
  },
  ...(['pre_alarm', 'alarm', 'hushed'] as const).map(
    (phase): Flow => ({
      name: `fire ${phase}`,
      open: { search: `?fire_demo=${phase}` },
      ready: GRID,
      run: async shots => {
        await shots.page.waitForSelector({ pre_alarm: '.home-pulse-chip', alarm: '.fire-takeover', hushed: '.fire-hush-bar' }[phase]);
        await shots.shot(`fire-${phase.replace('_', '-')}`);
      },
    })
  ),
];
