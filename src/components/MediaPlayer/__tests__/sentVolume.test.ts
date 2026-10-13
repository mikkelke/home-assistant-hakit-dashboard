import { describe, expect, it } from 'vitest';
import { isUnsettled, runningVolume, sendVolume, type SentVolume } from '../sentVolume';

/** One group-step tap on a speaker HA reports at `live`, the way the card's group step does it. */
const tap = (sent: SentVolume | undefined, live: number, step: number): SentVolume =>
  sendVolume(sent, live, Math.max(0, Math.min(100, runningVolume(sent, live) + step)));

describe('sent volume', () => {
  it('steps from the live level when nothing was sent', () => {
    expect(runningVolume(undefined, 40)).toBe(40);
    expect(tap(undefined, 40, 3).value).toBe(43);
  });

  it('lets rapid taps add up before and while HA reports back', () => {
    const first = tap(undefined, 20, 3);
    const second = tap(first, 20, 3);
    const third = tap(second, 23, 3);
    expect([first.value, second.value, third.value]).toEqual([23, 26, 29]);
  });

  it('steps from where something else moved the speaker', () => {
    const sent = tap(undefined, 20, 3);
    expect(isUnsettled(sent, 40)).toBe(false);
    expect(runningVolume(sent, 40)).toBe(40);
    expect(tap(sent, 40, -3).value).toBe(37);
  });

  it('lets go once HA reports the sent level', () => {
    const sent = tap(undefined, 20, 3);
    expect(isUnsettled(sent, 23)).toBe(false);
    expect(runningVolume(sent, 23)).toBe(23);
  });

  it("takes Music Assistant's truncated report of the sent level as settled", () => {
    const sent = tap(undefined, 26, 3);
    expect(sent.value).toBe(29);
    expect(isUnsettled(sent, 28)).toBe(false);
    expect(runningVolume(sent, 28)).toBe(28);
  });

  it('does not lose a step when a truncated echo arrives mid-burst', () => {
    const second = tap(tap(undefined, 26, 3), 26, 3);
    expect(second.value).toBe(32);
    expect(runningVolume(second, 28)).toBe(32);
    expect(tap(second, 28, 3).value).toBe(35);
  });

  it('clamps at 0 and 100', () => {
    expect(tap(undefined, 99, 3).value).toBe(100);
    expect(tap(undefined, 1, -3).value).toBe(0);
  });
});
