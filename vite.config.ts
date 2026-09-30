import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';

import dotenv from 'dotenv';
// `.env` holds the committed defaults; `.env.development.local` (gitignored) holds the local
// box URL used as the dev proxy target. Vite already loads both for `import.meta.env.VITE_*`,
// but this config reads `process.env` directly for the proxy, so it needs them here too.
dotenv.config({ path: ['.env.development.local', '.env'] });

const VITE_FOLDER_NAME = process.env.VITE_FOLDER_NAME;
const HA_TARGET = process.env.VITE_HA_URL || 'http://localhost:8123';

const getBuildVersion = () => {
  const fromEnv = process.env.VITE_BUILD_VERSION?.trim();
  if (fromEnv) return fromEnv;

  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return `${Date.now()}`;
  }
};

const buildVersion = getBuildVersion();

/**
 * `@hakit/core` ships the whole Home Assistant translation set — 68 locales, 200–400 KB each — behind a
 * dynamic-import map in `hooks/useLocale/locales/index.js`, so a plain build emits ~18 MB of locale chunks
 * we never serve. `HassConnect` picks one via `config.language` (the HA *server* language, not the per-user
 * frontend preference) and this install reports `en`.
 *
 * This rewrites every entry in that map to point at the English module instead of deleting entries: the
 * locale list itself is static data that `FetchLocale` looks the code up in, and a missing map entry makes
 * `fetch()` reject, which leaves the app rendered but with every hakit string falling back to its raw key.
 * Aliasing keeps any locale code resolvable, just always to English.
 *
 * Throws rather than silently no-opping if a `@hakit/core` upgrade changes the map's shape — a loud build
 * failure is the only signal that the 18 MB is back.
 */
function hakitEnglishLocalesOnly(): Plugin {
  const localeModule = '@hakit/core/dist/es/hooks/useLocale/locales/index.js';
  // Matches the map's `import("./da/da.js")` entries; the backreference keeps it to <code>/<code>.js pairs.
  const localeImport = /import\("\.\/([\w-]+)\/\1\.js"\)/g;

  return {
    name: 'hakit-english-locales-only',
    apply: 'build',
    transform(code, id) {
      if (!id.split('\\').join('/').endsWith(localeModule)) return null;

      let replaced = 0;
      const next = code.replace(localeImport, () => {
        replaced += 1;
        return 'import("./en/en.js")';
      });
      if (replaced === 0) {
        throw new Error(
          `hakit-english-locales-only: found no locale imports in ${localeModule}. @hakit/core probably changed its locale loader — update the plugin or drop it (the build will grow by ~18 MB).`
        );
      }
      return { code: next, map: null };
    },
  };
}

/**
 * `@hakit/core` keeps every entity in one store and, on each incoming WebSocket frame, decides which entities
 * "changed" with `JSON.stringify(previous) === JSON.stringify(next)` (timestamps and context excluded) for ALL of
 * them — thousands of stringify pairs per frame, several frames a second, for as long as a dashboard is open.
 * `home-assistant-js-websocket` hands back the SAME object for every entity that did not change, so an identity
 * check answers nearly all of those comparisons in O(1); only the few entities that actually changed pay for the
 * stringify. The result is identical — same reference always means equal.
 *
 * The library is bundled into hashed chunks, so the function is found by its shape rather than by file name.
 * Throws if no module matched: a `@hakit/core` upgrade that reshapes the store must fail the build loudly, not
 * quietly bring back the per-frame cost.
 */
function hakitEntityEqualityFastPath(): Plugin {
  const corePath = '/@hakit/core/dist/';
  // (a, b) => { const { last_changed, last_updated, context, ...x } = a, {...} = b; return JSON.stringify(x) === JSON.stringify(y); }
  const equality =
    /(\(\s*(\w+)\s*,\s*(\w+)\s*\)\s*=>\s*\{)(\s*const\s*\{\s*last_changed\s*:\s*\w+\s*,\s*last_updated\s*:\s*\w+\s*,\s*context\s*:\s*\w+\s*,\s*\.\.\.\w+\s*\}\s*=\s*\2\s*,[^;]*;\s*return\s+JSON\.stringify\(\w+\)\s*===\s*JSON\.stringify\(\w+\)\s*;?\s*\})/;
  let patched = 0;

  return {
    name: 'hakit-entity-equality-fast-path',
    apply: 'build',
    transform(code, id) {
      if (!id.split('\\').join('/').includes(corePath) || !code.includes('last_changed')) return null;
      const next = code.replace(
        equality,
        (_match, head: string, a: string, b: string, body: string) => `${head} if (${a} === ${b}) return true;${body}`
      );
      if (next === code) return null;
      patched += 1;
      return { code: next, map: null };
    },
    buildEnd(error) {
      if (!error && patched === 0) {
        this.error(
          'hakit-entity-equality-fast-path: found no entity-equality function in @hakit/core. It probably changed its store — update the plugin or drop it (the dashboard will spend a large share of idle CPU on per-frame JSON.stringify comparisons).'
        );
      }
    },
  };
}

if (typeof VITE_FOLDER_NAME === 'undefined' || VITE_FOLDER_NAME === '') {
  console.error(
    'VITE_FOLDER_NAME environment variable is not set, update your .env file with a value naming your dashboard, eg "VITE_FOLDER_NAME=home-assistant-hakit-dashboard"'
  );
  process.exit(1);
}

// https://vite.dev/config/
export default defineConfig({
  base: `/local/${VITE_FOLDER_NAME}/`,
  plugins: [hakitEnglishLocalesOnly(), hakitEntityEqualityFastPath(), react()],
  define: {
    __APP_BUILD_VERSION__: JSON.stringify(buildVersion),
  },
  build: {
    assetsInlineLimit: 4096,
  },
  server: {
    proxy: {
      // REST + WebSocket: dev talks to localhost, Vite forwards to real HA (set VITE_HA_URL in .env.development.local)
      '/api': {
        target: HA_TARGET,
        changeOrigin: true,
        secure: false,
        ws: true,
      },
      '/api/websocket': {
        target: HA_TARGET,
        changeOrigin: true,
        secure: false,
        ws: true,
      },
      '/auth': {
        target: HA_TARGET,
        changeOrigin: true,
        secure: false,
      },
      '/local/rober2_maps': {
        target: HA_TARGET,
        changeOrigin: true,
        secure: false,
      },
      '/local/abb_doorbell': {
        target: HA_TARGET,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
