import type { Page } from '@playwright/test';
import type { Flow } from '../flow';

const ROOM = '.room-detail';

const open = (hash: string, search = '') => ({ hash, search, expanded: true });
const pause = (page: Page) => page.waitForTimeout(450);

export const overlayFlows: Flow[] = [
  {
    name: 'climate sheet',
    open: { hash: '#room=living_room&climate=1' },
    ready: '.appliance-sheet',
    run: async shots => {
      await shots.shot('room-living-room-climate');
    },
  },
  {
    name: 'sonos speakers',
    open: open('#room=living_room'),
    ready: ROOM,
    run: async shots => {
      await shots.page.locator(`${ROOM} button[aria-label="Speakers"]`).first().click();
      await shots.page.waitForSelector('.sonos-sheet');
      await shots.shot('sonos-speakers');
    },
  },
  {
    name: 'sonos sources',
    open: open('#room=living_room'),
    ready: ROOM,
    run: async shots => {
      await shots.page.locator(`${ROOM} button[aria-label="Source"]`).first().click();
      await shots.page.waitForSelector('.sonos-sheet');
      await pause(shots.page);
      await shots.shot('sonos-sources');
      await shots.page.locator('.sonos-sheet button[aria-label="Spotify"]').click();
      await pause(shots.page);
      await shots.shot('sonos-spotify-playlists');
      await shots.page.locator('.sonos-sheet-body button').first().click();
      await pause(shots.page);
      await shots.scrolling('.sonos-sheet-body', 'sonos-playlist-tracks', 3);
    },
  },
  {
    name: 'sonos podcasts',
    open: open('#room=living_room'),
    ready: ROOM,
    run: async shots => {
      await shots.page.locator(`${ROOM} button[aria-label="Source"]`).first().click();
      await shots.page.waitForSelector('.sonos-sheet');
      await shots.page.locator('.sonos-sheet button[aria-label="Podcasts"]').click();
      await pause(shots.page);
      await shots.shot('sonos-podcasts');
    },
  },
  {
    name: 'apple tv remote',
    open: open('#room=living_room'),
    ready: ROOM,
    run: async shots => {
      await shots.page.locator(`${ROOM} button`, { hasText: 'Remote' }).first().click();
      await shots.page.waitForSelector('.apple-remote-overlay');
      await shots.shot('tv-remote');
    },
  },
  {
    name: 'dishwasher history',
    open: open('#room=kitchen'),
    ready: ROOM,
    run: async shots => {
      await shots.page.locator(`${ROOM} button[aria-label="Cycle history"]`).first().click();
      await shots.page.waitForSelector('.appliance-sheet');
      await pause(shots.page);
      await shots.scrolling('.appliance-sheet-body', 'dishwasher-history', 2);
    },
  },
  {
    name: 'washer history',
    open: open('#room=guest_bathroom'),
    ready: ROOM,
    run: async shots => {
      await shots.page.locator(`${ROOM} button[aria-label="Cycle history"]`).first().click();
      await shots.page.waitForSelector('.appliance-sheet');
      await pause(shots.page);
      await shots.scrolling('.appliance-sheet-body', 'washer-history', 2);
    },
  },
  {
    name: 'rober2 rooms',
    open: open('#room=kitchen'),
    ready: ROOM,
    run: async shots => {
      await shots.page.locator(`${ROOM} button[aria-label="Rooms"]`).first().click();
      await shots.page.waitForSelector('.vacuum-map-modal');
      await pause(shots.page);
      await shots.shot('rober2-rooms');
    },
  },
  {
    name: 'rober2 battery',
    open: open('#room=kitchen'),
    ready: ROOM,
    run: async shots => {
      await shots.page.locator(`${ROOM} button[aria-label="Battery history"]`).first().click();
      await pause(shots.page);
      await shots.shot('rober2-battery');
    },
  },
  {
    name: 'doorbell gallery',
    open: open('#room=hallway'),
    ready: ROOM,
    run: async shots => {
      await shots.page.locator(`${ROOM} button[aria-label^="Who rang"]`).first().click();
      await pause(shots.page);
      await shots.scrolling('.doorbell-grid', 'doorbell-gallery', 3);
    },
  },
];
