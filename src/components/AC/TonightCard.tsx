import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import { attrNum, attrStr, attrStringArray } from '../../types';
import {
  AC_ROOM_TEMP_SENSOR,
  AC_VENT_WINDOW_SENSOR,
  SMART_COOLING_STATUS_SENSOR,
  SMART_COOLING_ENABLE,
  SMART_COOLING_AC_REMOVED,
  SMART_COOLING_NIGHT_CEILING,
  BEDROOM_NIGHT_PROJECTION_SENSOR,
  SLEEP_PLAN_SENSOR,
  isAcDeployed,
} from '../../config/entities';
import { useLocalStorageBoolean, useTouchScrollSlopGuard } from '../../hooks';
import './TonightCard.css';

// Apple-style "Tonight" card - replaces the old manual AC control surface (AcCard + the
// CoolingModule fold-out that hosted it). The only real control left is arming SmartCooling;
// everything else here is read-only. Every number rendered comes from the backend
// (sleep_plan / smart_cooling_status / bedroom_night_projection) - this component lays those
// numbers out, it never computes them (house rule: presentation delivers, never recomputes).

interface TonightCardProps {
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

type ViewState = 'windows' | 'setup_ac' | 'ready' | 'holding' | 'cooling' | 'paused';
type ButtonKind = 'cool_tonight' | 'going_to_bed' | 'nothing_to_do' | 'none';

const BAR_START_HOUR = 10;
const WINDOWS_CUTOFF_HOUR = 22;
const BEDTIME_HOUR = 23;
const BAR_END_PADDING_MS = 60 * 60 * 1000; // ~1h past wake, per design

/** States where the compressor is genuinely doing something (a dry-run/off/idle isn't "cooling"). */
const ACTIVE_COOLING_STATES = new Set(['cooling', 'burping']);
/** Wider "something is running that needs the bathroom window open" set for the vent-safety check. */
const VENTING_STATES = new Set(['cooling', 'burping', 'drying']);
const SESSION_LIVE_STATES = new Set(['cooling', 'drying', 'burping', 'waiting']);

/** One view-state for the whole card - the only place that turns (deployed, armed, tonight's
 * recommendation, live status, vent-alert) into "what is this card telling the housemate right
 * now". Pure: no Date reads, no side effects. */
function deriveViewState(args: { deployed: boolean; armed: boolean; rec: string; statusState: string; ventAlert: boolean }): ViewState {
  const { deployed, armed, rec, statusState, ventAlert } = args;
  if (ventAlert) return 'paused';
  if (!deployed) return rec === 'ac' || rec === 'hybrid' ? 'setup_ac' : 'windows';
  if (!armed) return 'ready';
  if (ACTIVE_COOLING_STATES.has(statusState)) return 'cooling';
  return 'holding';
}

/** The card's whole control surface - at most one button/row, decided the same way every render. */
function deriveButtonKind(args: { deployed: boolean; armed: boolean; rec: string; hour: number }): ButtonKind {
  const { deployed, armed, rec, hour } = args;
  if (deployed && !armed && (rec === 'ac' || rec === 'hybrid')) return 'cool_tonight';
  if (armed && hour >= 21) return 'going_to_bed';
  if (armed) return 'nothing_to_do';
  return 'none';
}

/** Right-aligned top-row word. `setup_ac` has none of these fit it - the verdict sentence carries
 * that state instead (see the render body's sentence-area branch). */
const STATE_WORD: Record<ViewState, string | null> = {
  cooling: 'Cooling',
  windows: 'Windows',
  ready: 'Plugged in',
  holding: 'Holding',
  paused: 'Paused',
  setup_ac: null,
};
/** States where nothing is actually running - the word reads muted grey rather than the tint. */
const MUTED_STATES = new Set<ViewState>(['ready', 'holding']);

const GLYPH_ICON: Record<ViewState, string> = {
  cooling: 'mdi:snowflake',
  windows: 'mdi:white-balance-sunny',
  ready: 'mdi:weather-night',
  holding: 'mdi:weather-night',
  paused: 'mdi:weather-night',
  setup_ac: 'mdi:weather-night',
};

/** ISO datetime or a bare "HH:MM"/"HH:MM:SS" -> a real Date. Bare clock times earlier than
 * `notBeforeMs` are assumed to land the next calendar day (wake_at/next_start only ever name an
 * evening-or-later moment, never "earlier today"). */
function parseTimeAttr(raw: unknown, notBeforeMs: number): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const iso = new Date(s);
  if (!Number.isNaN(iso.getTime())) return iso;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const d = new Date(notBeforeMs);
  d.setHours(Number(m[1]), Number(m[2]), Number(m[3] ?? '0'), 0);
  if (d.getTime() < notBeforeMs) d.setDate(d.getDate() + 1);
  return d;
}

