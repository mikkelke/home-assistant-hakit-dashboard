import archiver from 'archiver';
import { createWriteStream, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const OUT_DIR = ROOT;

// Exclusions aligned with .gitignore: no node_modules, dist, env secrets, or generated files.
// We always include .gitignore and .env.example so the archive is self-contained and repo-safe.
const IGNORE_PATTERNS = [
  'node_modules',
  'dist',
  'dist-ssr',
  '.tsbuildinfo',
  'home-assistant-hakit-dashboard@',
  '.cursor',
  '.vscode',
  '.idea',
  '.DS_Store',
  '.suo',
  '.ntvs',
  '.njsproj',
  '.sln',
  'logs',
  'npm-debug',
  'yarn-debug',
  'yarn-error',
  'pnpm-debug',
  'lerna-debug',
  'coverage',
  '*.lcov',
  '*.local',
  'ha-dashboard-backup-',
  'supported-types.d.ts',
];

function shouldIgnore(relativePath: string, isDirectory: boolean): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  // Always include these so the archive matches repo hygiene and README instructions.
  if (normalized === '.gitignore' || normalized.endsWith('/.gitignore')) return false;
  if (normalized === '.env.example' || normalized.endsWith('/.env.example')) return false;
  // Exclude .git directory but not files like .gitignore.
  if (isDirectory && (normalized === '.git' || normalized.endsWith('/.git'))) return true;
  // Exclude secret/env files but not .env.example.
  if (normalized === '.env' || normalized.endsWith('/.env')) return true;
  if (normalized.includes('.env.local') || normalized.includes('.env.development') || normalized.includes('.env.production')) return true;
  if (normalized.includes('.env.') && !normalized.endsWith('.env.example')) return true;
  if (normalized === 'supported-types.d.ts' || normalized.endsWith('/supported-types.d.ts')) return true;
  return IGNORE_PATTERNS.some(
    p => normalized.includes(p) || normalized.split('/').some(seg => seg === p || seg.endsWith('.log') || seg.endsWith('.lcov'))
  );
}

function* walk(dir: string, base = ''): Generator<{ full: string; rel: string }> {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const rel = base ? `${base}/${e.name}` : e.name;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (shouldIgnore(rel, true)) continue;
      yield* walk(full, rel);
    } else {
      if (shouldIgnore(rel, false)) continue;
      yield { full, rel };
    }
  }
}

const date = new Date().toISOString().slice(0, 10);
const outPath = join(OUT_DIR, `home-assistant-hakit-dashboard-backup-${date}.zip`);
const output = createWriteStream(outPath);
const archive = archiver('zip', { zlib: { level: 6 } });

archive.pipe(output);

for (const { full, rel } of walk(ROOT)) {
  archive.file(full, { name: rel });
}

await archive.finalize();
await new Promise<void>((resolve, reject) => {
  output.on('close', () => resolve());
  archive.on('error', reject);
});

console.log(`Created ${outPath}`);
