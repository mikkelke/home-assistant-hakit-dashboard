import { describe, expect, it } from 'vitest';
import { latestRound } from '../rober2Run';

const at = (hhmm: string, day = 25) => Date.UTC(2026, 10, day, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3)));

describe('latestRound', () => {
  it('takes the last round in order, with both kitchen sides as one kitchen', () => {
    const rows = [
      { state: '17', atMs: at('09:15', 23) },
      { state: '', atMs: at('09:20', 23) },
      { state: '17', atMs: at('08:23') },
      { state: '', atMs: at('08:27') },
      { state: '22', atMs: at('08:27') },
      { state: '25', atMs: at('08:33') },
      { state: '', atMs: at('08:33') },
      { state: '25', atMs: at('08:37') },
      { state: '', atMs: at('09:05') },
      { state: '18', atMs: at('09:05') },
      { state: '', atMs: at('09:20') },
      { state: '21', atMs: at('09:20') },
      { state: '', atMs: at('09:34') },
    ];
    const round = latestRound(rows);
    expect(round.map(room => room.areaId)).toEqual(['hallway', 'kitchen', 'living_room', 'dining_room']);
    expect(round[1].startMs).toBe(at('08:27'));
    expect(round[1].endMs).toBe(at('09:05'));
    expect(round.at(-1)?.endMs).toBe(at('09:34'));
  });

  it('keeps the room it is in open', () => {
    const round = latestRound([
      { state: '17', atMs: at('08:00') },
      { state: '', atMs: at('08:05') },
      { state: '20', atMs: at('08:05') },
    ]);
    expect(round.map(room => room.areaId)).toEqual(['hallway', 'bedroom']);
    expect(round[1].endMs).toBeNull();
  });

  it('is empty without segments', () => {
    expect(latestRound([{ state: '', atMs: at('08:00') }])).toEqual([]);
  });
});
