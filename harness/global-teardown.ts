import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { OUT } from './shots';

/** A screenshot this small is a blank page or a login screen, never a drawn view. */
const BLANK_BYTES = 10_000;

/** Lists what the run drew, and fails it if any picture looks empty. */
export default function globalTeardown(): void {
  const blank: string[] = [];
  for (const viewport of readdirSync(OUT)) {
    const folder = join(OUT, viewport);
    if (!statSync(folder).isDirectory()) continue;
    const pictures = readdirSync(folder).filter(name => name.endsWith('.png'));
    for (const name of pictures) if (statSync(join(folder, name)).size < BLANK_BYTES) blank.push(`${viewport}/${name}`);
    console.log(`${pictures.length} screenshots in harness/out/${viewport}`);
  }
  if (blank.length > 0) throw new Error(`Screenshots under ${BLANK_BYTES} bytes, probably blank:\n${blank.join('\n')}`);
}
