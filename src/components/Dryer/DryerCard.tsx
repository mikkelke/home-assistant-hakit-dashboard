import { useState, useEffect, useCallback, useRef } from 'react';
import { Icon } from '@iconify/react';
import { useHass } from '@hakit/core';
import type { HassEntities, CallServiceFunction } from '../../types';
import { formatKr } from '../../utils/format';
import { fireHaEvent } from '../../utils/haEvents';
import { useRunCost } from '../../energy';
import { ApplianceCycleTiming } from '../ApplianceCycleTiming';
import { useLocalStorageBoolean } from '../../hooks';
import { ApplianceCard, AppliancePickerSheet, ApplianceHistorySheet, formatTimeOnly, formatDuration } from '../Appliance';
import type { ApplianceCycle, ApplianceFeedbackJson } from '../Appliance';
import {
  DRYER_ANNOUNCE_BOOLEAN,
  DRYER_DRYNESS_SELECT,
  DRYER_PROGRAMME_SELECT,
  DRYER_SKANE_PLUS_BOOLEAN,
  DRYER_STATE_ENTITY,
  DRYER_TIME_MINUTES_SELECT,
} from '../../config/entities';

const ACCENT_CLASS = 'appliance-accent-dryer';
const GLYPH_ICON = 'mdi:tumble-dryer';

const DRYER_STATE_ID = DRYER_STATE_ENTITY;
const PROGRAMME_SELECT_ID = DRYER_PROGRAMME_SELECT;
const DRYNESS_SELECT_ID = DRYER_DRYNESS_SELECT;
const SKANE_PLUS_TOGGLE_ID = DRYER_SKANE_PLUS_BOOLEAN;
const TIME_SELECT_ID = DRYER_TIME_MINUTES_SELECT;
const ANNOUNCE_TOGGLE_ID = DRYER_ANNOUNCE_BOOLEAN;

/** Programmes that show the Dryness dropdown */
const PROGRAMMES_WITH_DRYNESS = ['Bomuld', 'Strygelet', 'Finvask', 'Skjorter', 'Ekspres', 'Denim', 'Sengetøj', 'Udglatning'];

/** Programmes that show the Skåne + toggle (and allow changing it) */
const PROGRAMMES_WITH_SKANE = ['Bomuld', 'Strygelet', 'Skjorter', 'Denim', 'Varm luft'];

/** Programmes where Skåne + is always on (show as locked, do not show toggle) */
const PROGRAMMES_SKANE_LOCKED_ON = ['Finvask', 'Udglatning'];

/** Programme that shows the Time (minutes) dropdown */
const PROGRAMME_WITH_TIME = 'Varm luft';

/** Programme keys in JSON; display labels for UI */
// eslint-disable-next-line react-refresh/only-export-components -- shared constant used by other components
export const PROGRAMME_KEY_TO_LABEL: Record<string, string> = {
  bomuld: 'Bomuld',
  bomuld_cupboard: 'Bomuld Skabstørt',
  bomuld_cupboard_gentle: 'Bomuld Skabstørt inkl. Skåne +',
  bomuld_iron: 'Bomuld Strygetørt',
  strygelet_cupboard: 'Strygelet Skabstørt',
  finvask_cupboard: 'Finvask Skabstørt',
  finish_uld: 'Finish uld',
  shirts_cupboard: 'Skjorter Skabstørt',
  ekspres_cupboard: 'Ekspres Skabstørt',
  denim_cupboard: 'Denim Skabstørt',
  impaegnering_cupboard: 'Imprægnering Skabstørt',
  unknown: 'Unknown',
};

const PROGRAMME_KEYS = Object.keys(PROGRAMME_KEY_TO_LABEL) as string[];

type DryerState = 'Off' | 'Running' | 'Paused' | 'Unemptied' | 'Emptied';

export type DryerCycle = ApplianceCycle;
export type DryerFeedbackJson = ApplianceFeedbackJson;

