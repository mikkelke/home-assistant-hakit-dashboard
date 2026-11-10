/** The `sensor.home_delivery` feed (AppDaemon HomeDelivery): what is on its way to the flat, what the chip on Home says
 * about it and what the sheet lists. Pure. */
import { formatHomeClock, homeDayStartMs, homeWallTime } from '../energy/homeTime';
import { canViewerSeeDelivery, type DeliveryKind } from './audience';

export type { DeliveryKind } from './audience';

export type DeliveryStage = 'preparing' | 'on_the_way' | 'arriving';

export interface Delivery {
  id: string;
  /** `wolt`, `nemlig`, or the carrier's slug for a parcel. */
  source: string;
  kind: DeliveryKind;
  /** The venue, the shop, or a parcel's sender (else its carrier). */
  title: string;
  stage: DeliveryStage;
  etaMs: number | null;
  windowStartMs: number | null;
  windowEndMs: number | null;
  itemCount: number | null;
}

/** A parcel the carrier has on its way that is not due today. */
export interface UpcomingParcel {
  id: string;
  /** The carrier's slug. */
  source: string;
  title: string;
  /** The Parcel Aggregator's status word, `unknown` when it gave none. */
  status: string;
  plannedFromMs: number | null;
  plannedToMs: number | null;
}

export interface DeliveryFeed {
  /** Preparing, on the way or arriving, in the order the sensor publishes them. */
  active: Delivery[];
  /** Soonest planned first, then as the sensor gives them. */
  upcoming: UpcomingParcel[];
}

