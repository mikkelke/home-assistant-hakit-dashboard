import { DAY_MS } from './weighings';

export const PAD_L = 6;
export const PAD_R = 34;
export const PAD_T = 8;
export const PAD_B = 22;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const clock = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function niceStep(span: number): number {
  for (const step of [0.2, 0.5, 1, 2, 5, 10]) if (span / step <= 4) return step;
  return 20;
}

export function yScale(values: number[]): { lo: number; hi: number; ticks: number[] } {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (!Number.isFinite(lo)) return { lo: 0, hi: 1, ticks: [] };
  const pad = Math.max(0.3, (hi - lo) * 0.12);
  lo -= pad;
  hi += pad;
  const step = niceStep(hi - lo);
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(Math.round(t * 10) / 10);
  return { lo, hi, ticks };
}

/** Month starts for spans up to about a year and a quarter, year starts beyond; at most six. */
export function xTicks([from, to]: [number, number]): { ts: number; label: string }[] {
  const out: { ts: number; label: string }[] = [];
  const span = to - from;
  if (span <= 45 * DAY_MS) {
    const d = new Date(from);
    d.setHours(0, 0, 0, 0);
    while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
    for (; d.getTime() <= to; d.setDate(d.getDate() + 7)) out.push({ ts: d.getTime(), label: `${d.getDate()} ${MONTHS[d.getMonth()]}` });
    return out;
  }
  if (span <= 460 * DAY_MS) {
    const d = new Date(from);
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    const months: Date[] = [];
    for (; d.getTime() <= to; d.setMonth(d.getMonth() + 1)) months.push(new Date(d));
    const every = Math.ceil(months.length / 6);
    return months
      .filter((_, i) => (months.length - 1 - i) % every === 0)
      .map(m => ({ ts: m.getTime(), label: m.getMonth() === 0 ? String(m.getFullYear()) : MONTHS[m.getMonth()] }));
  }
  const years: number[] = [];
  for (let y = new Date(from).getFullYear() + 1; new Date(y, 0, 1).getTime() <= to; y++) years.push(y);
  const every = Math.ceil(years.length / 6);
  return years
    .filter((_, i) => (years.length - 1 - i) % every === 0)
    .map(y => ({ ts: new Date(y, 0, 1).getTime(), label: `’${String(y).slice(2)}` }));
}

/** The selected reading's left edge in percent of the chart width, for the readout above it. */
export function selectedLeftPct(ts: number, [from, to]: [number, number], width: number): number {
  return ((PAD_L + ((ts - from) / Math.max(1, to - from)) * (width - PAD_L - PAD_R)) / width) * 100;
}

/** Today and yesterday by name, the past week by weekday, older by date. */
export function whenLabel(ts: number, nowMs: number): string {
  const d = new Date(ts);
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((today.getTime() - new Date(d).setHours(0, 0, 0, 0)) / DAY_MS);
  if (days <= 0) return `Today ${clock(d)}`;
  if (days === 1) return `Yesterday ${clock(d)}`;
  if (days < 7) return `${WEEKDAYS[d.getDay()]} ${clock(d)}`;
  const sameYear = d.getFullYear() === today.getFullYear();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? '' : ` ${d.getFullYear()}`}`;
}
