import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KNOWN_TYPES } from '../../../sensorMap/mapDoc';
import { GLYPHS, glyphOf, typeClass } from '../glyphs';

const css = readFileSync(new URL('../SensorMap.css', import.meta.url), 'utf8');
const colours = (key: string) => [...css.matchAll(new RegExp(`--t-${key}:\\s*(#\\w+)`, 'g'))].map(match => match[1]);

describe('the known device types', () => {
  it.each(KNOWN_TYPES.map(type => type.key))('%s has a glyph, a colour class and a colour in the dark and the light theme', key => {
    expect(GLYPHS[key]).toBeTruthy();
    expect(typeClass(key)).toBe(`t-${key}`);
    expect(css).toMatch(new RegExp(`\\.t-${key}\\s*\\{\\s*--tc:\\s*var\\(--t-${key}\\)`));
    expect(colours(key)).toHaveLength(2);
  });

  it('gives every type its own glyph and its own colour in each theme', () => {
    expect(new Set(KNOWN_TYPES.map(type => GLYPHS[type.key])).size).toBe(KNOWN_TYPES.length);
    for (const theme of [0, 1]) {
      expect(new Set(KNOWN_TYPES.map(type => colours(type.key)[theme])).size).toBe(KNOWN_TYPES.length);
    }
  });

  it('draws a type with no glyph of its own as "other"', () => {
    expect(glyphOf('camera')).toBe(GLYPHS.other);
    expect(typeClass('camera')).toBe('t-other');
  });
});
