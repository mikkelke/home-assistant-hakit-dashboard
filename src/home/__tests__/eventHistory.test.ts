import { describe, expect, it, vi } from 'vitest';
import type { Connection } from 'home-assistant-js-websocket';
import { fetchEventHistory, pieces, toPoints } from '../eventHistory';

describe('eventHistory', () => {
  it('splits a window into pieces under a day', () => {
    const h = 3_600_000;
    expect(pieces(0, 48 * h)).toEqual([
      { startMs: 0, endMs: 23 * h },
      { startMs: 23 * h, endMs: 46 * h },
      { startMs: 46 * h, endMs: 48 * h },
    ]);
  });

  it('reads both the full and the minimal entry shapes', () => {
    expect(
      toPoints([
        { state: 'on', last_updated: '2026-11-20T06:00:00Z' },
        { s: 'off', lu: 1_763_618_500 },
      ])
    ).toEqual([
      { ts: Date.parse('2026-11-20T06:00:00Z'), state: 'on' },
      { ts: 1_763_618_500_000, state: 'off' },
    ]);
  });

  it('merges the pieces per entity in time order, drops the repeated boundary state and keeps a failed read out of the cache', async () => {
    const h = 3_600_000;
    const send = vi
      .fn()
      .mockResolvedValueOnce({ 'sensor.a': [{ s: '1', lu: 0 }] })
      .mockResolvedValueOnce({
        'sensor.a': [
          { s: '1', lu: 0 },
          { s: '2', lu: (30 * h) / 1000 },
        ],
      });
    const conn = { sendMessagePromise: send } as unknown as Connection;
    const history = await fetchEventHistory(conn, ['sensor.a'], 0, 40 * h);
    expect(history['sensor.a']).toEqual([
      { ts: 0, state: '1' },
      { ts: 30 * h, state: '2' },
    ]);
    const failing = { sendMessagePromise: vi.fn().mockRejectedValue(new Error('down')) } as unknown as Connection;
    await expect(fetchEventHistory(failing, ['sensor.b'], 0, h)).rejects.toThrow('down');
    const working = { sendMessagePromise: vi.fn().mockResolvedValue({ 'sensor.b': [{ s: 'x', lu: 1 }] }) } as unknown as Connection;
    expect((await fetchEventHistory(working, ['sensor.b'], 0, h))['sensor.b']).toHaveLength(1);
  });
});
