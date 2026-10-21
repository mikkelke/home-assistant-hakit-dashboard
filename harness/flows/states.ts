import type { Flow } from '../flow';

const ROOM = '.room-detail';

export const stateFlows: Flow[] = [
  {
    name: 'living room, every device unavailable',
    house: { mood: 'unavailable' },
    open: { hash: '#room=living_room', expanded: true },
    ready: ROOM,
    run: async shots => {
      await shots.scrolling('.room-detail-content', 'room-living-room-unavailable', 3);
    },
  },
  {
    name: 'kitchen, every device unavailable',
    house: { mood: 'unavailable' },
    open: { hash: '#room=kitchen', expanded: true },
    ready: ROOM,
    run: async shots => {
      await shots.scrolling('.room-detail-content', 'room-kitchen-unavailable', 3);
    },
  },
  {
    name: 'living room, nothing but the rooms',
    house: { mood: 'bare' },
    open: { hash: '#room=living_room', expanded: true },
    ready: ROOM,
    run: async shots => {
      await shots.shot('room-living-room-bare');
    },
  },
  {
    name: 'energy, every device unavailable',
    house: { mood: 'unavailable' },
    open: { hash: '#energy' },
    ready: '.energy-page .energy-page-content',
    run: async shots => {
      await shots.scrolling('.energy-page-content', 'energy-live-unavailable', 3);
    },
  },
  {
    name: 'energy, nothing but the rooms',
    house: { mood: 'bare' },
    open: { hash: '#energy' },
    ready: '.energy-page .energy-page-content',
    run: async shots => {
      await shots.shot('energy-live-bare');
    },
  },
  {
    name: 'lists, nothing but the rooms',
    house: { mood: 'bare' },
    open: { hash: '#lists' },
    ready: '.lists-page-note',
    run: async shots => {
      await shots.shot('lists-bare');
    },
  },
  {
    name: 'heating, every device unavailable',
    house: { mood: 'unavailable' },
    open: { hash: '#heating' },
    ready: '.heating-page .heat-zone-row',
    run: async shots => {
      await shots.scrolling('.heating-page-content', 'heating-unavailable');
    },
  },
  {
    name: 'heating, nothing but the rooms',
    house: { mood: 'bare' },
    open: { hash: '#heating' },
    ready: '.heating-page-empty',
    run: async shots => {
      await shots.shot('heating-bare');
    },
  },
  {
    name: 'map, no document yet',
    house: { mood: 'bare' },
    open: { hash: '#map' },
    ready: '.sensor-map:not([data-gate])',
    run: async shots => {
      await shots.shot('map-bare');
    },
  },
  {
    name: 'timeline, nothing but the rooms',
    house: { mood: 'bare' },
    open: { hash: '#now' },
    ready: '.now-view',
    run: async shots => {
      await shots.shot('timeline-bare');
    },
  },
  {
    name: 'coffee stage, no coffee app',
    house: { viewer: 'tablet', mood: 'bare' },
    open: { hash: '#coffee' },
    ready: '.coffee-stage',
    run: async shots => {
      await shots.shot('coffee-stage-bare');
    },
  },
  {
    name: 'media requests',
    ready: '.rooms-grid .room-card',
    run: async shots => {
      await shots.page.locator('.quick-access button[title="Media controls"]').click();
      await shots.page.waitForSelector('.qa-modal.media');
      await shots.page.locator('.qa-media-tab').nth(1).click();
      await shots.page.locator('.rq-tile').click();
      await shots.page.waitForSelector('.rq-sheet');
      await shots.page.waitForTimeout(600);
      await shots.scrolling('.rq-body', 'requests', 3);
    },
  },
];
