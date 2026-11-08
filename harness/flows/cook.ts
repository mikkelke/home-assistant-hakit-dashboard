import type { Flow } from '../flow';

const STAGE = ['heating', 'too_hot', 'ready', 'cooking', 'done', 'interrupted', 'tracking', 'near', 'pull', 'resting', 'carve', 'low_water', 'lost', 'both'] as const;
const PHONE_STAGE: readonly string[] = ['ready', 'pull', 'resting', 'both'];
const CARD = ['ready', 'cooking', 'done', 'tracking', 'pull', 'resting', 'low_water', 'both'] as const;

const slug = (value: string) => value.replace(/_/g, '-');

const stageFlows: Flow[] = STAGE.map(scenario => ({
  name: `cook stage ${scenario}`,
  house: { viewer: 'tablet' },
  open: { search: `?cook_demo=${scenario}`, hash: '#cook' },
  ready: '.cook-stage',
  ...(PHONE_STAGE.includes(scenario) ? {} : { only: 'tablet' as const }),
  run: async shots => {
    await shots.scrolling('.cook-stage', `cook-stage-${slug(scenario)}`);
  },
}));

const cardFlows: Flow[] = CARD.map(scenario => ({
  name: `kitchen cook card ${scenario}`,
  open: { search: `?cook_demo=${scenario}`, hash: '#room=kitchen', expanded: true },
  ready: '.room-detail',
  only: 'phone' as const,
  run: async shots => {
    await shots.page.locator('.cook-card').first().scrollIntoViewIfNeeded();
    await shots.shot(`kitchen-cook-${slug(scenario)}`);
  },
}));

const homeFlow: Flow = {
  name: 'home with cook both',
  open: { search: '?cook_demo=both' },
  ready: '.rooms-grid .room-card',
  only: 'phone',
  run: async shots => {
    await shots.shot('home-cook-both');
  },
};

export const cookFlows: Flow[] = [...stageFlows, ...cardFlows, homeFlow];
