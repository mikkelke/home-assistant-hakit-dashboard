import type { Flow } from '../flow';
import type { DeliveryScenario } from '../fixtures/delivery';

const GRID = '.rooms-grid .room-card';
const CHIP = '.ticker-chip[class*="is-delivery"]';

const SCENARIOS: Array<[DeliveryScenario, string]> = [
  ['live', 'live'],
  ['busy', 'busy'],
  ['arriving', 'arriving'],
  ['upcoming', 'quiet'],
];

const homeFlows: Flow[] = SCENARIOS.map(([delivery, name]) => ({
  name: `home with delivery ${name}`,
  house: { delivery },
  ready: CHIP,
  run: async shots => {
    await shots.shot(`home-delivery-${name}`);
  },
}));

const sheetFlows: Flow[] = SCENARIOS.map(([delivery, name]) => ({
  name: `delivery sheet ${name}`,
  house: { delivery },
  ready: CHIP,
  run: async shots => {
    await shots.page.locator(CHIP).click();
    await shots.page.waitForSelector('.qa-modal.delivery');
    await shots.scrolling('.qa-modal', `delivery-sheet-${name}`);
  },
}));

const audienceFlows: Flow[] = (['resident', 'tablet'] as const).map(viewer => ({
  name: `home with delivery busy as ${viewer}`,
  house: { viewer, delivery: 'busy' },
  ready: GRID,
  run: async shots => {
    await shots.settle();
    const chips = await shots.page.locator(CHIP).count();
    if (chips !== 0) throw new Error(`${viewer} sees ${chips} delivery chips`);
    await shots.shot(`home-delivery-${viewer}`);
  },
}));

export const deliveryFlows: Flow[] = [...homeFlows, ...sheetFlows, ...audienceFlows];
