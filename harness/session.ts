import type { Page } from '@playwright/test';
import { ROOMS } from './fixtures/rooms';
import type { Fixture } from './fixtures/types';
import { mockHa, type MockHa } from './mock/ha';
import { mockNetwork, type Network } from './mock/network';

export const PORT = 4799;
export const ORIGIN = `http://127.0.0.1:${PORT}`;
export const BASE = `${ORIGIN}/local/ha-dashboard/`;

/** The localStorage flags that keep a room panel's cards collapsed until opened. Set to `false` they open. */
const CARD_FLAGS = [
  'tonightcard-collapsed',
  'coffeecard-collapsed',
  'dishwashercard-collapsed',
  'dryercard-collapsed',
  'washercard-collapsed',
  'accesscard-collapsed',
  'sonoscard-collapsed',
  'robercard-collapsed',
  'tvcard-collapsed-media_player_living_room_tv',
  'tvcard-collapsed-media_player_bedroom_tv',
  ...ROOMS.flatMap(({ key }) => [
    `lightcard-collapsed-${key}`,
    `covercard-collapsed-${key}`,
    `heatcard-collapsed-${key}`,
    `wakeupalarm-collapsed-${key}`,
  ]),
];

export interface Session {
  ha: MockHa;
  network: Network;
  /** Uncaught exceptions and console errors of the page. */
  errors: string[];
}

export interface OpenOptions {
  /** Appended to the page URL, e.g. `#energy`. */
  hash?: string;
  /** Query string with its leading `?`. */
  search?: string;
  /** Opens the room panel's collapsible cards. */
  expanded?: boolean;
}

/** Opens the built dashboard against a mock Home Assistant, with the clock held at the fixture's moment. */
export async function openDashboard(
  page: Page,
  fixture: Fixture,
  { hash = '', search = '', expanded = false }: OpenOptions = {}
): Promise<Session> {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => errors.push(`request: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`));
  const ha = await mockHa(page, fixture);
  const network = await mockNetwork(page, fixture, BASE);
  await page.clock.setFixedTime(fixture.now);
  await page.addInitScript(
    ({ origin, expires, flags }) => {
      window.localStorage.setItem(
        'hassTokens',
        JSON.stringify({
          hassUrl: origin,
          clientId: `${origin}/`,
          expires,
          refresh_token: 'harness',
          access_token: 'harness',
          expires_in: 1800,
        })
      );
      for (const flag of flags) window.localStorage.setItem(flag, 'false');
    },
    { origin: ORIGIN, expires: fixture.now + 10 * 365 * 86_400_000, flags: expanded ? CARD_FLAGS : [] }
  );
  const query = new URLSearchParams({ ...fixture.query, ...Object.fromEntries(new URLSearchParams(search)) }).toString();
  await page.goto(`${BASE}${query ? `?${query}` : ''}${hash}`);
  return { ha, network, errors };
}
