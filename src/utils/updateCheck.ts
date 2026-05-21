declare const __APP_BUILD_VERSION__: string;

const VERSION_POLL_INTERVAL_MS = 60_000;
const VERSION_REQUEST_TIMEOUT_MS = 8_000;

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
    if (latestVersion && latestVersion !== __APP_BUILD_VERSION__) {
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
