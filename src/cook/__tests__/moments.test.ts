import { describe, expect, it } from 'vitest';
import { cookMoments, cookProgress, nextCookMoment } from '../moments';
import { parseCookState } from '../model';

const NOW = Date.parse('2026-11-08T18:00:00+01:00');
const iso = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();
const state = (attributes: Record<string, unknown>) => parseCookState({ state: 'both', attributes });

describe('the next cooking moment', () => {
  it('keeps the published lane priority and time, with missing ETAs as null', () => {
    const cook = state({
      bath_phase: 'cooking',
      bath_done_at: iso(60),
      probe_phase: 'tracking',
      probe_eta: iso(10),
      next_kind: 'bath_done',
      next_at: iso(55),
    });
    expect(nextCookMoment(cook, NOW)).toMatchObject({ kind: 'bath_done', label: 'Done', atMs: Date.parse(iso(55)), approximate: false });
    expect(nextCookMoment(state({ probe_phase: 'tracking' }), NOW)).toMatchObject({ kind: 'pull', atMs: null, approximate: true });
  });

  it('does not turn near, stale, or expired predictions into Pull now', () => {
    expect(nextCookMoment(state({ probe_phase: 'near', probe_eta: iso(3) }), NOW)).toMatchObject({
      label: 'Pull',
      urgent: false,
      atMs: Date.parse(iso(3)),
    });
    expect(
      nextCookMoment(
        state({ probe_phase: 'tracking', probe_eta: iso(3), probe_stale_since: iso(-0.5), next_kind: 'pull', next_at: iso(3) }),
        NOW
      )?.atMs
    ).toBeNull();
    expect(
      nextCookMoment(state({ probe_phase: 'tracking', probe_eta: iso(-1), next_kind: 'pull', next_at: iso(-1) }), NOW)?.atMs
    ).toBeNull();
    expect(nextCookMoment(state({ probe_phase: 'pull' }), NOW)).toMatchObject({ label: 'Pull now', urgent: true });
  });

  it('shows low water before either lane and a lost probe before a future bath', () => {
    expect(nextCookMoment(state({ bath_phase: 'cooking', bath_low_water: '1', probe_phase: 'pull' }), NOW)).toMatchObject({
      kind: 'low_water',
      alarm: true,
    });
    expect(nextCookMoment(state({ bath_phase: 'cooking', probe_phase: 'tracking', probe_stale_since: iso(-2) }), NOW)).toMatchObject({
      kind: 'lost',
      alarm: true,
      atMs: Date.parse(iso(-2)),
    });
  });

  it('never calls an interrupted bath done and does not suggest an automatic chill', () => {
    const cook = state({ bath_phase: 'interrupted', bath_stopped_at: iso(-4), bath_done_at: iso(25) });
    expect(nextCookMoment(cook, NOW)).toMatchObject({ label: 'Stopped', alarm: true, atMs: Date.parse(iso(-4)) });
    expect(cookMoments(cook, NOW)).toHaveLength(1);
    expect(cookMoments(cook, NOW)[0].label).toBe('Stopped');
  });

  it('combines future moments from both lanes in time order', () => {
    const cook = state({
      bath_phase: 'cooking',
      bath_ready_at: iso(-80),
      bath_in_at: iso(-60),
      bath_done_at: iso(45),
      probe_phase: 'tracking',
      probe_eta: iso(10),
    });
    expect(
      cookMoments(cook, NOW)
        .filter(item => item.status !== 'done')
        .map(item => item.kind)
    ).toEqual(['pull', 'bath_done', 'carve']);
    expect(cookMoments(null, NOW)).toEqual([]);
  });

  it('orders factual past moments before future moments, including during an alarm', () => {
    const rail = cookMoments(
      state({
        bath_phase: 'cooking',
        bath_ready_at: iso(-140),
        bath_in_at: iso(-125),
        bath_done_at: iso(25),
        bath_low_water: '1',
        probe_phase: 'tracking',
        probe_eta: iso(10),
      }),
      NOW
    );
    expect(rail.map(item => item.kind)).toEqual(['bath_ready', 'bag_in', 'low_water', 'pull', 'bath_done', 'carve']);
    expect(rail.slice(0, 2)).toMatchObject([
      { status: 'done', atMs: Date.parse(iso(-140)), approximate: false },
      { status: 'done', atMs: Date.parse(iso(-125)), approximate: false },
    ]);
  });

  it.each([null, iso(8)])('drops a missing or future Ready after bag in (%s)', readyAt => {
    const rail = cookMoments(state({ bath_phase: 'cooking', bath_ready_at: readyAt, bath_in_at: iso(-5), bath_done_at: iso(145) }), NOW);
    expect(rail.some(item => item.kind === 'bath_ready')).toBe(false);
    expect(rail[0]).toMatchObject({ kind: 'bag_in', status: 'done', atMs: Date.parse(iso(-5)), approximate: false });
  });

  it('forecasts Ready only while heating and makes it factual once ready', () => {
    expect(cookMoments(state({ bath_phase: 'heating', bath_ready_at: iso(8) }), NOW)[0]).toMatchObject({
      kind: 'bath_ready',
      status: 'current',
      approximate: true,
      atMs: Date.parse(iso(8)),
    });
    expect(cookMoments(state({ bath_phase: 'ready', bath_ready_at: iso(-1) }), NOW)[0]).toMatchObject({
      kind: 'bath_ready',
      status: 'done',
      approximate: false,
      atMs: Date.parse(iso(-1)),
    });
  });

  it.each(['off', 'heating', 'too_hot', 'ready', 'cooking', 'done', 'interrupted'])('does not offer Fridge in %s', phase => {
    expect(
      cookMoments(state({ bath_phase: phase, bath_chill_until: iso(9), probe_phase: 'tracking' }), NOW).some(
        item => item.kind === 'chill_done'
      )
    ).toBe(false);
  });

  it.each(['chilling', 'chilled'])('offers Fridge only after chilling starts (%s)', phase => {
    expect(
      cookMoments(state({ bath_phase: phase, bath_chill_until: iso(phase === 'chilled' ? -1 : 9) }), NOW).find(
        item => item.kind === 'chill_done'
      )
    ).toMatchObject({ status: 'current', approximate: false });
  });

  it.each([
    [{ probe_phase: 'pull' }, 'pull'],
    [{ probe_phase: 'carve' }, 'carve'],
    [{ bath_phase: 'ready' }, 'bag_in'],
    [{ bath_phase: 'chilled' }, 'chill_done'],
  ] as const)('marks the hands-on rail step urgent for %o', (attributes, kind) => {
    const rail = cookMoments(state(attributes), NOW);
    expect(rail.find(item => item.kind === kind && item.status === 'current')).toMatchObject({ urgent: true, approximate: false });
  });

  it('keeps the near estimate and completed bath clocks factual in the rail', () => {
    const near = cookMoments(state({ probe_phase: 'near', probe_eta: iso(3) }), NOW).find(item => item.kind === 'pull');
    expect(near).toMatchObject({ urgent: false, approximate: true, atMs: Date.parse(iso(3)) });
    const done = cookMoments(state({ bath_phase: 'done', bath_done_at: iso(-2) }), NOW).find(item => item.kind === 'bath_done');
    expect(done).toMatchObject({ label: 'Done', urgent: false, atMs: Date.parse(iso(-2)) });
    const stopped = cookMoments(state({ bath_phase: 'interrupted', bath_stopped_at: iso(-4) }), NOW)[0];
    expect(stopped).toMatchObject({ label: 'Stopped', urgent: true, atMs: Date.parse(iso(-4)) });
  });

  it('measures clock progress from bag in or pull and bounds it', () => {
    const cook = state({ bath_phase: 'cooking', bath_in_at: iso(-60), bath_done_at: iso(60) });
    expect(cookProgress(cook, null, NOW)).toBe(0.5);
    expect(cookProgress(cook, null, NOW + 200 * 60_000)).toBe(1);
    expect(cookProgress(state({ probe_phase: 'tracking' }), null, NOW)).toBeNull();
    expect(cookProgress(state({ probe_phase: 'pull' }), null, NOW)).toBe(1);
  });
});
