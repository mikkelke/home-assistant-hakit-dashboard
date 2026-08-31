import { execFileSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';
import chalk from 'chalk';
import prompts from 'prompts';
// intentionally only loading the main .env so we're not using the token at all here.
dotenv.config();

// NOT used to build the deploy target - VITE_HA_URL is a client-bundled var read by App.tsx.
// Leaving it unset in .env is deliberate: production then falls back to window.location.origin,
// so the same build works whether it's reached via LAN IP or a public/proxied hostname. Filling
// it in here to get a nicer preview link would bake a single hardcoded host into every client and
// break every other way of reaching the dashboard - this caused a real incident, don't do it.
const HA_URL = process.env.VITE_HA_URL;
const HA_TOKEN = process.env.VITE_HA_TOKEN;
const USERNAME = process.env.VITE_SSH_USERNAME;
const HOST = process.env.VITE_SSH_HOSTNAME;
const FOLDER_NAME = process.env.VITE_FOLDER_NAME;
const LOCAL_DIRECTORY = './dist';
const LOCAL_ASSETS_DIRECTORY = join(LOCAL_DIRECTORY, 'assets');
const STATE_FILE = './.deploy-state.json';
// Common HA config roots (host and container paths) - host-mapped path first for Docker installs.
const CANDIDATE_ROOTS = ['data/homeassistant', 'config', 'homeassistant'];

async function confirmDeploymentWithHaToken() {
  if (!HA_TOKEN) return;
  const response = (await prompts({
    type: 'confirm',
    name: 'value',
    message: chalk.yellow(`
WARN: You are about to deploy to Home Assistant with VITE_HA_TOKEN set in .env.

READ MORE - https://shannonhochkins.github.io/ha-component-kit/?path=/docs/introduction-deploying--docs#important;

Would you like to continue?`),
    initial: true,
  })) as { value: boolean };
  if (response.value !== true) process.exit();
}

function ssh(remoteCommand: string): string {
  return execFileSync('ssh', [`${USERNAME}@${HOST}`, remoteCommand], { stdio: ['ignore', 'pipe', 'inherit'] })
    .toString()
    .trim();
}

function findRemoteRoot(): string {
  for (const root of CANDIDATE_ROOTS) {
    const exists = ssh(`[ -d /${root} ] && echo yes || echo no`);
    if (exists === 'yes') return `/${root}/www/${FOLDER_NAME}`;
  }
  throw new Error('Could not find a config/homeassistant directory on the remote host.');
}

function readPrevAssetFiles(): string[] {
  if (!existsSync(STATE_FILE)) return [];
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as { assetFiles?: string[] };
    return Array.isArray(parsed.assetFiles) ? parsed.assetFiles : [];
  } catch {
    return [];
  }
}

async function deploy() {
  if (!FOLDER_NAME) throw new Error('Missing VITE_FOLDER_NAME in .env file');
  if (!USERNAME) throw new Error('Missing VITE_SSH_USERNAME in .env file');
  if (!HOST) throw new Error('Missing VITE_SSH_HOSTNAME in .env file');
  if (!existsSync(LOCAL_DIRECTORY)) {
    throw new Error('Missing ./dist directory, have you run `npm run build`?');
  }

  const currentAssetFiles = readdirSync(LOCAL_ASSETS_DIRECTORY);
  if (currentAssetFiles.length === 0) {
    throw new Error('dist/assets is empty - refusing to deploy (build looks broken).');
  }

  const remoteRoot = findRemoteRoot();
  const remoteAssets = `${remoteRoot}/assets`;
  const prevAssetFiles = readPrevAssetFiles();
  // Keep this deploy's assets plus the immediately preceding deploy's, so a device with a
  // cached index.html from just before this deploy (HA serves /local with a 31-day
  // Cache-Control) can still resolve the content-hashed JS/CSS it references. Deliberately an
  // exact filename allowlist, not an rsync --delete or an mtime cutoff: rsync skips re-uploading
  // files whose content is unchanged, so their remote mtime never advances - a time-based cutoff
  // ends up deleting still-live, still-referenced assets the moment they go stale by clock time
  // rather than by generation. This survived a real incident during development; don't revert to
  // a time-based scheme without re-testing it end to end.
  const keep = new Set([...currentAssetFiles, ...prevAssetFiles]);

  console.info(chalk.blue('Uploading', `"${LOCAL_DIRECTORY}"`, 'to', `"${USERNAME}@${HOST}:${remoteRoot}"`));
  ssh(`mkdir -p ${remoteAssets}`);
  execFileSync('rsync', ['-a', `${LOCAL_DIRECTORY}/`, `${USERNAME}@${HOST}:${remoteRoot}/`], { stdio: 'inherit' });

  const remoteAssetFiles = ssh(`ls -1 ${remoteAssets}`)
    .split('\n')
    .map(f => f.trim())
    .filter(Boolean);
  const toDelete = remoteAssetFiles.filter(f => !keep.has(f));

  if (toDelete.length > 0) {
    const remotePaths = toDelete.map(f => `${remoteAssets}/${f}`).join(' ');
    ssh(`rm -f -- ${remotePaths}`);
    console.info(chalk.gray(`Pruned assets from 2+ deploys ago (${toDelete.length}):\n${toDelete.join('\n')}`));
  }

  writeFileSync(STATE_FILE, JSON.stringify({ assetFiles: currentAssetFiles }, null, 2) + '\n');

  console.info(chalk.green('\nSuccessfully deployed!'));
  if (HA_URL) {
    const url = `${HA_URL.replace(/\/$/, '')}/local/${FOLDER_NAME}/index.html`;
    console.info(chalk.blue(`\n\nVISIT the following URL to preview your dashboard:\n`));
    console.info(chalk.bgCyan(chalk.underline(url)));
  } else {
    console.info(chalk.blue(`\nVisit /local/${FOLDER_NAME}/index.html on your Home Assistant host to preview.`));
  }
}

await confirmDeploymentWithHaToken();
try {
  await deploy();
} catch (e: unknown) {
  console.error(chalk.red('Error:', e instanceof Error ? e.message : 'unknown error'));
  process.exit(1);
}
