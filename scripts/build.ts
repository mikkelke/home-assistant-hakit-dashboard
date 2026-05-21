import { execSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

function getGitSha() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'build';
  }
}

function getBuildVersion() {
  const fromEnv = process.env.VITE_BUILD_VERSION?.trim();
  if (fromEnv) return fromEnv;

  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `${getGitSha()}-${stamp}`;
}

const env = {
  ...process.env,
  VITE_BUILD_VERSION: getBuildVersion(),
};

execSync('tsc -b', { stdio: 'inherit', env });
execSync('vite build', { stdio: 'inherit', env });
execSync('npx tsx scripts/write-version.ts', { stdio: 'inherit', env });
