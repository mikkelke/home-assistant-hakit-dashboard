import { useState, useEffect, useCallback, useRef } from 'react';
import { Icon } from '@iconify/react';
import { useHass } from '@hakit/core';
import type { HassEntities, CallServiceFunction } from '../../types';
import { resolveDishwasherSemanticState } from '../../utils/dishwasherSemanticState';
import { formatKr } from '../../utils/format';
import { fireHaEvent } from '../../utils/haEvents';
import { useRunCost } from '../../energy';
import { ApplianceCycleTiming } from '../ApplianceCycleTiming';
import { useLocalStorageBoolean } from '../../hooks';
import { ApplianceCard, AppliancePickerSheet, ApplianceHistorySheet, formatTimeOnly, formatDuration } from '../Appliance';
import type { ApplianceCycle, ApplianceFeedbackJson } from '../Appliance';

const ACCENT_CLASS = 'appliance-accent-dishwasher';
const GLYPH_ICON = 'mdi:dishwasher';

const DISHWASHER_STATE_ID = 'sensor.dishwasher_state';
const DISHWASHER_INPUT_STATE_ID = 'input_select.dishwasher_state';
const PROGRAMME_SELECT_ID = 'input_select.dishwasher_confirmed_programme';
const SHORT_SELECT_ID = 'input_select.dishwasher_short';

const SHORT_OPTIONS = ['—', 'Yes', 'No'] as const;

/** Short-programme chip/picker label for the raw input_select value ("Yes"/"No"/"—") — the
 * helper value stays raw (select_option always gets the RAW option), only the display text
 * changes. Anything not recognized falls back to the raw value unchanged (e.g. the "—" placeholder). */
function formatShortLabel(value: string | undefined): string {
  if (value == null) return '—';
  const key = value.trim().toLowerCase();
  if (key === 'yes' || key === 'on' || key === 'true') return 'Short';
  if (key === 'no' || key === 'off' || key === 'false') return 'Full length';
  return value;
}

/** Programme keys in JSON; display labels for UI */
// eslint-disable-next-line react-refresh/only-export-components -- shared constant used by other components
export const PROGRAMME_KEY_TO_LABEL: Record<string, string> = {
  eco: 'ECO',
  eco_short: 'ECO Short',
  normal: 'Normal',
  quick: 'Quick',
  rinse: 'Rinse',
  intensive: 'Intensive',
  unknown: 'Unknown',
};

const PROGRAMME_KEYS = Object.keys(PROGRAMME_KEY_TO_LABEL) as string[];

type DishwasherState = 'Off' | 'Running' | 'Paused' | 'Unemptied' | 'Emptied';

export type DishwasherCycle = ApplianceCycle;
export type DishwasherFeedbackJson = ApplianceFeedbackJson;

