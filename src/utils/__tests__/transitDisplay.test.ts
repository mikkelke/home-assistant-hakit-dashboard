import { describe, expect, it } from 'vitest';
import { formatTravelTime } from '../transitDisplay';

describe('formatTravelTime', () => {
  it('shows bare minutes under an hour', () => {
    expect(formatTravelTime(55)).toBe('55m');
    expect(formatTravelTime(59)).toBe('59m');
  });

  it('shows hours and two-digit minutes from an hour up', () => {
    expect(formatTravelTime(60)).toBe('1h00');
    expect(formatTravelTime(71)).toBe('1h11');
    expect(formatTravelTime(125)).toBe('2h05');
  });
});
