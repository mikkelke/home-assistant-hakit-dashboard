import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import type { Session } from './session';

export const OUT = fileURLToPath(new URL('./out', import.meta.url));

const SETTLE_MS = 350;

/** Takes the PNGs of one flow, named `<viewport>/<name>.png`. */
export class Shots {
  readonly page: Page;
  readonly viewport: string;
  readonly session: Session;
  readonly taken: string[] = [];

  constructor(page: Page, viewport: string, session: Session) {
    this.page = page;
    this.viewport = viewport;
    this.session = session;
    mkdirSync(join(OUT, viewport), { recursive: true });
  }

  /** Waits until the page has stopped fetching and drawing. */
  async settle(): Promise<void> {
    await this.page.evaluate(() => document.fonts.ready);
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(SETTLE_MS);
  }

  async shot(name: string): Promise<void> {
    await this.settle();
    await this.page.screenshot({ path: join(OUT, this.viewport, `${name}.png`), animations: 'disabled' });
    this.taken.push(`${this.viewport}/${name}.png`);
  }

  /** One PNG per screenful of `scroller`, `name-1`, `name-2` and so on; a single `name` when it does not overflow. */
  async scrolling(scroller: string | Locator, name: string, limit = 4): Promise<void> {
    const element = typeof scroller === 'string' ? this.page.locator(scroller).first() : scroller;
    await element.waitFor();
    await this.settle();
    const { client, total } = await element.evaluate(node => ({ client: node.clientHeight, total: node.scrollHeight }));
    const stride = Math.max(1, client - 96);
    const needed = total <= client + 24 ? 1 : 1 + Math.ceil((total - client) / stride);
    const steps = Math.min(limit, needed);
    if (steps < needed) console.log(`[cut] ${this.viewport}/${name}: ${needed} screens long, ${steps} taken`);
    for (let step = 0; step < steps; step += 1) {
      if (step === steps - 1) {
        // Late cards and fonts change the scroll range, so the end is read after settling.
        await this.settle();
        await element.evaluate(node => node.scrollTo({ top: node.scrollHeight, behavior: 'instant' }));
      } else {
        await element.evaluate((node, top) => node.scrollTo({ top, behavior: 'instant' }), step * stride);
      }
      await this.shot(steps === 1 ? name : `${name}-${step + 1}`);
    }
    await element.evaluate(node => node.scrollTo({ top: 0, behavior: 'instant' }));
  }
}
