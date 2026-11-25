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
    name: 'heating plant',
    open: { hash: '#heating' },
    ready: '.heating-page .heat-zone-row',
    run: async shots => {
      await shots.page.locator('.heat-plant-strip').click();
      await shots.page.waitForSelector('.heat-plant-sheet');
      await shots.scrolling('.heat-plant-sheet .climate-scroll', 'heating-plant');
    },
  },
  {
    name: 'body',
    house: { body: 'years' },
    open: { hash: '#body' },
    ready: '.body-now',
    run: async shots => {
      await shots.scrolling('.body-page-content', 'body', 4);
    },
  },
  {
    name: 'body with three weeks of readings',
    house: { body: 'weeks' },
    open: { hash: '#body' },
    ready: '.body-now',
    run: async shots => {
      await shots.scrolling('.body-page-content', 'body-weeks');
    },
  },
  {
    name: 'body on a steady leg',
    house: { body: 'steady' },
    open: { hash: '#body' },
    ready: '.body-now',
    run: async shots => {
      await shots.scrolling('.body-page-content', 'body-steady', 4);
    },
  },
  {
    name: 'body past leg',
    house: { body: 'years' },
    open: { hash: '#body' },
    ready: '.body-phase-chart',
    run: async shots => {
      const chart = shots.page.locator('.body-phase-chart');
      const box = await chart.boundingBox();
      await chart.click({ position: { x: (box?.width ?? 300) * 0.36, y: (box?.height ?? 64) / 2 } });
      await shots.page.locator('.body-phase').evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await shots.shot('body-past-leg');
    },
  },
  {
    name: 'body picked year',
    house: { body: 'years' },
    open: { hash: '#body' },
    ready: '.body-years',
    run: async shots => {
      await shots.page.locator('.body-years button').nth(2).click();
      await shots.page.locator('.body-rhythms').evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await shots.shot('body-year');
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
