import { test } from '@playwright/test';
import { createHouse } from './fixtures/house';
import { coffeeFlows } from './flows/coffee';
import { energyFlows } from './flows/energy';
import { homeFlows } from './flows/home';
import { overlayFlows } from './flows/overlays';
import { pageFlows } from './flows/pages';
import { roomFlows } from './flows/rooms';
import { stateFlows } from './flows/states';
import type { Flow } from './flow';
import { openDashboard } from './session';
import { Shots } from './shots';

const FLOWS: Flow[] = [...homeFlows, ...roomFlows, ...energyFlows, ...overlayFlows, ...pageFlows, ...coffeeFlows, ...stateFlows];

for (const flow of FLOWS) {
  test(flow.name, async ({ page }, info) => {
    test.skip(flow.only !== undefined && flow.only !== info.project.name, `${flow.name} is for the ${flow.only} only`);
    const session = await openDashboard(page, createHouse(flow.house), flow.open);
    const shots = new Shots(page, info.project.name, session);
    try {
      await page.waitForSelector(flow.ready);
      await flow.run(shots);
      const problems = session.errors.filter(error => error.startsWith('pageerror'));
      if (problems.length > 0) throw new Error(`The page threw:\n${problems.join('\n')}`);
    } finally {
      if (flow.house?.mood !== 'bare') {
        for (const miss of [...session.ha.misses, ...session.network.misses]) console.log(`[unmocked] ${flow.name}: ${miss}`);
      }
      for (const error of session.errors) console.log(`[page] ${flow.name}: ${error.slice(0, 240)}`);
    }
  });
}
