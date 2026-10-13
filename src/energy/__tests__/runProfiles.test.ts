import { describe, expect, it } from 'vitest';
import { energyBetweenWh, parseRunProfiles, type RunProfiles } from '../runProfiles';
import entity from './fixtures/run-profiles.json';
import published from './fixtures/run-profiles-published.json';

function programmeAttrs(overrides: Record<string, unknown> = {}) {
  return {
    schema: 1,
    appliances: {
      washer: { programmes: [{ key: 'x', label: 'X', n: '7', energy_min: '5', completion_min: '9', p: '0,0,100,0,200', ...overrides }] },
    },
  };
}

function parsed(attrs: unknown): RunProfiles {
  const result = parseRunProfiles(attrs);
  if (!result.ok) throw new Error(result.error);
  return result.profiles;
}

describe('parseRunProfiles', () => {
  it('parses the published fixture', () => {
    const { appliances } = parsed(entity.attributes);
    const washer = appliances.washer[0];
    expect(washer.key).toBe('bomuld|60');
    expect(washer.energyMin).toBe(188);
    expect(washer.kwh).toBeCloseTo(1.1, 2);
    expect(washer.completionMin).toBe(190);
    expect(washer.labelConfirmed).toBe(true);
    expect(washer.cumWh).toHaveLength(189);
    expect(appliances.dryer[0].labelConfirmed).toBe(false);
  });

  it('keeps leading, interior and trailing zeros', () => {
    const p = parsed(programmeAttrs()).appliances.washer[0];
    expect(Array.from(p.whPerMin)).toEqual([0, 0, 10, 0, 20]);
    expect(Array.from(p.cumWh)).toEqual([0, 0, 0, 10, 10, 30]);

    const dishwasher = parsed(entity.attributes).appliances.dishwasher[0];
    expect(dishwasher.energyMin).toBe(115);
    expect(Array.from(dishwasher.whPerMin.slice(-5))).toEqual([0, 0, 0, 0, 0]);
    expect(Array.from(dishwasher.whPerMin).filter(v => v === 0)).toHaveLength(11);
  });

  it('accepts numeric fields as numbers and reads a missing label source as inferred', () => {
    const p = parsed(programmeAttrs({ n: 7, energy_min: 5, completion_min: 9, label_source: undefined })).appliances.washer[0];
    expect(p.n).toBe(7);
    expect(p.labelConfirmed).toBe(false);
  });

  it('parses a payload as the AppDaemon publisher writes it', () => {
    const { appliances } = parsed(published);
    expect(Object.keys(appliances)).toEqual(['washer', 'dishwasher', 'dryer']);
    const dishwasher = appliances.dishwasher[0];
    expect(dishwasher.key).toBe('typical');
    expect(dishwasher.energyMin).toBe(101);
    expect(dishwasher.completionMin).toBe(250);
    expect(dishwasher.labelConfirmed).toBe(false);
    expect(appliances.dryer[0].completionMin).toBe(appliances.dryer[0].energyMin);
  });

  it('accepts a mixed label source as not confirmed', () => {
    expect(parsed(programmeAttrs({ label_source: 'mixed' })).appliances.washer[0].labelConfirmed).toBe(false);
    expect(parsed(programmeAttrs({ label_source: 'confirmed' })).appliances.washer[0].labelConfirmed).toBe(true);
  });

  it('reads a missing done_min as the energy profile length', () => {
    const p = parsed(programmeAttrs({ completion_min: undefined, run_min: undefined, energy_min: undefined })).appliances.washer[0];
    expect(p.energyMin).toBe(5);
    expect(p.completionMin).toBe(5);
    expect(parsed(programmeAttrs({ completion_min: undefined, done_min: '12' })).appliances.washer[0].completionMin).toBe(12);
  });

  it('never lets completion end before the energy profile', () => {
    expect(parsed(programmeAttrs({ completion_min: '3' })).appliances.washer[0].completionMin).toBe(5);
  });

  it.each([
    ['numeric array profile (zeros already lost)', { p: [100, 200], energy_min: '2' }],
    ['negative value', { p: '1,-1,2', energy_min: '3' }],
    ['decimal value', { p: '1,1.5', energy_min: '2' }],
    ['empty profile', { p: '', energy_min: undefined }],
    ['longer than 720 minutes', { p: Array(721).fill('1').join(','), energy_min: '721' }],
    ['energy_min mismatch', { energy_min: '6' }],
    ['n of zero', { n: '0' }],
    ['unknown label source', { label_source: 'maybe' }],
    ['missing label', { label: '' }],
  ])('rejects %s', (_name, overrides) => {
    expect(parseRunProfiles(programmeAttrs(overrides)).ok).toBe(false);
  });

  it('accepts exactly 720 minutes', () => {
    expect(parseRunProfiles(programmeAttrs({ p: Array(720).fill('1').join(','), energy_min: '720' })).ok).toBe(true);
  });

  it('rejects malformed payloads', () => {
    expect(parseRunProfiles(undefined).ok).toBe(false);
    expect(parseRunProfiles({ schema: 2, appliances: {} }).ok).toBe(false);
    expect(parseRunProfiles({ schema: 1 }).ok).toBe(false);
    expect(parseRunProfiles({ schema: 1, appliances: { washer: { programmes: 'x' } } }).ok).toBe(false);
    const dup = programmeAttrs();
    dup.appliances.washer.programmes.push({ ...dup.appliances.washer.programmes[0] });
    expect(parseRunProfiles(dup).ok).toBe(false);
  });
});

describe('energyBetweenWh', () => {
  const p = parsed(programmeAttrs()).appliances.washer[0];

  it('interpolates fractional minutes and clamps to the profile', () => {
    expect(energyBetweenWh(p, 2.5, 3)).toBeCloseTo(5);
    expect(energyBetweenWh(p, -10, 100)).toBeCloseTo(30);
    expect(energyBetweenWh(p, 3, 4)).toBe(0);
  });
});