export const NO_DELIVERIES: DeliveryFeed = { active: [], upcoming: [] };

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const KINDS: ReadonlySet<string> = new Set<DeliveryKind>(['food', 'groceries', 'parcel']);
const STAGES: ReadonlySet<string> = new Set<DeliveryStage>(['preparing', 'on_the_way', 'arriving']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A time ETA this many minutes away or more reads as a clock time: minutes left only help near the door. */
const MINUTES_UNTIL_CLOCK = 60;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function timeMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

const KIND_WORD: Record<DeliveryKind, string> = { food: 'Food', groceries: 'Groceries', parcel: 'Parcel' };

/** Defensive parse of the sensor. AppDaemon leaves out any key whose value is null, false or 0, so every field but the
 * identity ones may be missing, and an unusable entry is dropped, never a reason to lose the rest. Ended and cancelled
 * deliveries are not on the way and are left out. */
export function parseDeliveryFeed(entity: { state?: unknown; attributes?: unknown } | null | undefined): DeliveryFeed {
  if (!entity || entity.state === 'unavailable' || entity.state === 'unknown') return NO_DELIVERIES;
  const attributes = record(entity.attributes);
  if (!attributes) return NO_DELIVERIES;

  const active: Delivery[] = [];
  const seenActive = new Set<string>();
  for (const raw of Array.isArray(attributes.deliveries) ? attributes.deliveries : []) {
    const item = record(raw);
    if (!item) continue;
    const id = text(item.id);
    if (!id || seenActive.has(id) || !KINDS.has(String(item.kind)) || !STAGES.has(String(item.stage))) continue;
    seenActive.add(id);
    const kind = item.kind as DeliveryKind;
    const itemCount =
      typeof item.item_count === 'number' && Number.isInteger(item.item_count) && item.item_count > 0 ? item.item_count : null;
    active.push({
      id,
      source: text(item.source),
      kind,
      title: text(item.title) || KIND_WORD[kind],
      stage: item.stage as DeliveryStage,
      etaMs: timeMs(item.eta),
      windowStartMs: timeMs(item.window_start),
      windowEndMs: timeMs(item.window_end),
      itemCount,
    });
  }

  const upcoming: UpcomingParcel[] = [];
  const seenUpcoming = new Set<string>();
  for (const raw of Array.isArray(attributes.upcoming) ? attributes.upcoming : []) {
    const item = record(raw);
    if (!item) continue;
    const id = text(item.id);
    if (!id || seenUpcoming.has(id)) continue;
    seenUpcoming.add(id);
    upcoming.push({
      id,
      source: text(item.source),
      title: text(item.title) || 'Parcel',
      status: text(item.status) || 'unknown',
      plannedFromMs: timeMs(item.planned_from),
      plannedToMs: timeMs(item.planned_to),
    });
  }
  return active.length === 0 && upcoming.length === 0 ? NO_DELIVERIES : { active, upcoming };
}

/** What `viewer` may see of the feed: each kind goes by its own audience, and the upcoming parcels by the parcel's. */
export function visibleDeliveries(feed: DeliveryFeed, viewer: { name: string | null }): DeliveryFeed {
  const active = feed.active.filter(delivery => canViewerSeeDelivery(delivery.kind, viewer));
  const upcoming = canViewerSeeDelivery('parcel', viewer) ? feed.upcoming : [];
  return active.length === 0 && upcoming.length === 0 ? NO_DELIVERIES : { active, upcoming };
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** "17–19" for a window on the hours, "17:30–19:00" otherwise, in home time. */
export function windowText(startMs: number, endMs: number): string {
  const start = homeWallTime(startMs);
  const end = homeWallTime(endMs);
  return start.minute || end.minute ? `${formatHomeClock(startMs)}–${formatHomeClock(endMs)}` : `${pad(start.hour)}–${pad(end.hour)}`;
}

export interface Timing {
  headline: string;
  /** The ETA's clock time beside the minutes left; null when the headline is the time itself. */
  clock: string | null;
}

/** How soon a delivery comes: the minutes left with the clock time beside them, the clock time alone from an hour out, or its
 * window. "Now" once the ETA of a courier that is out has passed; null when there is no time to give, or when a kitchen has
 * outrun its ETA. */
export function timing(delivery: Delivery, nowMs: number): Timing | null {
  if (delivery.etaMs != null) {
    const minutes = Math.ceil((delivery.etaMs - nowMs) / MINUTE_MS);
    if (minutes >= MINUTES_UNTIL_CLOCK) return { headline: formatHomeClock(delivery.etaMs), clock: null };
    if (minutes > 0) return { headline: `${minutes} min`, clock: formatHomeClock(delivery.etaMs) };
    if (delivery.stage !== 'preparing') return { headline: 'Now', clock: null };
  }
  if (delivery.windowStartMs != null && delivery.windowEndMs != null) {
    return { headline: windowText(delivery.windowStartMs, delivery.windowEndMs), clock: null };
  }
  return null;
}

export function deliveryIcon(delivery: Pick<Delivery, 'kind' | 'stage'>): string {
  if (delivery.kind === 'parcel') return 'mdi:package-variant-closed';
  const waiting = delivery.stage === 'preparing';
  if (delivery.kind === 'groceries') return waiting ? 'mdi:cart' : 'mdi:truck-delivery';
  return waiting ? 'mdi:chef-hat' : 'mdi:moped';
}

/** The word a chip falls back on when it has no time to show. */
function shortStage(delivery: Delivery): string {
  if (delivery.stage === 'arriving') return 'Arriving';
  if (delivery.stage === 'on_the_way') return 'On the way';
  return delivery.kind === 'food' ? 'Preparing' : 'Today';
}

/** The stage in plain words, for a delivery that has no stage rail. */
export function stageWord(delivery: Pick<Delivery, 'kind' | 'stage'>): string {
  if (delivery.stage === 'arriving') return 'Arriving';
  if (delivery.kind === 'parcel') return delivery.stage === 'on_the_way' ? 'Out for delivery' : 'Expected today';
  if (delivery.stage === 'on_the_way') return 'On the way';
  return delivery.kind === 'food' ? 'Preparing' : 'Booked for today';
}

export interface ChipView {
  /** `live`: on the way; `now`: arriving; `quiet`: only parcels days away, no countdown. */
  tone: 'live' | 'now' | 'quiet';
  icon: string;
  headline: string;
  clock: string | null;
  /** Further deliveries on the way beside the one the chip shows. */
  more: number;
  label: string;
}

/** The one chip for the Home ticker: the first delivery on the way, else a quiet count of the parcels still to come; null
 * when there is nothing. */
export function chipView(feed: DeliveryFeed, nowMs: number): ChipView | null {
  const [lead] = feed.active;
  if (lead) {
    const when = timing(lead, nowMs);
    const headline = when?.headline ?? shortStage(lead);
    const clock = when?.clock ?? null;
    const more = feed.active.length - 1;
    return {
      tone: lead.stage === 'arriving' ? 'now' : 'live',
      icon: deliveryIcon(lead),
      headline,
      clock,
      more,
      label: `${KIND_WORD[lead.kind]}, ${lead.title}, ${headline}${clock ? `, about ${clock}` : ''}${more > 0 ? `, and ${more} more` : ''}`,
    };
  }
  const count = feed.upcoming.length;
  if (count === 0) return null;
  return {
    tone: 'quiet',
    icon: 'mdi:package-variant-closed',
    headline: String(count),
    clock: null,
    more: 0,
    label: count === 1 ? '1 parcel on its way' : `${count} parcels on their way`,
  };
}

export type StepState = 'done' | 'now' | 'todo';

export interface RailStep {
  key: 'ordered' | 'kitchen' | 'way' | 'door';
  label: string;
  icon: string;
  state: StepState;
}

const RAIL: ReadonlyArray<Omit<RailStep, 'state'>> = [
  { key: 'ordered', label: 'Ordered', icon: 'mdi:check' },
  { key: 'kitchen', label: 'Kitchen', icon: 'mdi:chef-hat' },
  { key: 'way', label: 'On the way', icon: 'mdi:moped' },
  { key: 'door', label: 'At the door', icon: 'mdi:door' },
];

/** The four steps of a food order. The sensor does not say when the courier is at the door, so that step is never reached. */
export function railSteps(stage: DeliveryStage): RailStep[] {
  const current = stage === 'preparing' ? 1 : 2;
  return RAIL.map((step, index) => ({ ...step, state: index < current ? 'done' : index === current ? 'now' : 'todo' }));
}

export const itemsText = (count: number): string => (count === 1 ? '1 item' : `${count} items`);

const CARRIERS: ReadonlyMap<string, string> = new Map([
  ['gls', 'GLS'],
  ['postnord', 'PostNord'],
  ['airmee', 'Airmee'],
]);

/** A carrier's slug as its name: "GLS", "PostNord", and for a carrier not known here its words, short ones in capitals. */
export function carrierName(source: string): string {
  const known = CARRIERS.get(source);
  if (known) return known;
  return source
    .split('_')
    .filter(Boolean)
    .map(word => (word.length <= 3 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)))
    .join(' ');
}

const STATUS_WORDS: ReadonlyMap<string, string> = new Map([
  ['registered', 'Not sent yet'],
  ['in_transit', 'On the way'],
  ['out_for_delivery', 'Out for delivery'],
  ['at_pickup_point', 'At the pickup point'],
  ['returning', 'Going back to sender'],
  ['problem', 'Problem'],
]);

export const parcelStatusWord = (status: string): string => STATUS_WORDS.get(status) ?? 'Status unknown';

function weekday(ms: number): string {
  const { year, month, day } = homeWallTime(ms);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

/** The day a parcel is planned for relative to `nowMs`, in home time: "Today", "Tomorrow", a weekday within the week, else
 * the weekday and date. */
function dayText(ms: number, nowMs: number): string {
  const days = Math.round((homeDayStartMs(ms) - homeDayStartMs(nowMs)) / DAY_MS);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1 && days < 7) return weekday(ms);
  const { day, month } = homeWallTime(ms);
  return `${weekday(ms)} ${day} ${MONTHS[month - 1]}`;
}

/** When a parcel is planned: "Thu 14–18" for a window, "Thu 14:00" for one time; null when the carrier gives none. */
export function plannedText(fromMs: number | null, toMs: number | null, nowMs: number): string | null {
  const start = fromMs ?? toMs;
  if (start == null) return null;
  const when = fromMs != null && toMs != null && fromMs < toMs ? windowText(fromMs, toMs) : formatHomeClock(start);
  return `${dayText(start, nowMs)} ${when}`;
}

export interface UpcomingView {
  id: string;
  icon: string;
  /** A problem or a return wants a look; the rest is just on its way. */
  attention: boolean;
  title: string;
  /** The carrier and the status, or the status alone when the carrier is the title. */
  sub: string;
  planned: string | null;
}

const STATUS_ICONS: ReadonlyMap<string, string> = new Map([
  ['at_pickup_point', 'mdi:storefront-outline'],
  ['returning', 'mdi:keyboard-return'],
  ['problem', 'mdi:alert-circle-outline'],
]);

export function upcomingView(parcel: UpcomingParcel, nowMs: number): UpcomingView {
  const carrier = carrierName(parcel.source);
  const status = parcelStatusWord(parcel.status);
  return {
    id: parcel.id,
    icon: STATUS_ICONS.get(parcel.status) ?? 'mdi:package-variant-closed',
    attention: parcel.status === 'problem' || parcel.status === 'returning',
    title: parcel.title,
    sub: !carrier || parcel.title.toLowerCase() === carrier.toLowerCase() ? status : `${carrier} · ${status}`,
    planned: plannedText(parcel.plannedFromMs, parcel.plannedToMs, nowMs),
  };
}
