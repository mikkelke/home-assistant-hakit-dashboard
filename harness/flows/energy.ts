import type { Flow } from '../flow';

const TABS = ['live', 'plan', 'usage', 'rooms', 'bill', 'utilities'] as const;
const ENERGY = '.energy-page .energy-page-content';

const period = (name: string) => async (page: import('@playwright/test').Page) => {
  await page
    .locator('.energy-page button', { hasText: new RegExp(`^${name}$`) })
    .first()
    .click();
};

export const energyFlows: Flow[] = [
  ...TABS.map(
    (tab): Flow => ({
      name: `energy ${tab}`,
      open: { hash: tab === 'live' ? '#energy' : `#energy=${tab}` },
      ready: ENERGY,
      run: async shots => {
        await shots.scrolling('.energy-page-content', `energy-${tab}`);
      },
    })
  ),
  {
    name: 'energy usage by clock',
    open: { hash: '#energy=usage' },
    ready: ENERGY,
    run: async shots => {
      await shots.page.locator('button[aria-label="Clock"]').click();
      await shots.shot('energy-usage-clock');
    },
  },
  ...(['week', 'month', 'year'] as const).map(
    (name): Flow => ({
      name: `energy usage ${name}`,
      open: { hash: '#energy=usage' },
      ready: ENERGY,
      run: async shots => {
        await period(name[0].toUpperCase() + name.slice(1))(shots.page);
        await shots.scrolling('.energy-page-content', `energy-usage-${name}`, 3);
      },
    })
  ),
  {
    name: 'energy rooms sheet',
    open: { hash: '#energy=rooms' },
    ready: '.ev-rrow',
    run: async shots => {
      await shots.page.locator('.ev-rrow').first().click();
      await shots.page.waitForTimeout(500);
      await shots.shot('energy-rooms-sheet');
    },
  },
  {
    name: 'energy plan sheet',
    open: { hash: '#energy=plan' },
    ready: ENERGY,
    run: async shots => {
      await shots.page.locator('button[aria-label="Washer plan"]').click();
      await shots.page.waitForTimeout(500);
      await shots.shot('energy-plan-sheet');
    },
  },
  {
    name: 'energy bill year',
    open: { hash: '#energy=bill' },
    ready: ENERGY,
    run: async shots => {
      await period('Year')(shots.page);
      await shots.scrolling('.energy-page-content', 'energy-bill-year');
    },
  },
];
