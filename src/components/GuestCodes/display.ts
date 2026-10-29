import type { GuestUser } from './types';

const TIME_ZONE = 'Europe/Copenhagen';
const inputFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function parts(date: Date) {
  return Object.fromEntries(inputFormat.formatToParts(date).map(part => [part.type, part.value]));
}

export function toCopenhagenInput(value: string | Date): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const p = parts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Offset-free native picker values always refer to Copenhagen, including on phones in another timezone.
 * The repeated autumn hour is rejected rather than silently choosing one of two different instants. */
export function fromCopenhagenInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const nominal = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(nominal)) return null;
  const candidates = [60, 120].map(offset => new Date(nominal - offset * 60_000)).filter(date => toCopenhagenInput(date) === value);
  return candidates.length === 1 ? candidates[0].toISOString() : null;
}

export function defaultPeriod(now = new Date()): { from: string; to: string } {
  return { from: toCopenhagenInput(now), to: toCopenhagenInput(new Date(now.getTime() + 86_400_000)) };
}

function dateLabel(value: string, withTime: boolean): string {
  const input = toCopenhagenInput(value);
  if (!input) return 'Unknown';
  const [date, time] = input.split('T');
  const [, month, day] = date.split('-');
  return `${day}.${month}${withTime ? ` ${time}` : ''}`;
}

export function formatValidity(user: Pick<GuestUser, 'kind' | 'from' | 'to'>): string {
  if (user.kind === 'always') return 'Always';
  if (user.kind === 'recurring') return 'Recurring';
  return user.from && user.to ? `${dateLabel(user.from, true)}–${dateLabel(user.to, true)}` : 'Period unavailable';
}

export function formatLastUse(last_use: string | null): string {
  return last_use ? `used ${dateLabel(last_use, false)}` : 'never used';
}
