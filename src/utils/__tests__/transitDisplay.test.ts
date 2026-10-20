import { describe, expect, it } from 'vitest';
import { TRANSIT_LINES } from '../../config/transit';
import { formatTravelTime, transitBadgeLabel } from '../transitDisplay';

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

describe('transitBadgeLabel', () => {
  const departure = { line: 'C', category: 'ICL' };

  it('names the line on a line badge', () => {
    expect(transitBadgeLabel('line', departure)).toBe('C');
  });

  it('names the train category on a category badge', () => {
    expect(transitBadgeLabel('category', departure)).toBe('ICL');
  });

  it('is empty on a route without a badge, or when the departure lacks the field', () => {
    expect(transitBadgeLabel(undefined, departure)).toBe('');
    expect(transitBadgeLabel('category', { line: 'IC 125' })).toBe('');
  });

  it('follows the configured routes: S-tog by line, Odense by category, Metro none', () => {
    const badgeOf = (name: string) => TRANSIT_LINES.find(line => line.name === name)?.badge;
    expect(badgeOf('S-tog')).toBe('line');
    expect(badgeOf('ECE/IC/ICL/Re')).toBe('category');
    expect(badgeOf('Metro M3')).toBeUndefined();
  });
});