interface DishwasherCardProps {
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

function getFeedbackUrl(): string | null {
  const url = (import.meta.env.VITE_DISHWASHER_FEEDBACK_URL as string)?.trim();
  return url && url.length > 0 ? url : null;
}

type DishwasherPicker = 'programme' | 'short' | null;

export function DishwasherCard({ entities, callService }: DishwasherCardProps) {
  const dishwasher = entities?.[DISHWASHER_STATE_ID];
  const dishwasherInputState = entities?.[DISHWASHER_INPUT_STATE_ID];
  const programmeSelect = entities?.[PROGRAMME_SELECT_ID];
  const shortSelect = entities?.[SHORT_SELECT_ID];

  const [collapsed, setCollapsed] = useLocalStorageBoolean('dishwashercard-collapsed', true);
  const connection = useHass((s: { connection?: unknown }) => s.connection);
  // `connection` is typed `unknown` (see energy/ws.ts / VacuumCard) — narrow to boolean once so
  // it can gate JSX directly (`unknown && <Jsx/>` doesn't type-check as ReactNode).
  const hasConnection = Boolean(connection);

  // Which picker/history sheet is open (at most one at a time — chips/footer icons open them).
  const [openPicker, setOpenPicker] = useState<DishwasherPicker>(null);
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

  const [feedbackData, setFeedbackData] = useState<DishwasherFeedbackJson | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [savingCycleIndex, setSavingCycleIndex] = useState<number | null>(null);
  /** Per-row programme selection for confirm/correct (newest-first index -> programme key) */
  const [cycleSelection, setCycleSelection] = useState<Record<number, string>>({});

  const feedbackUrl = getFeedbackUrl();

  const fetchFeedback = useCallback(async () => {
    if (!feedbackUrl) return;
    setFeedbackLoading(true);
    setFeedbackError(null);
    try {
      const res = await fetch(feedbackUrl, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: DishwasherFeedbackJson = await res.json();
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
    async (payload: DishwasherFeedbackJson) => {
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

  // Semantic state and the stats-line attributes are resolved unconditionally, before either early
  // return below, because useRunCost is a hook and must run on every render (rules-of-hooks).
  const attrs = dishwasher?.attributes ?? {};
  const state: DishwasherState = resolveDishwasherSemanticState(dishwasher, dishwasherInputState);
  const runTimeMinutes = attrs.run_time_minutes != null ? Number(attrs.run_time_minutes) : undefined;
  const energyUsed = attrs.energy_used != null ? Number(attrs.energy_used) : undefined;

  const runCostKr = useRunCost({
    mode: 'finished',
    active: state === 'Unemptied',
    endDetectedIso: dishwasher?.last_changed,
    runTimeMinutes,
    energyKwh: energyUsed,
  });
  const liveCostKr = useRunCost({
    mode: 'live',
    active: state === 'Running',
    startIso: typeof attrs.cycle_start_time === 'string' && attrs.cycle_start_time ? attrs.cycle_start_time : undefined,
    endAnchorIso: dishwasher?.last_updated,
    energyKwh: energyUsed,
  });

  if (!dishwasher) return null;

  if (state === 'Off' || state === 'Emptied') return null;

  const programmeLabel = (attrs.programme_label as string) || programmeSelect?.state || '—';
  const options: string[] = Array.isArray(programmeSelect?.attributes?.options) ? (programmeSelect.attributes.options as string[]) : [];
  const remainingMin = attrs.estimated_remaining_min != null ? Number(attrs.estimated_remaining_min) : undefined;
  const totalMin = attrs.programme_duration_min != null ? Number(attrs.programme_duration_min) : undefined;
  const cycleStartTime = attrs.cycle_start_time as string | undefined;
  const cycleStartTimeLocal = attrs.cycle_start_time_local as string | undefined;
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
  const countdownLabel = remainingMin == null ? null : remainingMin <= 0 ? 'Almost done' : `${formatDuration(remainingMin)} left`;
  // New cycle-strip design only degrades to the plain timing line when there's truly nothing to
  // bar-chart (no percentage AND no known total) — otherwise even a 0% bar is more informative.
  const showProgressStrip = !(progressPct === 0 && totalMin == null);

  // "Started HH:MM": prefer started_at_display if it's time-only (HH:MM); if it's ISO datetime, format to time; else use cycle_start_time
  const startedDisplay = (() => {
    const s = startedAtDisplay && String(startedAtDisplay).trim();
    if (!s) return formatTimeOnly(cycleStartTimeLocal || cycleStartTime);
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s.slice(0, 5);
    if (/^\d{4}-\d{2}/.test(s) || s.includes('T')) return formatTimeOnly(s);
    return formatTimeOnly(cycleStartTimeLocal || cycleStartTime);
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

  const handleShortChange = (option: string) => {
    if (!callService) return;
    callService({
      domain: 'input_select',
      service: 'select_option',
      target: { entity_id: SHORT_SELECT_ID },
      serviceData: { option },
    });
  };

  const cyclesNewestFirst = feedbackData?.cycles ? [...feedbackData.cycles].reverse() : [];

  const handlePick = (setter: (option: string) => void) => (option: string) => {
    setter(option);
    setOpenPicker(null);
  };

  const handleForceEmptied = () => {
    if (!connection) return;
    setEmptiedPressed(true);
    if (emptiedTimerRef.current) clearTimeout(emptiedTimerRef.current);
    emptiedTimerRef.current = setTimeout(() => setEmptiedPressed(false), 5000);
    fireHaEvent(connection, 'dishwasher_force_emptied', { reason: 'Dashboard' });
  };

  const stateWord = state === 'Running' ? 'Running' : state === 'Paused' ? 'Paused' : 'Empty it';
  const stateWordClass = state === 'Running' ? 'tint' : state === 'Unemptied' ? 'alert' : 'muted';

  // "Done HH:MM": the dishwasher has no idle-detection lag (unlike washer/dryer), so last_changed
  // IS the real cycle end — omitted entirely when it can't be parsed.
  const lastChangedMs = dishwasher.last_changed ? Date.parse(dishwasher.last_changed) : NaN;
  const doneAtDisplay = Number.isFinite(lastChangedMs)
    ? new Date(lastChangedMs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
    : null;
  const startedByRaw = typeof attrs.started_by === 'string' ? attrs.started_by.trim() : '';
  const heroLine2 = startedByRaw
    ? `Started by ${startedByRaw} · ${startedDisplay}`
    : hasStartedDisplay
      ? `Started ${startedDisplay}`
      : null;

  const renderChips = () => (
    <div className='appliance-chips'>
      <DishwasherChip label={programmeLabel} isInteractive={isInteractive} onClick={() => setOpenPicker('programme')} />
      {shortSelect && (
        <DishwasherChip label={formatShortLabel(shortSelect.state)} isInteractive={isInteractive} onClick={() => setOpenPicker('short')} />
      )}
    </div>
  );

  const quickButton =
    collapsed && state === 'Unemptied' && hasConnection ? (
      <button
        type='button'
        className='appliance-quick-btn'
        onClick={handleForceEmptied}
        disabled={emptiedPressed}
        aria-label='Mark the dishwasher as emptied'
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
      title='Dishwasher'
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

          {(energyUsed != null || liveCostKr != null || feedbackUrl) && (
            <div className='appliance-footer'>
              {energyUsed != null && (
                <span className='appliance-footer-item'>
                  <Icon icon='mdi:flash' aria-hidden='true' />
                  {Number(energyUsed).toFixed(2)} kWh
                </span>
              )}
              {liveCostKr != null && <span className='appliance-footer-item'>≈ {formatKr(liveCostKr)}</span>}
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

      {state === 'Paused' && (
        <div className='appliance-paused-row'>
          <Icon icon='mdi:plus-circle-outline' aria-hidden='true' />
          <span>Paused</span>
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
          historyKey='dishwasher-picker'
          title='Program'
          options={options}
          current={programmeSelect?.state ?? ''}
          onPick={handlePick(handleProgrammeChange)}
          onClose={() => setOpenPicker(null)}
        />
      )}
      {openPicker === 'short' && (
        <AppliancePickerSheet
          accentClassName={ACCENT_CLASS}
          glyphIcon={GLYPH_ICON}
          historyKey='dishwasher-picker'
          title='Short'
          options={SHORT_OPTIONS}
          current={shortSelect?.state ?? '—'}
          onPick={handlePick(handleShortChange)}
          onClose={() => setOpenPicker(null)}
          renderOption={formatShortLabel}
        />
      )}
      {historyOpen && (
        <ApplianceHistorySheet
          accentClassName={ACCENT_CLASS}
          historyKey='dishwasher-history'
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
 * interactive (state has no editable settings right now). */
function DishwasherChip({ label, isInteractive, onClick }: { label: string; isInteractive: boolean; onClick: () => void }) {
  if (!isInteractive) return <span className='appliance-chip muted'>{label}</span>;
  return (
    <button type='button' className='appliance-chip' onClick={onClick}>
      {label}
    </button>
  );
}
