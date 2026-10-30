import { describe, expect, it } from 'vitest';
import { stateSinceIso } from '../stateSince';

describe('stateSinceIso', () => {
  it('prefers the published entry time over a restart-reset last_changed', () => {
    const entity = { attributes: { state_since: '2026-10-30T05:09:56Z' }, last_changed: '2026-10-30T06:05:16Z' };
    expect(stateSinceIso(entity)).toBe('2026-10-30T05:09:56Z');
  });

  it('falls back to last_changed when the attribute is missing or empty', () => {
    expect(stateSinceIso({ attributes: {}, last_changed: '2026-10-30T06:05:16Z' })).toBe('2026-10-30T06:05:16Z');
    expect(stateSinceIso({ attributes: { state_since: '' }, last_changed: 'x' })).toBe('x');
    expect(stateSinceIso(undefined)).toBeUndefined();
  });
});
