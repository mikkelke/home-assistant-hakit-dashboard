import { execSync } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

function getBuildVersion() {
  const fromEnv = process.env.VITE_BUILD_VERSION?.trim();
  if (fromEnv) return fromEnv;

  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return `${Date.now()}`;
  }
}

async function main() {
  const version = getBuildVersion();
  const outputDir = join(process.cwd(), 'dist');
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'version.json'), JSON.stringify({ version }, null, 2) + '\n', 'utf8');
}

await main();
