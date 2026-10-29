import { describe, expect, it } from 'vitest';
import { defaultPeriod, formatLastUse, formatValidity, fromCopenhagenInput, toCopenhagenInput } from '../display';
import type { GuestUser } from '../types';

const row = (patch: Partial<GuestUser> = {}): GuestUser => ({
  user_id: 'synthetic-guest',
  name: 'Test guest',
  slot: null,
  kind: 'always',
  from: null,
  to: null,
  status: 'active',
  last_use: null,
  created_by: null,
  ...patch,
});

describe('Copenhagen validity', () => {
  it('formats always, recurring and last use without using the device zone', () => {
    expect(formatValidity(row())).toBe('Always');
    expect(formatValidity(row({ kind: 'recurring' }))).toBe('Recurring');
    expect(formatLastUse(null)).toBe('never used');
    expect(formatLastUse('2026-10-11T23:30:00Z')).toBe('used 12.10');
  });

  it('formats both sides of the spring DST transition in house time', () => {
    expect(formatValidity(row({ kind: 'temporary', from: '2026-03-29T00:30:00Z', to: '2026-03-29T01:30:00Z' }))).toBe(
      '29.03 01:30–29.03 03:30'
    );
  });

  it('formats both sides of the autumn DST transition in house time', () => {
    expect(formatValidity(row({ kind: 'temporary', from: '2026-10-25T00:30:00Z', to: '2026-10-25T02:30:00Z' }))).toBe(
      '25.10 02:30–25.10 03:30'
    );
  });

  it('converts winter and summer picker values using their own offset', () => {
    expect(fromCopenhagenInput('2026-01-15T12:15')).toBe('2026-01-15T11:15:00.000Z');
    expect(fromCopenhagenInput('2026-07-15T12:15')).toBe('2026-07-15T10:15:00.000Z');
    expect(toCopenhagenInput('2026-01-15T11:15:00Z')).toBe('2026-01-15T12:15');
    expect(toCopenhagenInput(new Date('2026-07-15T10:15:00Z'))).toBe('2026-07-15T12:15');
  });

  it('rejects nonexistent, ambiguous and invalid local times', () => {
    for (const value of ['2026-03-29T02:30', '2026-10-25T02:30', '2026-02-30T12:00', 'not a date', '']) {
      expect(fromCopenhagenInput(value)).toBeNull();
    }
  });

  it('defaults the period from now to one day later', () => {
    const period = defaultPeriod(new Date('2026-07-15T10:15:00Z'));
    expect(period).toEqual({ from: '2026-07-15T12:15', to: '2026-07-16T12:15' });
  });
});
