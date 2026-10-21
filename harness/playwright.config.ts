import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { ORIGIN, PORT } from './session';

const root = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  outputDir: '.results',
  fullyParallel: true,
  workers: 4,
  retries: 2,
  reporter: 'list',
  timeout: 45_000,
  use: {
    baseURL: ORIGIN,
    locale: 'en-GB',
    timezoneId: 'Europe/Copenhagen',
    colorScheme: 'dark',
  },
  projects: [
    {
      name: 'phone',
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent: devices['iPhone 14'].userAgent,
      },
    },
    {
      name: 'tablet',
      use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: `npx vite build --outDir harness/.build --emptyOutDir && npx vite preview --outDir harness/.build --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: root,
    url: `${ORIGIN}/local/ha-dashboard/`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      VITE_FOLDER_NAME: 'ha-dashboard',
      VITE_BUILD_VERSION: 'harness',
      VITE_HA_URL: '',
      VITE_HA_TOKEN: '',
      VITE_DISHWASHER_FEEDBACK_URL: `${ORIGIN}/feedback/dishwasher.json`,
      VITE_WASHER_FEEDBACK_URL: `${ORIGIN}/feedback/washer.json`,
      VITE_DRYER_FEEDBACK_URL: `${ORIGIN}/feedback/dryer.json`,
    },
  },
});
