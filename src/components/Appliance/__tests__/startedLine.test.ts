import { describe, expect, it } from 'vitest';
import { startedLine } from '../applianceFormat';

describe('startedLine', () => {
  it('names a reliably attributed resident with the start time', () => {
    expect(startedLine({ started_by: 'claudia', started_by_method: 'sole_occupant' }, '15:10', true)).toBe('Started by Claudia · 15:10');
  });

  it('leaves the time out when the card has none', () => {
    expect(startedLine({ started_by: 'mikkel', started_by_method: 'dashboard_action' }, '--:--', false)).toBe('Started by Mikkel');
  });

  it('shows no name for an unreliable method or an unknown key', () => {
    expect(startedLine({ started_by: 'mikkel', started_by_method: 'unknown' }, '15:10', true)).toBe('Started 15:10');
    expect(startedLine({ started_by: 'guest', started_by_method: 'sole_occupant' }, '15:10', true)).toBe('Started 15:10');
  });

  it('is empty with neither a name nor a time', () => {
    expect(startedLine({}, '--:--', false)).toBeNull();
  });
});
