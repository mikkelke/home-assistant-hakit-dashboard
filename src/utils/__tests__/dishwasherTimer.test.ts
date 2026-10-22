import { describe, expect, it } from 'vitest';
import type { HassEntity } from '../../types';
import { dishwasherTimerSince } from '../dishwasherSemanticState';

const timer = (state: string, attributes: Record<string, unknown> = {}) =>
  ({ entity_id: 'binary_sensor.dishwasher_timer', state, attributes }) as unknown as HassEntity;

describe('dishwasherTimerSince', () => {
  it('gives when the timer was set while the dishwasher is Off', () => {
    expect(dishwasherTimerSince(timer('on', { since: '2026-10-21T19:47:04Z' }), 'Off')).toBe('2026-10-21T19:47:04Z');
  });

  it('is set with an unknown time when the entity carries none', () => {
    expect(dishwasherTimerSince(timer('on'), 'Off')).toBe('');
  });

  it('is no timer when the entity is off or missing', () => {
    expect(dishwasherTimerSince(timer('off', { since: '2026-10-21T19:47:04Z' }), 'Off')).toBeNull();
    expect(dishwasherTimerSince(undefined, 'Off')).toBeNull();
  });

  it('is no timer once the dishwasher has left Off', () => {
    for (const state of ['Running', 'Paused', 'Unemptied', 'Emptied'] as const) {
      expect(dishwasherTimerSince(timer('on', { since: '2026-10-21T19:47:04Z' }), state)).toBeNull();
    }
  });
});