/** `base`'s calendar day at a fixed local hour (used for the bar's fixed reference points: 10:00
 * start, 22:00 windows cutoff, 23:00 bedtime). */
function atHour(base: Date, hour: number): Date {
  const d = new Date(base);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function formatHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Clamp any timestamp to a 0-100% position within [startMs, endMs] - segments/ticks/the now-line
 * all go through this so nothing can ever overflow the track. */
function pctOf(ms: number, startMs: number, endMs: number): number {
  if (!Number.isFinite(ms) || endMs <= startMs) return 0;
  const pct = ((ms - startMs) / (endMs - startMs)) * 100;
  return Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
}

interface Span {
  left: number;
  width: number;
}

function spanPct(startMs: number | null, endMs: number | null, barStartMs: number, barEndMs: number): Span | null {
  if (startMs == null || endMs == null) return null;
  const left = pctOf(startMs, barStartMs, barEndMs);
  const width = Math.max(0, pctOf(endMs, barStartMs, barEndMs) - left);
  return { left, width };
}

type CoolInterval = { startMs: number; endMs: number | null };

/** Backend-published day history: cool_intervals_today = [[startIso, endIso|null], ...] - the
 * stretches the AC actually spent cooling (open interval = running right now). AppDaemon's
 * publish path strips None INSIDE list values (verified 4.5.13 remove_literals recurses), so
 * the open interval actually arrives as a 1-element [startIso] - a missing/null end means
 * "still running". Parsed defensively and sorted; anything malformed is dropped rather than
 * guessed. Absent attr (older backend) degrades to the previous future-only bar. */
function parseCoolIntervals(raw: unknown): CoolInterval[] {
  if (!Array.isArray(raw)) return [];
  const out: CoolInterval[] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 1) continue;
    const startMs = Date.parse(String(item[0]));
    if (!Number.isFinite(startMs)) continue;
    const endRaw = item.length > 1 ? item[1] : null;
    const endMs = endRaw == null ? null : Date.parse(String(endRaw));
    if (endMs !== null && !Number.isFinite(endMs)) continue;
    out.push({ startMs, endMs });
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/** Wraps "1.7 kr"-style money substrings in the orange money span. Shared by every sentence this
 * card renders (verdict, tonight-so-far, last-night receipt) so figures read consistently. */
function withMoneyHighlight(text: string): React.ReactNode[] {
  const re = /\d+(\.\d+)? kr/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(
      <span key={`money-${key++}`} className='tonight-money'>
        {match[0]}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }
  parts.push(text.slice(lastIndex));
  return parts;
}

type ProjectedNight = { date: string; peak: number; over_ceiling?: unknown };

function projectionNights(attrs: Record<string, unknown>): ProjectedNight[] {
  const raw = attrs.nights;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (n): n is ProjectedNight => !!n && typeof (n as ProjectedNight).date === 'string' && typeof (n as ProjectedNight).peak === 'number'
  );
}

/** Local calendar date as YYYY-MM-DD - comparable to the sensor's ISO night dates. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Label by the night's ACTUAL date, never by array position - the advisor's sparse eval schedule
 * can leave yesterday's night in the sensor until its next morning run (ported from the retired
 * CoolingModule; same fix, same reason). */
function nightLabel(date: string, today: string): string {
  if (date === today) return 'Tonight';
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
}

const nightIsOver = (n: ProjectedNight) => n.over_ceiling === true || n.over_ceiling === 'true';

/** One plain-word "how it works" row: label left, value right (iOS Settings style). */
function SheetRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='tonight-sheet-row'>
      <span className='tonight-sheet-row-label'>{label}</span>
      <span className='tonight-sheet-row-value'>{value}</span>
    </div>
  );
}

