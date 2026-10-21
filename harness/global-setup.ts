import { mkdirSync, rmSync } from 'node:fs';
import { OUT } from './shots';

/** Starts every run from an empty output folder, so what is there is what this run drew. */
export default function globalSetup(): void {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
}