interface DryerCardProps {
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

function getFeedbackUrl(): string | null {
  const url = (import.meta.env.VITE_DRYER_FEEDBACK_URL as string)?.trim();
  return url && url.length > 0 ? url : null;
}

type DryerPicker = 'programme' | 'dryness' | 'time' | null;

export function DryerCard({ entities, callService }: DryerCardProps) {
  const dryer = entities?.[DRYER_STATE_ID];
  const programmeSelect = entities?.[PROGRAMME_SELECT_ID];
  const drynessSelect = entities?.[DRYNESS_SELECT_ID];
  const skanePlusToggle = entities?.[SKANE_PLUS_TOGGLE_ID];
  const timeSelect = entities?.[TIME_SELECT_ID];
  const announceToggle = entities?.[ANNOUNCE_TOGGLE_ID];

  const [collapsed, setCollapsed] = useLocalStorageBoolean('dryercard-collapsed', true);
  const connection = useHass((s: { connection?: unknown }) => s.connection);
  // `connection` is typed `unknown` (see energy/ws.ts / VacuumCard) — narrow to boolean once so
  // it can gate JSX directly (`unknown && <Jsx/>` doesn't type-check as ReactNode).
  const hasConnection = Boolean(connection);

  // Which picker/history sheet is open (at most one at a time — chips/footer icons open them).
  const [openPicker, setOpenPicker] = useState<DryerPicker>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Press feedback for the "Emptied" action (quick button or hero pill): acknowledges instantly,
  // then the entity flipping to Emptied hides the whole card — that's the real success signal.
  const [emptiedPressed, setEmptiedPressed] = useState(false);
  const emptiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (emptiedTimerRef.current) clearTimeout(emptiedTimerRef.current);
    };
  }, []);

  const [feedbackData, setFeedbackData] = useState<DryerFeedbackJson | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [savingCycleIndex, setSavingCycleIndex] = useState<number | null>(null);
  const [cycleSelection, setCycleSelection] = useState<Record<number, string>>({});

  const feedbackUrl = getFeedbackUrl();

  const fetchFeedback = useCallback(async () => {
    if (!feedbackUrl) return;
    setFeedbackLoading(true);
    setFeedbackError(null);
    try {
      const res = await fetch(feedbackUrl, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: DryerFeedbackJson = await res.json();
      if (!data || !Array.isArray(data.cycles)) {
        setFeedbackData({ version: data?.version ?? 2, cycles: [] });
      } else {
        setFeedbackData(data);
      }
    } catch (e) {
      setFeedbackError(e instanceof Error ? e.message : 'Failed to load');
      setFeedbackData(null);
    } finally {
      setFeedbackLoading(false);
    }
  }, [feedbackUrl]);

  useEffect(() => {
    if (feedbackUrl) fetchFeedback();
  }, [feedbackUrl, fetchFeedback]);

  const persistFeedback = useCallback(
    async (payload: DryerFeedbackJson) => {
      if (!feedbackUrl) return;
      try {
        const res = await fetch(feedbackUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setFeedbackData(payload);
        setFeedbackError(null);
      } catch (e) {
        setFeedbackError(e instanceof Error ? e.message : 'Failed to save');
      }
    },
    [feedbackUrl]
  );

  const handleConfirmCycle = useCallback(
    async (cycleIndex: number) => {
      if (!feedbackData || feedbackUrl == null) return;
      const cycles = [...feedbackData.cycles];
      const idx = cycles.length - 1 - cycleIndex;
      if (idx < 0 || idx >= cycles.length) return;
      const programmeKey = cycleSelection[cycleIndex] ?? cycles[idx].predicted;
      setSavingCycleIndex(cycleIndex);
      cycles[idx] = {
        ...cycles[idx],
        confirmed: programmeKey,
        programme_confirmed_by_human: true,
      };
      await persistFeedback({ ...feedbackData, cycles });
      setSavingCycleIndex(null);
      setCycleSelection(prev => {
        const next = { ...prev };
        delete next[cycleIndex];
        return next;
      });
    },
    [feedbackData, feedbackUrl, persistFeedback, cycleSelection]
  );

  // State + the stats-line attributes are resolved unconditionally, before either early return
  // below, because useRunCost is a hook and must run on every render (rules-of-hooks).
  const rawState = (dryer?.state?.trim() || 'Off').toLowerCase();
  const attrs = dryer?.attributes ?? {};
  let state: DryerState = (dryer?.state?.trim() || 'Off') as DryerState;
  if (rawState === 'on') {
    const hasRunningAttrs =
      attrs.estimated_remaining_min != null ||
      attrs.programme_duration_min != null ||
      (attrs.progress_pct != null && attrs.progress_pct !== '');
    // Run stats (run_time_minutes/energy_used) alone no longer imply a finished cycle — energy_used
    // is now also published live while Running, so only treat them as Unemptied once the cycle has
    // actually ended (cycle_complete flagged, or cycle_start_time cleared).
    const hasEndedCycleAttrs =
      (attrs.run_time_minutes != null || attrs.energy_used != null) &&
      (attrs.cycle_complete === true || attrs.cycle_complete === 'true' || !attrs.cycle_start_time);
    if (hasEndedCycleAttrs) state = 'Unemptied';
    else if (hasRunningAttrs || attrs.programme_label || attrs.detected_programme) state = 'Running';
  } else if (rawState === 'off') {
    state = 'Off';
  }

  const runTimeMinutes = attrs.run_time_minutes != null ? Number(attrs.run_time_minutes) : undefined;
  const energyUsed = attrs.energy_used != null ? Number(attrs.energy_used) : undefined;
  // Detection lag between real cycle end and the Unemptied flip, when the watcher publishes it.
  const idleMinutes = attrs.idle_min != null ? Number(attrs.idle_min) : undefined;

  const runCostKr = useRunCost({
    mode: 'finished',
    active: state === 'Unemptied',
    endDetectedIso: dryer?.last_changed,
    runTimeMinutes,
    idleMinutes,
    energyKwh: energyUsed,
  });
  const liveCostKr = useRunCost({
    mode: 'live',
    active: state === 'Running',
    startIso: typeof attrs.cycle_start_time === 'string' && attrs.cycle_start_time ? attrs.cycle_start_time : undefined,
    endAnchorIso: dryer?.last_updated,
    energyKwh: energyUsed,
  });

  if (!dryer) return null;

  if (state === 'Off' || state === 'Emptied') return null;

  const programmeValue = (programmeSelect?.state ?? '').trim();
  const programmeLabel = (attrs.programme_label as string) || programmeValue || '—';
  const options: string[] = Array.isArray(programmeSelect?.attributes?.options) ? (programmeSelect.attributes.options as string[]) : [];

  // Visibility of controls by programme (physical panel rules)
  const showDryness = PROGRAMMES_WITH_DRYNESS.includes(programmeValue);
  const showSkane = PROGRAMMES_WITH_SKANE.includes(programmeValue);
  const showTime = programmeValue === PROGRAMME_WITH_TIME;
  const lockSkaneOn = PROGRAMMES_SKANE_LOCKED_ON.includes(programmeValue);
  const remainingMin = attrs.estimated_remaining_min != null ? Number(attrs.estimated_remaining_min) : undefined;
  const totalMin = attrs.programme_duration_min != null ? Number(attrs.programme_duration_min) : undefined;
  // Overrun: cycle ran past its expected duration (attr absent when not overrunning - the
  // monitor only publishes it when > 0). Remaining is then a floor ("still drying"), not a countdown.
  const overrunMin = attrs.overrun_min != null ? Number(attrs.overrun_min) : 0;
  const cycleStartTime = attrs.cycle_start_time as string | undefined;
  const startedAtDisplay = attrs.started_at_display as string | undefined;
  const estimatedEndTime = attrs.estimated_end_time as string | undefined;

  const progressWhenRunning =
    state === 'Running' && ((totalMin != null && totalMin > 0) || (attrs.progress_pct != null && attrs.progress_pct !== ''));
  const hasProgressBar = progressWhenRunning;
  const elapsedMin =
    hasProgressBar && remainingMin != null && totalMin != null
      ? totalMin - remainingMin
      : attrs.elapsed_minutes != null
        ? Number(attrs.elapsed_minutes)
        : 0;
  const progressPct = !progressWhenRunning
    ? 0
    : attrs.progress_pct != null && attrs.progress_pct !== ''
      ? Math.min(100, Math.max(0, Number(attrs.progress_pct)))
      : totalMin != null && totalMin > 0
        ? Math.min(100, (elapsedMin / totalMin) * 100)
        : 0;
  const countdownLabel =
    remainingMin == null
      ? null
      : remainingMin <= 2
        ? 'Almost done'
        : overrunMin > 0
          ? `+${Math.round(overrunMin)} min over usual — still drying`
          : `${formatDuration(remainingMin)} left`;
  // New cycle-strip design only degrades to the plain timing line when there's truly nothing to
  // bar-chart (no percentage AND no known total) — otherwise even a 0% bar is more informative.
  const showProgressStrip = !(progressPct === 0 && totalMin == null);

  // "Started HH:MM": prefer started_at_display if time-only (HH:MM); if ISO datetime, format to time; else use cycle_start_time
  const startedDisplay = (() => {
    const s = startedAtDisplay && String(startedAtDisplay).trim();
    if (!s) return formatTimeOnly(cycleStartTime);
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s.slice(0, 5);
    if (/^\d{4}-\d{2}/.test(s) || s.includes('T')) return formatTimeOnly(s);
    return formatTimeOnly(cycleStartTime);
  })();
  const hasStartedDisplay = startedDisplay !== '--:--';

  const showApplianceTimingDetail =
    state === 'Running' &&
    ((cycleStartTime && String(cycleStartTime).trim() !== '') ||
      (startedAtDisplay && String(startedAtDisplay).trim() !== '') ||
      countdownLabel != null ||
      (estimatedEndTime != null && String(estimatedEndTime).trim() !== ''));

  const isInteractive = state === 'Running' || state === 'Unemptied';

  const handleProgrammeChange = (option: string) => {
    if (!callService || !programmeSelect) return;
    callService({
      domain: 'input_select',
      service: 'select_option',
      target: { entity_id: PROGRAMME_SELECT_ID },
      serviceData: { option },
    });
  };

  const handleDrynessChange = (option: string) => {
    if (!callService || !drynessSelect) return;
    callService({
      domain: 'input_select',
      service: 'select_option',
      target: { entity_id: DRYNESS_SELECT_ID },
      serviceData: { option },
    });
  };

  const handleSkanePlusToggle = () => {
    if (!callService || !skanePlusToggle) return;
    const on = skanePlusToggle.state === 'on';
    callService({
      domain: 'input_boolean',
      service: on ? 'turn_off' : 'turn_on',
      target: { entity_id: SKANE_PLUS_TOGGLE_ID },
    });
  };

  const handleTimeChange = (option: string) => {
    if (!callService || !timeSelect) return;
    callService({
      domain: 'input_select',
      service: 'select_option',
      target: { entity_id: TIME_SELECT_ID },
      serviceData: { option },
    });
  };

  const handleAnnounceToggle = () => {
    if (!callService || !announceToggle) return;
    const on = announceToggle.state === 'on';
    callService({
      domain: 'input_boolean',
      service: on ? 'turn_off' : 'turn_on',
      target: { entity_id: ANNOUNCE_TOGGLE_ID },
    });
  };

  const cyclesNewestFirst = feedbackData?.cycles ? [...feedbackData.cycles].reverse() : [];
  const drynessOptions: string[] = Array.isArray(drynessSelect?.attributes?.options) ? (drynessSelect.attributes.options as string[]) : [];
  const timeOptions: string[] = Array.isArray(timeSelect?.attributes?.options) ? (timeSelect.attributes.options as string[]) : [];
  const announceOn = announceToggle?.state === 'on';
  const skaneOn = skanePlusToggle?.state === 'on';

  const handlePick = (setter: (option: string) => void) => (option: string) => {
    setter(option);
    setOpenPicker(null);
  };

  const handleForceEmptied = () => {
    if (!connection) return;
    setEmptiedPressed(true);
    if (emptiedTimerRef.current) clearTimeout(emptiedTimerRef.current);
    emptiedTimerRef.current = setTimeout(() => setEmptiedPressed(false), 5000);
    fireHaEvent(connection, 'dryer_force_emptied', { reason: 'Dashboard' });
  };

  const stateWord = state === 'Running' ? 'Running' : state === 'Paused' ? 'Paused' : 'Empty it';
  const stateWordClass = state === 'Running' ? 'tint' : state === 'Unemptied' ? 'alert' : 'muted';

  // "Done HH:MM": the real cycle end, recovered from the Unemptied-flip timestamp minus the
  // backend's known detection lag (idle_min) — omitted entirely when last_changed can't be parsed.
  const lastChangedMs = dryer.last_changed ? Date.parse(dryer.last_changed) : NaN;
  const doneAtDisplay = Number.isFinite(lastChangedMs)
    ? new Date(lastChangedMs - (idleMinutes ?? 0) * 60_000).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : null;
  const startedByRaw = typeof attrs.started_by === 'string' ? attrs.started_by.trim() : '';
  const heroLine2 = startedByRaw
    ? `Started by ${startedByRaw} · ${startedDisplay}`
    : hasStartedDisplay
      ? `Started ${startedDisplay}`
      : null;

  const renderChips = () => (
    <div className='appliance-chips'>
      <DryerChip label={programmeLabel} isInteractive={isInteractive} onClick={() => setOpenPicker('programme')} />
      {showDryness && drynessSelect && (
        <DryerChip label={drynessSelect.state ?? '—'} isInteractive={isInteractive} onClick={() => setOpenPicker('dryness')} />
      )}
      {showTime && timeSelect?.state && (
        <DryerChip label={`${timeSelect.state} min`} isInteractive={isInteractive} onClick={() => setOpenPicker('time')} />
      )}
      {lockSkaneOn && (
        <span className='appliance-chip on' title='Always on for this program'>
          Skåne+
        </span>
      )}
      {!lockSkaneOn && showSkane && skanePlusToggle && (
        <DryerChip label='Skåne+' isInteractive={isInteractive} onClick={handleSkanePlusToggle} tinted={skaneOn} />
      )}
    </div>
  );

  const quickButton =
    collapsed && state === 'Running' && announceToggle ? (
      <button
        type='button'
        className={`appliance-quick-btn ${announceOn ? 'on' : ''}`}
        onClick={handleAnnounceToggle}
        aria-pressed={announceOn}
        aria-label={announceOn ? 'Turn off announce when finished' : 'Turn on announce when finished'}
        title='Announce when finished'
      >
        <Icon icon='mdi:bell' aria-hidden='true' />
      </button>
    ) : collapsed && state === 'Unemptied' && hasConnection ? (
      <button
        type='button'
        className='appliance-quick-btn'
        onClick={handleForceEmptied}
        disabled={emptiedPressed}
        aria-label='Mark the dryer as emptied'
        title='Mark emptied'
      >
        <Icon
          icon={emptiedPressed ? 'mdi:loading' : 'mdi:basket-outline'}
          className={emptiedPressed ? 'appliance-spin' : ''}
          aria-hidden='true'
        />
      </button>
    ) : null;

  return (
    <ApplianceCard
      accentClassName={ACCENT_CLASS}
      glyphIcon={GLYPH_ICON}
      title='Dryer'
      collapsed={collapsed}
      onToggleCollapsed={() => setCollapsed(v => !v)}
      quickButton={quickButton}
      stateWord={stateWord}
      stateWordClass={stateWordClass}
      showCollapsedStrip={state === 'Running'}
      progressPct={progressPct}
    >
      {state === 'Running' && (
        <>
          {showProgressStrip ? (
            <div className='appliance-cycle-strip'>
              <div className='appliance-cycle-bar'>
                <div className='appliance-cycle-track'>
                  <div className='appliance-cycle-fill' style={{ width: `${progressPct}%` }} />
                </div>
                <div className='appliance-cycle-now' style={{ left: `${progressPct}%` }} />
              </div>
              <div className='appliance-cycle-meta'>
                {hasStartedDisplay && <span className='appliance-cycle-meta-start'>{startedDisplay}</span>}
                {countdownLabel != null && <span className='appliance-cycle-meta-countdown'>{countdownLabel}</span>}
                {estimatedEndTime && String(estimatedEndTime).trim() !== '' && (
                  <span className='appliance-cycle-meta-end'>~{formatTimeOnly(estimatedEndTime)}</span>
                )}
              </div>
            </div>
          ) : (
            <div className='appliance-timing-line'>
              <ApplianceCycleTiming
                hasDetail={showApplianceTimingDetail}
                startedDisplay={startedDisplay}
                estimatedEndTime={estimatedEndTime}
                countdownLabel={countdownLabel}
                formatTimeOnly={formatTimeOnly}
              />
            </div>
          )}

          {renderChips()}

          {(energyUsed != null || liveCostKr != null || announceToggle || feedbackUrl) && (
            <div className='appliance-footer'>
              {energyUsed != null && (
                <span className='appliance-footer-item'>
                  <Icon icon='mdi:flash' aria-hidden='true' />
                  {Number(energyUsed).toFixed(2)} kWh
                </span>
              )}
              {liveCostKr != null && <span className='appliance-footer-item'>≈ {formatKr(liveCostKr)}</span>}
              {(announceToggle || feedbackUrl) && (
                <span className='appliance-footer-actions'>
                  {announceToggle && (
                    <button
                      type='button'
                      className={`appliance-footer-icon-btn ${announceOn ? 'on' : ''}`}
                      onClick={handleAnnounceToggle}
                      aria-pressed={announceOn}
                      aria-label={announceOn ? 'Turn off announce when finished' : 'Turn on announce when finished'}
                    >
                      <Icon icon='mdi:bell' aria-hidden='true' />
                    </button>
                  )}
                  {feedbackUrl && (
                    <button
                      type='button'
                      className='appliance-footer-icon-btn'
                      onClick={() => setHistoryOpen(true)}
                      aria-label='Cycle history'
                    >
                      <Icon icon='mdi:history' aria-hidden='true' />
                    </button>
                  )}
                </span>
              )}
            </div>
          )}
        </>
      )}

      {state === 'Paused' && (
        <div className='appliance-paused-row'>
          <Icon icon='mdi:plus-circle-outline' aria-hidden='true' />
          <span>Adding laundry…</span>
        </div>
      )}

      {state === 'Unemptied' && (
        <>
          <div className='appliance-hero'>
            <span className='appliance-hero-icon'>
              <Icon icon='mdi:basket-outline' aria-hidden='true' />
            </span>
            <span className='appliance-hero-text'>
              {doneAtDisplay && <span className='appliance-hero-line1'>Done {doneAtDisplay}</span>}
              {heroLine2 && <span className='appliance-hero-line2'>{heroLine2}</span>}
            </span>
            {hasConnection && (
              <button
                type='button'
                className='appliance-emptied-pill'
                onClick={handleForceEmptied}
                disabled={emptiedPressed}
                aria-busy={emptiedPressed}
              >
                <Icon
                  icon={emptiedPressed ? 'mdi:loading' : 'mdi:check'}
                  className={emptiedPressed ? 'appliance-spin' : ''}
                  aria-hidden='true'
                />
                <span>Emptied</span>
              </button>
            )}
          </div>

          {renderChips()}

          {(runTimeMinutes != null || energyUsed != null || runCostKr != null || feedbackUrl) && (
            <div className='appliance-footer'>
              {runTimeMinutes != null && (
                <span className='appliance-footer-item'>
                  <Icon icon='mdi:clock-outline' aria-hidden='true' />
                  Ran {formatDuration(runTimeMinutes)}
                </span>
              )}
              {energyUsed != null && (
                <span className='appliance-footer-item'>
                  <Icon icon='mdi:flash' aria-hidden='true' />
                  {Number(energyUsed).toFixed(2)} kWh
                </span>
              )}
              {runCostKr != null && <span className='appliance-footer-item'>≈ {formatKr(runCostKr)}</span>}
              {feedbackUrl && (
                <span className='appliance-footer-actions'>
                  <button
                    type='button'
                    className='appliance-footer-icon-btn'
                    onClick={() => setHistoryOpen(true)}
                    aria-label='Cycle history'
                  >
                    <Icon icon='mdi:history' aria-hidden='true' />
                  </button>
                </span>
              )}
            </div>
          )}
        </>
      )}

      {openPicker === 'programme' && (
        <AppliancePickerSheet
          accentClassName={ACCENT_CLASS}
          glyphIcon={GLYPH_ICON}
          historyKey='dryer-picker'
          title='Program'
          options={options}
          current={programmeSelect?.state ?? ''}
          onPick={handlePick(handleProgrammeChange)}
          onClose={() => setOpenPicker(null)}
        />
      )}
      {openPicker === 'dryness' && (
        <AppliancePickerSheet
          accentClassName={ACCENT_CLASS}
          glyphIcon={GLYPH_ICON}
          historyKey='dryer-picker'
          title='Dryness'
          options={drynessOptions}
          current={drynessSelect?.state ?? ''}
          onPick={handlePick(handleDrynessChange)}
          onClose={() => setOpenPicker(null)}
        />
      )}
      {openPicker === 'time' && (
        <AppliancePickerSheet
          accentClassName={ACCENT_CLASS}
          glyphIcon={GLYPH_ICON}
          historyKey='dryer-picker'
          title='Time'
          options={timeOptions}
          current={timeSelect?.state ?? ''}
          onPick={handlePick(handleTimeChange)}
          onClose={() => setOpenPicker(null)}
          renderOption={opt => `${opt} min`}
        />
      )}
      {historyOpen && (
        <ApplianceHistorySheet
          accentClassName={ACCENT_CLASS}
          historyKey='dryer-history'
          cyclesNewestFirst={cyclesNewestFirst}
          hasFeedbackData={feedbackData !== null}
          feedbackLoading={feedbackLoading}
          feedbackError={feedbackError}
          fetchFeedback={fetchFeedback}
          cycleSelection={cycleSelection}
          setCycleSelection={setCycleSelection}
          savingCycleIndex={savingCycleIndex}
          handleConfirmCycle={handleConfirmCycle}
          programmeKeys={PROGRAMME_KEYS}
          programmeKeyToLabel={PROGRAMME_KEY_TO_LABEL}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </ApplianceCard>
  );
}

/** A setting's current value as a tappable pill — a plain muted span when the card isn't
 * interactive (state has no editable settings right now). `tinted` marks the Skåne+ chip
 * as on without going through a picker sheet. */
function DryerChip({
  label,
  isInteractive,
  onClick,
  tinted,
}: {
  label: string;
  isInteractive: boolean;
  onClick: () => void;
  tinted?: boolean;
}) {
  if (!isInteractive) return <span className='appliance-chip muted'>{label}</span>;
  return (
    <button type='button' className={`appliance-chip ${tinted ? 'on' : ''}`} onClick={onClick}>
      {label}
    </button>
  );
}