export function TonightCard({ entities, callService }: TonightCardProps) {
  // Now-tick: same pattern as PriceAdvisor.tsx (lazy useState initializer covers the first
  // render; only the interval callback ever calls setState, never the render body itself).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Collapsed by default (this card was flagged as too big) - same toggle-row pattern as HeatCard.
  const [collapsed, setCollapsed] = useLocalStorageBoolean('tonightcard-collapsed', true);
  const topSlop = useTouchScrollSlopGuard();

  const call = useCallback(
    (domain: string, service: string, entityId: string, serviceData?: Record<string, unknown>) => {
      callService?.({ domain, service, target: { entity_id: entityId }, serviceData });
    },
    [callService]
  );

  const deployed = isAcDeployed(entities);
  const sleepPlan = entities?.[SLEEP_PLAN_SENSOR];
  const rec = sleepPlan?.state ?? '';
  const advisorySeason = rec === 'windows' || rec === 'hybrid' || rec === 'ac';

  // Visibility: available unit OR advisory season. Otherwise it's winter - nothing to show.
  if (!deployed && !advisorySeason) return null;

  const sleepPlanAttrs = (sleepPlan?.attributes ?? {}) as Record<string, unknown>;
  const statusEntity = entities?.[SMART_COOLING_STATUS_SENSOR];
  const statusAttrs = (statusEntity?.attributes ?? {}) as Record<string, unknown>;
  const statusState = statusEntity?.state ?? '';
  const armed = entities?.[SMART_COOLING_ENABLE]?.state === 'on';
  const ceilingEntity = entities?.[SMART_COOLING_NIGHT_CEILING];
  const ceilingValue = attrNum(ceilingEntity?.state, NaN);

  const reason = attrStr(statusAttrs.reason).toLowerCase();
  const ventReasonHit = reason.includes("venting isn't keeping up");
  const windowClosed = entities?.[AC_VENT_WINDOW_SENSOR]?.state === 'off';
  const ventAlert = ventReasonHit || (VENTING_STATES.has(statusState) && windowClosed);
  const waitingForUnit = armed && !deployed;

  const viewState = deriveViewState({ deployed, armed, rec, statusState, ventAlert });
  const buttonKind = deriveButtonKind({ deployed, armed, rec, hour: now.getHours() });
  const stateWord = STATE_WORD[viewState];

  // Hero: wake projection + wake time (both new sleep_plan attrs) - hide the whole hero line
  // gracefully if the headline number isn't published yet.
  const wakeProjection = attrNum(sleepPlanAttrs.wake_projection, NaN);
  const barStartMs = atHour(now, BAR_START_HOUR).getTime();
  const wakeDate = parseTimeAttr(sleepPlanAttrs.wake_at, barStartMs);
  const wakeMs = wakeDate ? wakeDate.getTime() : null;
  const roomNowTemp = attrNum(entities?.[AC_ROOM_TEMP_SENSOR]?.state, NaN);

  const heroSubParts: string[] = [];
  if (wakeDate) heroSubParts.push(`at wake, ${formatHHMM(wakeDate)}`);
  if (Number.isFinite(roomNowTemp)) heroSubParts.push(`room is ${roomNowTemp.toFixed(1)}° now`);

  // Verdict / sentence area - priority order: vent alert (red) > waiting-for-unit (neutral) >
  // the backend's own one-voice verdict. The live session meter is NOT a sentence: runs often
  // start mid-morning, so "Tonight so far" read as a lie - it renders as footer status icons.
  const verdictTitle = attrStr(sleepPlanAttrs.verdict_title);
  const verdictText = attrStr(sleepPlanAttrs.verdict_text);
  const sessionCostKr = attrNum(statusAttrs.session_cost_kr, NaN);
  const sessionKwh = attrNum(statusAttrs.session_kwh, NaN);
  const sessionLive = Number.isFinite(sessionCostKr) && SESSION_LIVE_STATES.has(statusState);

  // Night bar - needs a real wake time to anchor its right edge; the whole section is omitted
  // without one (never guess a fallback end time - that's scheduling, not a published number).
  const barEndMs = wakeMs != null ? wakeMs + BAR_END_PADDING_MS : null;
  const nowMs = now.getTime();
  const nowPct = barEndMs != null ? pctOf(nowMs, barStartMs, barEndMs) : null;

  // Day history (user 2026-07-30: "keep the history ... so we can see how the day have been"):
  // closed intervals stay on the bar as done segments, the open one anchors the running block
  // at its REAL start instead of `now`, and only the not-yet-started plan renders as future -
  // so finishing a phase no longer erases it from the day.
  const coolIntervals = parseCoolIntervals(statusAttrs.cool_intervals_today);
  const doneIntervals = coolIntervals.filter(
    (iv): iv is { startMs: number; endMs: number } => iv.endMs != null && iv.endMs > iv.startMs
  );
  const openInterval = coolIntervals.find(iv => iv.endMs == null) ?? null;

  const coolRunning = ACTIVE_COOLING_STATES.has(statusState);
  const minutesNeeded = attrNum(statusAttrs.minutes_needed, NaN);
  const remainMs = Number.isFinite(minutesNeeded) && minutesNeeded > 0 ? minutesNeeded * 60_000 : 0;
  const runStartMs = coolRunning ? (openInterval?.startMs ?? nowMs) : null;
  const runEndMs = runStartMs != null ? Math.max(nowMs + remainMs, runStartMs) : null;
  const futureStartDate = !coolRunning ? parseTimeAttr(statusAttrs.next_start, barStartMs) : null;
  const futureStartMs = futureStartDate ? futureStartDate.getTime() : null;
  const futureEndMs = futureStartMs != null && remainMs > 0 ? futureStartMs + remainMs : null;
  const coolEndMs = runEndMs ?? futureEndMs;

  const coolSegs: { span: Span; cls: string; key: string }[] = barEndMs == null ? [] : [
    ...doneIntervals
      .map((iv, i) => ({ span: spanPct(iv.startMs, iv.endMs, barStartMs, barEndMs), cls: 'is-done', key: `done-${i}` }))
      .filter((s): s is { span: Span; cls: string; key: string } => s.span != null && s.span.width > 0),
    ...[{ span: spanPct(runStartMs, runEndMs, barStartMs, barEndMs), cls: 'is-running', key: 'run' }].filter(
      (s): s is { span: Span; cls: string; key: string } => s.span != null && s.span.width > 0
    ),
    ...[{ span: spanPct(futureStartMs, futureEndMs, barStartMs, barEndMs), cls: 'is-future', key: 'future' }].filter(
      (s): s is { span: Span; cls: string; key: string } => s.span != null && s.span.width > 0
    ),
  ];
  // One "cool" label on the widest segment - three labelled slivers would just collide.
  const coolLabelKey = coolSegs.length ? coolSegs.reduce((a, b) => (b.span.width > a.span.width ? b : a)).key : null;
  // The two time ticks bracket the whole cooling day: first start (history included) to last
  // projected end - not just the currently-relevant block.
  const coolStartsMs = [...doneIntervals.map(iv => iv.startMs), ...(runStartMs != null ? [runStartMs] : []), ...(futureStartMs != null ? [futureStartMs] : [])];
  const coolEndsMs = [...doneIntervals.map(iv => iv.endMs), ...(runEndMs != null ? [runEndMs] : []), ...(futureEndMs != null ? [futureEndMs] : [])];
  const coolTickStartMs = coolStartsMs.length ? Math.min(...coolStartsMs) : null;
  const coolTickEndMs = coolEndsMs.length ? Math.max(...coolEndsMs) : null;

  const dryingNowPct = barEndMs != null && statusState === 'drying' ? pctOf(nowMs, barStartMs, barEndMs) : null;
  const dryingSpan: Span | null = dryingNowPct != null ? { left: dryingNowPct, width: Math.min(4, 100 - dryingNowPct) } : null;

  const openWindows = attrStringArray(sleepPlanAttrs.open_windows);
  const isWindowDay = (rec === 'windows' || rec === 'nothing') && openWindows.length > 0;
  const windowsCutoffMs = atHour(now, WINDOWS_CUTOFF_HOUR).getTime();
  const windowsSpan = barEndMs != null && isWindowDay ? spanPct(barStartMs, windowsCutoffMs, barStartMs, barEndMs) : null;

  const bedtimeStartMs = atHour(now, BEDTIME_HOUR).getTime();
  const bedtimeSpan = barEndMs != null ? spanPct(bedtimeStartMs, wakeMs, barStartMs, barEndMs) : null;

  // Hold phase (user 2026-07-30): after the main pull the room re-warms (~1.5°/h against a
  // summer-warm apartment), so the AC keeps topping up until bedtime -- without drawing it
  // the bar implies "done" at the cool block's end. Starts where the cool block ends (or now,
  // when armed and already at target with nothing booked), ends at bedtime. Display only:
  // the top-ups are the planner's normal re-evaluations, not a separate program.
  const armedHolding = armed && (statusState === 'idle' || statusState === 'drying');
  // With history, hold anchors where the day's FIRST pull-down finished (top-up bursts paint
  // over it) - the old projected-end / now fallbacks only apply before anything has completed.
  const firstDoneEndMs = doneIntervals.length ? doneIntervals[0].endMs : null;
  const holdStartMs = firstDoneEndMs ?? coolEndMs ?? (armedHolding ? nowMs : null);
  const holdSpan =
    barEndMs != null && holdStartMs != null && holdStartMs < bedtimeStartMs
      ? spanPct(holdStartMs, bedtimeStartMs, barStartMs, barEndMs)
      : null;

  // Three-day strip - same stale-night guard as the retired CoolingModule (the advisor's sparse
  // eval schedule can leave yesterday's night in the sensor until its next morning run).
  const today = localToday();
  const projection = entities?.[BEDROOM_NIGHT_PROJECTION_SENSOR];
  const projNights = projection
    ? projectionNights(projection.attributes)
        .filter(n => n.date >= today)
        .slice(0, 3)
    : [];

  // Footer receipt - independent of the sentence area above; shows whenever last night has a cost.
  const lastNightCostKr = attrNum(statusAttrs.last_night_cost_kr, NaN);
  const lastNightKwh = attrNum(statusAttrs.last_night_kwh, NaN);
  const lastNightWakeTemp = attrNum(statusAttrs.last_night_wake_temp, NaN);
  const hasLastNight = Number.isFinite(lastNightCostKr);
  const lastNightParts: string[] = ['Last night'];
  if (Number.isFinite(lastNightWakeTemp)) lastNightParts.push(`woke ${lastNightWakeTemp.toFixed(1)}°`);
  if (Number.isFinite(lastNightKwh)) lastNightParts.push(`${lastNightKwh.toFixed(1)} kWh`);
  if (hasLastNight) lastNightParts.push(`${lastNightCostKr.toFixed(1)} kr`);

  // "How tonight works" sheet - live attrs with the fallbacks the design calls for, one static
  // line, one interactive stepper (the ceiling the automation is allowed to settle for).
  const coolCph = attrNum(statusAttrs.cool_cph, NaN);
  const feasibleFloor = attrNum(statusAttrs.feasible_floor, NaN);
  const coolPower = attrNum(statusAttrs.cool_power, NaN);

  const adjustCeiling = (delta: number) => {
    if (!Number.isFinite(ceilingValue)) return;
    const next = Math.min(26, Math.max(20, Math.round((ceilingValue + delta) * 2) / 2));
    call('input_number', 'set_value', SMART_COOLING_NIGHT_CEILING, { value: next });
  };

  return (
    <div className={`tonight-card ${viewState === 'paused' ? 'is-alert' : ''}`}>
      <div
        className='tonight-top'
        onClick={() => {
          if (topSlop.consumeBlockClick()) return;
          setCollapsed(v => !v);
        }}
        onTouchStart={topSlop.onTouchStart}
        onTouchMove={topSlop.onTouchMove}
        onTouchEnd={topSlop.onTouchEnd}
        onTouchCancel={topSlop.onTouchCancel}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setCollapsed(v => !v);
          }
        }}
        role='button'
        tabIndex={0}
        aria-expanded={!collapsed}
      >
        <span className={`tonight-glyph ${viewState === 'paused' ? 'alert' : ''}`}>
          <Icon icon={GLYPH_ICON[viewState]} aria-hidden='true' />
        </span>
        <span className='tonight-title'>Climate</span>
        <span className='tonight-top-right'>
          <span className='tonight-top-wake'>{Number.isFinite(wakeProjection) ? `${wakeProjection.toFixed(1)}°` : '--°'}</span>
          {stateWord && (
            <span className={`tonight-state ${viewState === 'paused' ? 'alert' : MUTED_STATES.has(viewState) ? 'muted' : 'tint'}`}>
              {stateWord}
            </span>
          )}
          <Icon icon={collapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'} aria-hidden='true' className='tonight-chevron' />
        </span>
      </div>

      {!collapsed && (
        <>
          {Number.isFinite(wakeProjection) && (
            <div className='tonight-hero'>
              <div className='tonight-hero-value'>
                {wakeProjection.toFixed(1)}
                <sup className='tonight-hero-deg'>°</sup>
              </div>
              {heroSubParts.length > 0 && <div className='tonight-hero-sub'>{heroSubParts.join(' · ')}</div>}
            </div>
          )}

          {ventAlert ? (
            <div className='tonight-alert'>
              <Icon icon='mdi:alert' aria-hidden='true' />
              <span>Open the bathroom window — the condenser can't vent.</span>
            </div>
          ) : waitingForUnit ? (
            <p className='tonight-verdict tonight-verdict--neutral'>Waiting for the unit — is it plugged in?</p>
          ) : (
            (verdictTitle || verdictText) && (
              <p className='tonight-verdict'>
                {verdictTitle && <strong>{verdictTitle}.</strong>}
                {verdictTitle && verdictText ? ' ' : ''}
                {verdictText && withMoneyHighlight(verdictText)}
              </p>
            )
          )}

          {barEndMs != null && nowPct != null && (
            <div className='tonight-bar-section'>
              <div className='tonight-bar-track'>
                {windowsSpan && windowsSpan.width > 0 && (
                  <div
                    className='tonight-bar-segment tonight-bar-segment--windows'
                    style={{ left: `${windowsSpan.left}%`, width: `${windowsSpan.width}%` }}
                  >
                    <span className='tonight-bar-segment-label'>windows open</span>
                  </div>
                )}
                {bedtimeSpan && bedtimeSpan.width > 0 && (
                  <div
                    className='tonight-bar-segment tonight-bar-segment--bedtime'
                    style={{ left: `${bedtimeSpan.left}%`, width: `${bedtimeSpan.width}%` }}
                  >
                    <span className='tonight-bar-segment-label'>bedtime</span>
                  </div>
                )}
                {holdSpan && holdSpan.width > 0 && (
                  <div
                    className='tonight-bar-segment tonight-bar-segment--hold'
                    style={{ left: `${holdSpan.left}%`, width: `${holdSpan.width}%` }}
                  >
                    <span className='tonight-bar-segment-label'>hold</span>
                  </div>
                )}
                {coolSegs.map(seg => (
                  <div
                    key={seg.key}
                    className={`tonight-bar-segment tonight-bar-segment--cool ${seg.cls}`}
                    style={{ left: `${seg.span.left}%`, width: `${seg.span.width}%` }}
                  >
                    {seg.key === coolLabelKey && <span className='tonight-bar-segment-label'>cool</span>}
                  </div>
                ))}
                {dryingSpan && dryingSpan.width > 0 && (
                  <div
                    className='tonight-bar-segment tonight-bar-segment--drying'
                    style={{ left: `${dryingSpan.left}%`, width: `${dryingSpan.width}%` }}
                  />
                )}
                <div className='tonight-bar-now-line' style={{ left: `${nowPct}%` }} />
                <div className='tonight-bar-now-dot' style={{ left: `${nowPct}%` }} />
              </div>
              <div className='tonight-bar-ticks'>
                {coolTickStartMs != null && (
                  <span className='tonight-bar-tick' style={{ left: `${pctOf(coolTickStartMs, barStartMs, barEndMs)}%` }}>
                    {formatHHMM(new Date(coolTickStartMs))}
                  </span>
                )}
                {coolTickEndMs != null && (
                  <span className='tonight-bar-tick' style={{ left: `${pctOf(coolTickEndMs, barStartMs, barEndMs)}%` }}>
                    {formatHHMM(new Date(coolTickEndMs))}
                  </span>
                )}
                <span className='tonight-bar-tick' style={{ left: `${pctOf(bedtimeStartMs, barStartMs, barEndMs)}%` }}>
                  bed
                </span>
                {wakeDate && (
                  <span className='tonight-bar-tick' style={{ left: `${pctOf(wakeDate.getTime(), barStartMs, barEndMs)}%` }}>
                    {formatHHMM(wakeDate)}
                  </span>
                )}
              </div>
            </div>
          )}

          {projNights.length > 0 && (
            <div className='tonight-strip'>
              {projNights.map(n => (
                <div key={n.date} className='tonight-strip-tile'>
                  <span className='tonight-strip-day'>{nightLabel(n.date, today)}</span>
                  <span className='tonight-strip-peak'>{n.peak.toFixed(1)}°</span>
                  {nightIsOver(n) ? (
                    <span className='tonight-strip-tag tonight-strip-tag--ac'>
                      <Icon icon='mdi:snowflake' aria-hidden='true' /> AC
                    </span>
                  ) : (
                    <span className='tonight-strip-tag tonight-strip-tag--windows'>
                      <Icon icon='mdi:window-open-variant' aria-hidden='true' /> windows
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {buttonKind === 'cool_tonight' && (
            <button
              type='button'
              className='tonight-button tonight-button--tint'
              onClick={() => call('input_boolean', 'turn_on', SMART_COOLING_ENABLE)}
            >
              Cool Tonight
            </button>
          )}
          {buttonKind === 'going_to_bed' && (
            <button
              type='button'
              className='tonight-button tonight-button--indigo'
              onClick={() => call('input_boolean', 'turn_on', SMART_COOLING_AC_REMOVED)}
            >
              <span>Going to Bed</span>
              <small>stops the AC — unplug after</small>
            </button>
          )}
          {buttonKind === 'nothing_to_do' && (
            <div className='tonight-quiet-row'>
              <button
                type='button'
                className='tonight-quiet-action'
                onClick={() => call('input_boolean', 'turn_off', SMART_COOLING_ENABLE)}
              >
                Turn Off
              </button>
            </div>
          )}

          {sessionLive && (
            <div className='tonight-footer tonight-status' aria-label='Used today so far'>
              {Number.isFinite(sessionKwh) && (
                <span className='tonight-status-item'>
                  <Icon icon='mdi:flash' aria-hidden='true' />
                  {sessionKwh.toFixed(1)} kWh
                </span>
              )}
              <span className='tonight-status-item'>
                <Icon icon='mdi:cash' aria-hidden='true' />
                {withMoneyHighlight(`${sessionCostKr.toFixed(1)} kr`)}
              </span>
            </div>
          )}
          {hasLastNight && <div className='tonight-footer'>{withMoneyHighlight(lastNightParts.join(' · '))}</div>}

          <button type='button' className='tonight-sheet-toggle' onClick={() => setSheetOpen(v => !v)} aria-expanded={sheetOpen}>
            <span>How tonight works</span>
            <Icon icon={sheetOpen ? 'mdi:chevron-up' : 'mdi:chevron-down'} aria-hidden='true' />
          </button>

          {sheetOpen && (
            <div className='tonight-sheet'>
              <SheetRow label='Cools about' value={`${Number.isFinite(coolCph) ? coolCph.toFixed(1) : '1.9'}° per hour`} />
              {Number.isFinite(feasibleFloor) && <SheetRow label='Floor bottoms out' value={`~${feasibleFloor.toFixed(1)}°`} />}
              <SheetRow label='A degree deeper at bedtime' value='0.73° cooler wake' />
              <SheetRow
                label='Draws while cooling'
                value={`~${Number.isFinite(coolPower) ? coolPower.toFixed(2) : '0.87'} kW · learned average, not live`}
              />
              {ceilingEntity && (
                <div className='tonight-sheet-row'>
                  <span className='tonight-sheet-row-label'>Warmest wake-up you'll accept</span>
                  <div className='tonight-stepper'>
                    <button type='button' className='tonight-stepper-btn' onClick={() => adjustCeiling(-0.5)} aria-label='Lower ceiling'>
                      <Icon icon='mdi:minus' />
                    </button>
                    <span className='tonight-stepper-value'>{Number.isFinite(ceilingValue) ? `${ceilingValue.toFixed(1)}°` : '--'}</span>
                    <button type='button' className='tonight-stepper-btn' onClick={() => adjustCeiling(0.5)} aria-label='Raise ceiling'>
                      <Icon icon='mdi:plus' />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
