import { describe, expect, it } from 'vitest';
import {
  buildNowHash,
  getViewFromHistoryHash,
  NOW_FOCUS_KINDS,
  nowFocusAt,
  parseDashboardHash,
  parseNowFocus,
  type NowFocus,
} from '../navigation';

const windowWithHash = (hash: string) => ({ location: { pathname: '/dashboard-rooftop/home', search: '', hash } }) as unknown as Window;

describe('#now link grammar', () => {
  it('parses plain #now and every focus kind', () => {
    expect(parseDashboardHash('#now')).toEqual({ kind: 'now', focus: null });
    for (const kind of NOW_FOCUS_KINDS) {
      expect(parseDashboardHash(`#now=${kind}-1791881730`)).toEqual({ kind: 'now', focus: { kind, epochS: 1791881730 } });
    }
  });

  it('opens plain #now for a malformed focus', () => {
    for (const hash of [
      '#now=',
      '#now=washer',
      '#now=washer-',
      '#now=washer-abc',
      '#now=WASHER-1791881730',
      '#now=plug-1791881730',
      '#now=washer-0',
      '#now=washer-1791881730.5',
      '#now=washer--1791881730',
      '#now=washer-123456789012',
      '#now=washer-1791881730x',
      '#now&sheet=1',
    ]) {
      expect(parseDashboardHash(hash)).toEqual({ kind: 'now', focus: null });
    }
  });

  it('ignores parameters after the focus', () => {
    expect(parseNowFocus('#now=ring-1791886561&sheet=1')).toEqual({ kind: 'ring', epochS: 1791886561 });
  });

  it('leaves the room and energy grammar as it was', () => {
    expect(parseDashboardHash('#room=kitchen')).toEqual({ kind: 'room', roomId: 'kitchen', openClimate: false });
    expect(parseDashboardHash('#room=office&climate=1')).toEqual({ kind: 'room', roomId: 'office', openClimate: true });
    expect(parseDashboardHash('#energy')).toEqual({ kind: 'energy' });
    expect(parseDashboardHash('#energy=plan')).toEqual({ kind: 'energy' });
    for (const hash of ['', '#', '#nowhere', '#later']) expect(parseDashboardHash(hash)).toEqual({ kind: 'none' });
  });

  it('round-trips every valid focus and builds plain #now otherwise', () => {
    for (const kind of NOW_FOCUS_KINDS) {
      const focus = { kind, epochS: 1791881730 };
      expect(buildNowHash(focus)).toBe(`#now=${kind}-1791881730`);
      expect(parseNowFocus(buildNowHash(focus))).toEqual(focus);
    }
    expect(buildNowHash()).toBe('#now');
    expect(buildNowHash(null)).toBe('#now');
    for (const epochS of [0, -5, 1.5, Number.NaN]) expect(buildNowHash({ kind: 'washer', epochS })).toBe('#now');
    expect(buildNowHash({ kind: 'sheet', epochS: 1791881730 } as unknown as NowFocus)).toBe('#now');
  });

  it('rounds an event time down to whole seconds', () => {
    expect(nowFocusAt('evt', Date.parse('2026-10-13T08:55:30.638Z'))).toEqual({ kind: 'evt', epochS: 1791881730 });
  });

  it('reads #now as no view in the hash the grid routes on', () => {
    expect(getViewFromHistoryHash(windowWithHash('#now=washer-1791881730'))).toEqual({ kind: 'none' });
    expect(getViewFromHistoryHash(windowWithHash('#room=bedroom'))).toEqual({ kind: 'room', roomId: 'bedroom', openClimate: false });
    expect(getViewFromHistoryHash(windowWithHash('#energy=bill'))).toEqual({ kind: 'energy' });
    expect(getViewFromHistoryHash(null)).toEqual({ kind: 'none' });
  });
});
