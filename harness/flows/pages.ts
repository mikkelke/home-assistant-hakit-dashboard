import type { Flow } from '../flow';

export const pageFlows: Flow[] = [
  {
    name: 'lists',
    open: { hash: '#lists' },
    ready: '.lists-page',
    run: async shots => {
      await shots.scrolling('.lists-page-content', 'lists', 5);
    },
  },
  {
    name: 'lists as a resident',
    house: { viewer: 'resident' },
    open: { hash: '#lists' },
    ready: '.lists-page',
    run: async shots => {
      await shots.scrolling('.lists-page-content', 'lists-resident');
    },
  },
  {
    name: 'lists visibility',
    open: { hash: '#lists' },
    ready: '.lists-page',
    run: async shots => {
      await shots.page.locator('button[aria-label="List visibility"]').click();
      await shots.page.waitForSelector('.appliance-sheet');
      await shots.shot('lists-visibility');
    },
  },
  {
    name: 'heating',
    open: { hash: '#heating' },
    ready: '.heating-page .heat-zone-row',
    run: async shots => {
      await shots.scrolling('.heating-page-content', 'heating');
    },
  },
  {
    name: 'heating advice',
    house: { heatingAdvice: 'stop' },
    open: { hash: '#heating' },
    ready: '.heating-page .heat-zone-row',
    run: async shots => {
      await shots.page.locator('.heat-advisor-top').click();
      await shots.scrolling('.heating-page-content', 'heating-advice');
    },
  },
  {
    name: 'heating zone sheet',
    open: { hash: '#heating' },
    ready: '.heating-page .heat-zone-row',
    run: async shots => {
      await shots.page.locator('.heat-zone-row').first().click();
      await shots.page.waitForSelector('.heat-zone-sheet');
      await shots.scrolling('.heat-zone-sheet .climate-scroll', 'heating-zone-sheet');
    },
  },
  {
    name: 'map',
    open: { hash: '#map' },
    ready: '.sensor-map:not([data-gate])',
    run: async shots => {
      await shots.shot('map');
    },
  },
];
