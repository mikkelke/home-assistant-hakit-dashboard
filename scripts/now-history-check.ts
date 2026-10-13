/**
 * Navigation check for the #now timeline in headless Chromium: a cold link into a fresh tab, a reload
 * on it, a row's room over the timeline, Back, Forward, and opening and leaving the timeline in the
 * app. Exits non-zero when any check fails.
 *
 *   HA_TOKEN=... CHROME_PATH=... node scripts/now-history-check.ts \
 *     --url https://<home assistant>/local/<folder>/index.html --link '#now=washer-<epoch s>' [--framed]
 *
 * HA_TOKEN is a long-lived access token; it is planted in the tab's localStorage the way the HA
 * frontend stores its own tokens. With --framed, --url is a same-origin page that marks its entry
 * `{ root: true }` and loads the dashboard in an iframe, the way Home Assistant's panel does: the
 * history and hash are the page's, the dashboard's DOM is the frame's, and a reload reloads the frame.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

function arg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`missing --${name}`);
  return value;
}

const appUrl = arg('url');
const framed = process.argv.includes('--framed');
const DOC = framed ? "document.querySelector('iframe').contentDocument" : 'document';
const query = (selector: string) => `${DOC}.querySelector(${JSON.stringify(selector)})`;
const link = arg('link');
const token = process.env.HA_TOKEN;
const chrome = process.env.CHROME_PATH;
if (!token || !chrome) throw new Error('set HA_TOKEN and CHROME_PATH');

type Message = { id?: number; result?: unknown; error?: unknown };

class Page {
  private nextId = 0;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly socket: WebSocket;
  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data)) as Message;
      const waiter = message.id != null ? this.pending.get(message.id) : undefined;
      if (!waiter || message.id == null) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    });
  }

  static async open(url: string): Promise<Page> {
    const socket = new WebSocket(url);
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
    return new Page(socket);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval<T>(expression: string): Promise<T> {
    const result = (await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })) as {
      result: { value: T };
      exceptionDetails?: unknown;
    };
    if (result.exceptionDetails) throw new Error(`evaluate failed: ${expression}`);
    return result.result.value;
  }

  async until(what: string, expression: string, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.eval<boolean>(`(() => { try { return !!(${expression}); } catch { return false; } })()`)) return;
      await sleep(200);
    }
    throw new Error(`timed out waiting for ${what}; now ${await this.eval<string>(STATE)}`);
  }

  close() {
    this.socket.close();
  }
}

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
  if (!ok) failures += 1;
}

const STATE = `JSON.stringify({ length: history.length, hash: location.hash, now: !!${query('.now-view')}, grid: ${DOC}.querySelectorAll('.room-card').length > 0, marker: history.state && history.state.dashboardNow || null, root: !!(history.state && history.state.root) })`;
type Snapshot = { length: number; hash: string; now: boolean; grid: boolean; marker: string | null; root: boolean };

const port = 9200 + Math.floor(Math.random() * 600);
const profile = mkdtempSync(join(tmpdir(), 'now-history-'));
const browser = spawn(chrome, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], {
  stdio: 'ignore',
});

async function targets(): Promise<{ id: string; type: string; webSocketDebuggerUrl: string }[]> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
        id: string;
        type: string;
        webSocketDebuggerUrl: string;
      }[];
    } catch {
      await sleep(200);
    }
  }
  throw new Error('no DevTools endpoint');
}

try {
  const first = await Page.open((await targets()).find(target => target.type === 'page')!.webSocketDebuggerUrl);
  const origin = new URL(appUrl).origin;
  await first.send('Page.navigate', { url: new URL('version.json', appUrl).toString() });
  await sleep(1500);
  const tokens = {
    hassUrl: origin,
    clientId: `${origin}/`,
    expires: Date.now() + 3_600_000,
    refresh_token: '',
    access_token: token,
    expires_in: 3600,
  };
  await first.eval(`localStorage.setItem('hassTokens', ${JSON.stringify(JSON.stringify(tokens))})`);

  // A new tab opened on the link: a fresh one-entry history, as when a push opens the app.
  const { targetId } = (await first.send('Target.createTarget', { url: `${appUrl}${link}` })) as { targetId: string };
  const page = await Page.open((await targets()).find(target => target.id === targetId)!.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  const snapshot = async () => JSON.parse(await page.eval<string>(STATE)) as Snapshot;

  await page.until(
    'the timeline',
    `${query('.now-view')} && (${query('[data-focus]')} || ${query('[data-now-missing]')} || performance.now() > 9000)`,
    30_000
  );
  let state = await snapshot();
  check('cold link adds exactly one entry over the seeded grid', state.length, 2);
  check('cold link keeps its hash', state.hash, link);
  check('cold link entry is marked as over the grid', state.marker, 'grid');

  await page.eval(framed ? `${DOC}.defaultView.location.reload()` : 'location.reload()');
  await sleep(500);
  await page.until('the timeline after a reload', query('.now-view'), 30_000);
  await sleep(1500);
  state = await snapshot();
  check('a reload on the link adds no entry', state.length, 2);

  await page.eval(`${query('.now-body.is-link, .now-card.is-link')}.click()`);
  await page.until('a room opened from the timeline', `${query('.room-detail')} && location.hash.startsWith('#room=')`);
  state = await snapshot();
  check('a row opens its room as one entry over the timeline', { length: state.length, now: state.now }, { length: 3, now: false });
  await page.eval(`${query('.room-detail-floating-close, .room-detail-header .close-button')}.click()`);
  await page.until('the timeline after closing the room', `${query('.now-view')} && !${query('.room-detail')}`);
  await sleep(800);
  state = await snapshot();
  check('closing that room returns to the timeline', { length: state.length, hash: state.hash }, { length: 3, hash: link });

  await page.eval('history.back()');
  await page.until('the grid after Back', `!${query('.now-view')} && location.hash === ''`);
  state = await snapshot();
  check('Back lands on the grid', { hash: state.hash, now: state.now, grid: state.grid }, { hash: '', now: false, grid: true });
  if (framed) check("the grid entry keeps Home Assistant's root marker", state.root, true);

  await page.eval('history.forward()');
  await page.until('the timeline after Forward', query('.now-view'));
  await sleep(800);
  state = await snapshot();
  // The room stays as the entry after the timeline until the next push replaces it.
  check('Forward reopens the timeline without a new entry', { length: state.length, hash: state.hash }, { length: 3, hash: link });

  await page.eval(`${query('.sky-strip-back')}.click()`);
  await page.until('the grid after the back button', `!${query('.now-view')} && location.hash === ''`);
  state = await snapshot();
  check(
    'the back-to-grid button returns to the grid entry',
    { length: state.length, hash: state.hash, grid: state.grid },
    { length: 3, hash: '', grid: true }
  );

  await page.until('the timeline button', query('[aria-label="Open the timeline"]'));
  await page.eval(`${query('[aria-label="Open the timeline"]')}.click()`);
  await page.until('the timeline from the app', query('.now-view'));
  state = await snapshot();
  check('the app opens the timeline as one entry over the grid', { length: state.length, hash: state.hash }, { length: 2, hash: '#now' });

  await page.eval('history.back()');
  await page.until('the grid after Back from the app', `!${query('.now-view')} && location.hash === ''`);
  state = await snapshot();
  check('Back from an in-app timeline lands on the grid', { hash: state.hash, grid: state.grid }, { hash: '', grid: true });
  if (framed) check("the grid entry still keeps Home Assistant's root marker", state.root, true);

  page.close();
  first.close();
} catch (error) {
  console.log(`FAIL ${(error as Error).message}`);
  failures += 1;
} finally {
  browser.kill('SIGKILL');
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}

console.log(failures === 0 ? 'all checks passed' : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
