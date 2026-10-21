import type { Flow } from '../flow';
import { NOW } from '../fixtures/house';

const SCENARIOS = [
  'idle',
  'building',
  'live',
  'paused_no_water',
  'lost_link',
  'ready',
  'trial',
  'trial_brewed',
  'start_failed',
  'asleep',
  'awaiting_cup',
] as const;
type Scenario = (typeof SCENARIOS)[number];

/** The scenarios worth a phone screen too: the phone's stage drops the long-term panels. */
const ON_PHONE: readonly Scenario[] = ['idle', 'live', 'paused_no_water', 'ready', 'start_failed', 'awaiting_cup'];

const slug = (value: string) => value.replace(/_/g, '-');

const stageFlows: Flow[] = SCENARIOS.map(scenario => ({
  name: `coffee stage ${scenario}`,
  house: { viewer: 'tablet' },
  open: { search: `?coffee_demo=${scenario}`, hash: '#coffee' },
  ready: '.coffee-stage',
  run: async shots => {
    await shots.scrolling('.coffee-stage', `coffee-stage-${slug(scenario)}`);
    if (scenario === 'live') {
      await shots.page.clock.setFixedTime(new Date(NOW + 42_000));
      await shots.page.waitForTimeout(1500);
      await shots.scrolling('.coffee-stage', 'coffee-stage-live-drawdown');
    }
  },
}));

const cardFlows: Flow[] = (['idle', 'live', 'ready', 'awaiting_cup'] as const).flatMap((scenario): Flow[] => [
  {
    name: `kitchen coffee card ${scenario}`,
    open: { search: `?coffee_demo=${scenario}`, hash: '#room=kitchen', expanded: true },
    ready: '.room-detail',
    run: async shots => {
      await shots.page.locator('.coffee-card').scrollIntoViewIfNeeded();
      await shots.shot(`kitchen-coffee-${slug(scenario)}`);
    },
  },
  ...(scenario === 'live' || scenario === 'ready'
    ? [
        {
          name: `home with coffee ${scenario}`,
          open: { search: `?coffee_demo=${scenario}` },
          ready: '.rooms-grid .room-card',
          run: async shots => {
            await shots.shot(`home-coffee-${slug(scenario)}`);
          },
        } satisfies Flow,
      ]
    : []),
]);

const tabletKitchen: Flow = {
  name: 'kitchen on the coffee tablet',
  house: { viewer: 'tablet' },
  open: { search: '?coffee_demo=idle', hash: '#room=kitchen' },
  ready: '.room-detail',
  run: async shots => {
    await shots.scrolling('.room-detail-content', 'kitchen-tablet-coffee');
  },
};

export const coffeeFlows: Flow[] = [
  ...stageFlows.map((flow, index) => (ON_PHONE.includes(SCENARIOS[index]) ? flow : { ...flow, only: 'tablet' as const })),
  ...cardFlows,
  tabletKitchen,
];
