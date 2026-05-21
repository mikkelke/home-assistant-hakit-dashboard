import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';

import dotenv from 'dotenv';
dotenv.config();

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

if (typeof VITE_FOLDER_NAME === 'undefined' || VITE_FOLDER_NAME === '') {
  console.error(
    'VITE_FOLDER_NAME environment variable is not set, update your .env file with a value naming your dashboard, eg "VITE_FOLDER_NAME=home-assistant-hakit-dashboard"'
  );
  process.exit(1);
}

// https://vite.dev/config/
export default defineConfig({
  base: `/local/${VITE_FOLDER_NAME}/`,
  plugins: [react()],
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
      '/local/robot_maps': {
        target: HA_TARGET,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
