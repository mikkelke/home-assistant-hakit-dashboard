/** The rooms of Rober2's latest round, in the order it cleaned them, from the history of the segment it was sent to. */
import { roberSegmentAreaId } from '../components/Vacuum/rooms';

export interface SegmentRow {
  state: string;
  atMs: number;
}

export interface RunRoom {
  areaId: string;
  startMs: number;
  /** When the robot left the room; null while it is still there. */
  endMs: number | null;
}

/** Two segments belong to one round when the next starts within this long of the last one ending. */
export const ROUND_GAP_MS = 20 * 60_000;

/** The rooms of the latest round in `rows` (oldest first): consecutive segments in one HA area count once, so both
 * kitchen sides are one kitchen. */
export function latestRound(rows: readonly SegmentRow[]): RunRoom[] {
  const passes: RunRoom[] = [];
  for (const row of rows) {
    const open = passes.at(-1);
    if (open && open.endMs === null) open.endMs = row.atMs;
    const areaId = roberSegmentAreaId(row.state);
    if (areaId) passes.push({ areaId, startMs: row.atMs, endMs: null });
  }
  const round: RunRoom[] = [];
  for (let i = passes.length - 1; i >= 0; i--) {
    const pass = passes[i];
    const next = round[0];
    if (next && pass.endMs !== null && next.startMs - pass.endMs > ROUND_GAP_MS) break;
    if (next && next.areaId === pass.areaId) {
      round[0] = { ...next, startMs: pass.startMs };
      continue;
    }
    round.unshift({ ...pass });
  }
  return round;
}
