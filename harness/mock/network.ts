import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page, Route } from '@playwright/test';
import type { Fixture, RestRoute } from '../fixtures/types';
import { historyPeriod } from './recorder';

const require = createRequire(import.meta.url);

interface IconSet {
  icons: Record<string, Record<string, unknown>>;
  aliases?: Record<string, { parent: string } & Record<string, unknown>>;
  width?: number;
  height?: number;
}

const mdi = JSON.parse(readFileSync(require.resolve('@iconify-json/mdi/icons.json'), 'utf8')) as IconSet;

const ICON_HOSTS = new Set(['api.iconify.design', 'api.simplesvg.com', 'api.unisvg.com']);
const CORS = { 'access-control-allow-origin': '*' };

/** The Iconify API's answer for a list of `mdi` icon names, served from the installed icon data. */
function iconify(names: string[]) {
  const icons: IconSet['icons'] = {};
  const aliases: NonNullable<IconSet['aliases']> = {};
  const notFound: string[] = [];
  const take = (name: string): boolean => {
    if (mdi.icons[name]) {
      icons[name] = mdi.icons[name];
      return true;
    }
    const alias = mdi.aliases?.[name];
    if (alias && take(alias.parent)) {
      aliases[name] = alias;
      return true;
    }
    return false;
  };
  for (const name of names) if (!take(name)) notFound.push(name);
  return { prefix: 'mdi', lastModified: 0, width: mdi.width ?? 24, height: mdi.height ?? 24, icons, aliases, not_found: notFound };
}

function builtinRoutes(fixture: Fixture): RestRoute[] {
  return [
    { match: /\/api\/config$/, respond: () => ({ body: JSON.stringify(fixture.config) }) },
    {
      match: /\/api\/history\/period\//,
      respond: (path, query) => ({ body: JSON.stringify(historyPeriod(fixture, path, query)) }),
    },
  ];
}

export interface Network {
  /** Requests nothing answered: app paths without a fixture route, and hosts outside the fixture. */
  misses: Set<string>;
}

/** Everything the page asks for is answered here or refused, so nothing reaches a real host. The app's own files pass
 * through; icons come from the installed icon data; every other request needs a route in the fixture. */
export async function mockNetwork(page: Page, fixture: Fixture, base: string): Promise<Network> {
  const network: Network = { misses: new Set() };
  const appBase = new URL(base);
  const routes = [...fixture.rest, ...builtinRoutes(fixture)];

  const fulfilJson = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });

  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    const sameOrigin = url.origin === appBase.origin;

    if (sameOrigin && url.pathname.startsWith(appBase.pathname)) {
      return url.pathname.endsWith('/version.json') ? fulfilJson(route, { version: 'harness' }) : route.continue();
    }
    if (ICON_HOSTS.has(url.hostname)) return fulfilJson(route, iconify((url.searchParams.get('icons') ?? '').split(',').filter(Boolean)));

    const entry = routes.find(candidate => candidate.match.test(`${url.host}${url.pathname}`));
    if (entry) {
      const reply = entry.respond(url.pathname, url.searchParams);
      return route.fulfill({
        status: reply.status ?? 200,
        contentType: reply.contentType ?? 'application/json',
        headers: CORS,
        body: reply.body,
      });
    }
    network.misses.add(`${sameOrigin ? 'unmocked' : 'blocked'} ${route.request().method()} ${url.host}${url.pathname}`);
    return sameOrigin ? route.fulfill({ status: 404, contentType: 'text/plain', body: 'not mocked' }) : route.abort();
  });
  return network;
}
