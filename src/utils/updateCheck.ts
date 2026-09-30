declare const __APP_BUILD_VERSION__: string;

const VERSION_POLL_INTERVAL_MS = 60_000;
const VERSION_REQUEST_TIMEOUT_MS = 8_000;

// One reload attempt per published version per window. If the page that loads afterwards still reports a different build
// (a deploy still being copied, a cache serving old files, or a build whose two version stamps disagree) an unguarded check
// would reload again immediately, forever. The window is bounded so a later poll can still retry once the files have settled.
const RELOAD_GUARD_KEY = 'ha-dashboard:update-reload';
const RELOAD_RETRY_AFTER_MS = 5 * 60_000;

function reloadedRecentlyFor(version: string): boolean {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 'null') as { version?: string; at?: number } | null;
    if (saved?.version !== version || typeof saved.at !== 'number') return false;
    const elapsed = Date.now() - saved.at;
    // A negative elapsed time means the clock moved backwards since the attempt; that must not block updates until it catches up.
    return elapsed >= 0 && elapsed < RELOAD_RETRY_AFTER_MS;
  } catch {
    return false;
  }
}

function rememberReloadFor(version: string) {
  try {
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, JSON.stringify({ version, at: Date.now() }));
  } catch {
    // Storage unavailable: no guard, as before.
  }
}

function getVersionUrl() {
  return new URL('version.json', window.location.href).toString();
}

function getReloadUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set('_v', Date.now().toString());
  return url.toString();
}

async function fetchVersion(signal: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(getVersionUrl(), {
      cache: 'no-store',
      signal,
      headers: {
        'cache-control': 'no-cache, no-store, max-age=0',
        pragma: 'no-cache',
      },
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { version?: string };
    const version = typeof data.version === 'string' ? data.version.trim() : '';
    return version || null;
  } catch {
    return null;
  }
}

async function checkForUpdate() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), VERSION_REQUEST_TIMEOUT_MS);

  try {
    const latestVersion = await fetchVersion(controller.signal);
    if (latestVersion && latestVersion !== __APP_BUILD_VERSION__ && !reloadedRecentlyFor(latestVersion)) {
      rememberReloadFor(latestVersion);
      window.location.replace(getReloadUrl());
    }
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function startUpdateCheck() {
  if (typeof window === 'undefined' || import.meta.env.DEV) return;

  const run = () => {
    void checkForUpdate();
  };

  run();
  window.setInterval(run, VERSION_POLL_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      run();
    }
  });
}
