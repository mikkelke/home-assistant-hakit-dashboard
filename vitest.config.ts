import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // A device zone with different DST dates than the house, so nothing silently relies on it.
    env: { TZ: 'America/Los_Angeles' },
  },
});
