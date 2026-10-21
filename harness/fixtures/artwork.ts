import type { HouseBuilder } from './builder';

function hue(text: string): number {
  let total = 0;
  for (const char of text) total = (total * 31 + char.charCodeAt(0)) % 360;
  return total;
}

const art = (seed: string, width: number, height: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue(seed)} 40% 34%)"/><stop offset="1" stop-color="hsl(${hue(seed)} 45% 14%)"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/></svg>`;

/** Posters and cover art come from other hosts; here they are plain gradients, one hue per image. */
export function addArtwork(h: HouseBuilder): void {
  h.rest.push({ match: /image\.tmdb\.org\/t\/p\//, respond: path => ({ contentType: 'image/svg+xml', body: art(path, 342, 513) }) });
  h.rest.push({ match: /ma\.me2go\.dk\/imageproxy\//, respond: path => ({ contentType: 'image/svg+xml', body: art(path, 256, 256) }) });
}
