import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@iconify/react';
import { useHass } from '@hakit/core';
import type { HassEntities, CallServiceFunction } from '../../types';
import { resolveDishwasherSemanticState } from '../../utils/dishwasherSemanticState';
import { formatKr } from '../../utils/format';
import { fireHaEvent } from '../../utils/haEvents';
import { useRunCost } from '../../energy';
import { ApplianceCycleTiming } from '../ApplianceCycleTiming';
import { useLocalStorageBoolean, useModalBackButton, useSwipeToClose, useTouchScrollSlopGuard } from '../../hooks';
import './DishwasherCard.css';

const DISHWASHER_STATE_ID = 'sensor.dishwasher_state';
const DISHWASHER_INPUT_STATE_ID = 'input_select.dishwasher_state';
const PROGRAMME_SELECT_ID = 'input_select.dishwasher_confirmed_programme';
const SHORT_SELECT_ID = 'input_select.dishwasher_short';

const SHORT_OPTIONS = ['—', 'Yes', 'No'] as const;

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

export interface DishwasherCycle {
  ts: string;
  duration_min: number;
  energy_kwh: number;
  predicted: string;
  confirmed: string;
  programme_confirmed_by_human: boolean;
  max_power_w?: number;
  duration_source?: string;
  end_reason?: string;
  idle_min?: number;
}

export interface DishwasherFeedbackJson {
  version: number;
  cycles: DishwasherCycle[];
}

interface DishwasherCardProps {
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

function formatTimeOnly(isoOrTime: string | undefined): string {
  if (!isoOrTime) return '--:--';
  const s = String(isoOrTime).trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s.slice(0, 5);
  try {
    const d = new Date(isoOrTime);
    if (Number.isNaN(d.getTime())) return s.slice(0, 5);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return s.slice(0, 5);
  }
}

function formatDuration(minutes: number | undefined): string {
  if (minutes === undefined || minutes === null || Number.isNaN(minutes)) return '--';
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return min > 0 ? `${h}h ${min}m` : `${h}h`;
}

function formatCycleTs(ts: string): string {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts.slice(0, 16);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return ts.slice(0, 16);
  }
}

function getFeedbackUrl(): string | null {
  const url = (import.meta.env.VITE_DISHWASHER_FEEDBACK_URL as string)?.trim();
  return url && url.length > 0 ? url : null;
}

type DishwasherPicker = 'programme' | 'short' | null;

/** One generic picker sheet: a row per option, current selection checked in the dishwasher accent. */
interface PickerSheetProps {
  title: string;
  options: readonly string[];
  current: string;
  onPick: (option: string) => void;
  onClose: () => void;
}

function DishwasherPickerSheet({ title, options, current, onPick, onClose }: PickerSheetProps) {
  const { requestClose } = useModalBackButton({ isOpen: true, onRequestClose: onClose, historyKey: 'dishwasher-picker' });
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(requestClose);

  return createPortal(
    <div className='dishwasher-modal-overlay' onClick={requestClose}>
      <div
        className='dishwasher-sheet'
        role='dialog'
        aria-modal='true'
        onClick={e => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className='dishwasher-sheet-top'>
          <span className='dishwasher-glyph'>
            <Icon icon='mdi:dishwasher' aria-hidden='true' />
          </span>
          <span className='dishwasher-title'>{title}</span>
          <button className='dishwasher-sheet-close modal-close-button' onClick={requestClose} aria-label='Close'>
            <Icon icon='mdi:close' />
          </button>
        </div>
        <div className='dishwasher-sheet-body'>
          {options.map(opt => (
            <button key={opt} type='button' className='dishwasher-sheet-row' onClick={() => onPick(opt)}>
              <span>{opt}</span>
              {opt === current && <Icon icon='mdi:check' className='dishwasher-sheet-check' aria-hidden='true' />}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

interface HistorySheetProps {
  cyclesNewestFirst: DishwasherCycle[];
  hasFeedbackData: boolean;
  feedbackLoading: boolean;
  feedbackError: string | null;
  fetchFeedback: () => void;
  cycleSelection: Record<number, string>;
  setCycleSelection: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  savingCycleIndex: number | null;
  handleConfirmCycle: (index: number) => void;
  programmeKeys: string[];
  onClose: () => void;
}

function DishwasherHistorySheet({
  cyclesNewestFirst,
  hasFeedbackData,
  feedbackLoading,
  feedbackError,
  fetchFeedback,
  cycleSelection,
  setCycleSelection,
  savingCycleIndex,
  handleConfirmCycle,
  programmeKeys,
  onClose,
}: HistorySheetProps) {
  const { requestClose } = useModalBackButton({ isOpen: true, onRequestClose: onClose, historyKey: 'dishwasher-history' });
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(requestClose);

  return createPortal(
    <div className='dishwasher-modal-overlay' onClick={requestClose}>
      <div
        className='dishwasher-sheet'
        role='dialog'
        aria-modal='true'
        onClick={e => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className='dishwasher-sheet-top'>
          <span className='dishwasher-glyph'>
            <Icon icon='mdi:history' aria-hidden='true' />
          </span>
          <span className='dishwasher-title'>Cycle history</span>
          <button className='dishwasher-sheet-close modal-close-button' onClick={requestClose} aria-label='Close'>
            <Icon icon='mdi:close' />
          </button>
        </div>
        <div className='dishwasher-sheet-body'>
          {feedbackLoading && !hasFeedbackData ? (
            <p className='dishwasher-history-note'>Loading…</p>
          ) : feedbackError ? (
            <p className='dishwasher-history-note error'>
              {feedbackError}
              <button type='button' className='dishwasher-history-retry' onClick={fetchFeedback}>
                Retry
              </button>
            </p>
          ) : cyclesNewestFirst.length === 0 ? (
            <p className='dishwasher-history-note'>No cycles recorded yet.</p>
          ) : (
            <div className='dishwasher-history-list'>
              {cyclesNewestFirst.map((cycle, index) => {
                const predictedLabel = PROGRAMME_KEY_TO_LABEL[cycle.predicted] ?? cycle.predicted;
                const confirmedLabel = PROGRAMME_KEY_TO_LABEL[cycle.confirmed] ?? cycle.confirmed;
                const isUnconfirmed = !cycle.programme_confirmed_by_human;
                const isSaving = savingCycleIndex === index;
                return (
                  <div key={`${cycle.ts}-${index}`} className='dishwasher-history-row'>
                    <div className='dishwasher-history-line'>
                      <span className='dishwasher-history-ts'>{formatCycleTs(cycle.ts)}</span>
                      <span>{formatDuration(cycle.duration_min)}</span>
                      <span>{cycle.energy_kwh.toFixed(2)} kWh</span>
                      <span className='dishwasher-history-programme' title={isUnconfirmed ? 'Predicted (unconfirmed)' : 'Confirmed'}>
                        {isUnconfirmed ? predictedLabel : confirmedLabel}
                        {isUnconfirmed && <span className='dishwasher-history-unconfirmed-mark'>?</span>}
                      </span>
                    </div>
                    {isUnconfirmed && (
                      <div className='dishwasher-history-confirm'>
                        <select
                          className='dishwasher-history-select'
                          aria-label='Correct programme'
                          value={cycleSelection[index] ?? cycle.predicted}
                          onChange={e => setCycleSelection(prev => ({ ...prev, [index]: e.target.value }))}
                          disabled={isSaving}
                        >
                          {programmeKeys.map(k => (
                            <option key={k} value={k}>
                              {PROGRAMME_KEY_TO_LABEL[k] ?? k}
                            </option>
                          ))}
                        </select>
                        <button
                          type='button'
                          className='dishwasher-history-confirm-btn'
                          onClick={() => handleConfirmCycle(index)}
                          disabled={isSaving}
                          aria-label='Confirm programme'
                        >
                          <Icon
                            icon={isSaving ? 'mdi:loading' : 'mdi:check'}
                            className={isSaving ? 'dishwasher-spin' : ''}
                            aria-hidden='true'
                          />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function DishwasherCard({ entities, callService }: DishwasherCardProps) {
  const dishwasher = entities?.[DISHWASHER_STATE_ID];
  const dishwasherInputState = entities?.[DISHWASHER_INPUT_STATE_ID];
  const programmeSelect = entities?.[PROGRAMME_SELECT_ID];
  const shortSelect = entities?.[SHORT_SELECT_ID];

  const [collapsed, setCollapsed] = useLocalStorageBoolean('dishwashercard-collapsed', true);
  const headerSlop = useTouchScrollSlopGuard();
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
    <div className='dishwasher-chips'>
      <DishwasherChip label={programmeLabel} isInteractive={isInteractive} onClick={() => setOpenPicker('programme')} />
      {shortSelect && (
        <DishwasherChip label={shortSelect.state ?? '—'} isInteractive={isInteractive} onClick={() => setOpenPicker('short')} />
      )}
    </div>
  );

  return (
    <div className='dishwasher-card'>
      <div
        className='dishwasher-header'
        onClick={() => {
          if (headerSlop.consumeBlockClick()) return;
          setCollapsed(v => !v);
        }}
        onTouchStart={headerSlop.onTouchStart}
        onTouchMove={headerSlop.onTouchMove}
        onTouchEnd={headerSlop.onTouchEnd}
        onTouchCancel={headerSlop.onTouchCancel}
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
        <span className='dishwasher-glyph'>
          <Icon icon='mdi:dishwasher' aria-hidden='true' />
        </span>
        <span className='dishwasher-title'>Dishwasher</span>
        {collapsed && state === 'Unemptied' && hasConnection && (
          <span className='dishwasher-quick' onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} role='presentation'>
            <button
              type='button'
              className='dishwasher-quick-btn'
              onClick={handleForceEmptied}
              disabled={emptiedPressed}
              aria-label='Mark the dishwasher as emptied'
              title='Mark emptied'
            >
              <Icon
                icon={emptiedPressed ? 'mdi:loading' : 'mdi:basket-outline'}
                className={emptiedPressed ? 'dishwasher-spin' : ''}
                aria-hidden='true'
              />
            </button>
          </span>
        )}
        <span className='dishwasher-header-right'>
          <span className={`dishwasher-word ${stateWordClass}`}>{stateWord}</span>
          <Icon icon={collapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'} aria-hidden='true' className='dishwasher-chevron' />
        </span>
      </div>

      {collapsed && state === 'Running' && (
        <div className='dishwasher-collapsed-strip'>
          <div className='dishwasher-collapsed-strip-fill' style={{ width: `${progressPct}%` }} />
        </div>
      )}

      {!collapsed && (
        <div className='dishwasher-content'>
          {state === 'Running' && (
            <>
              {showProgressStrip ? (
                <div className='dishwasher-cycle-strip'>
                  <div className='dishwasher-cycle-bar'>
                    <div className='dishwasher-cycle-track'>
                      <div className='dishwasher-cycle-fill' style={{ width: `${progressPct}%` }} />
                    </div>
                    <div className='dishwasher-cycle-now' style={{ left: `${progressPct}%` }} />
                  </div>
                  <div className='dishwasher-cycle-meta'>
                    {hasStartedDisplay && <span className='dishwasher-cycle-meta-start'>{startedDisplay}</span>}
                    {countdownLabel != null && <span className='dishwasher-cycle-meta-countdown'>{countdownLabel}</span>}
                    {estimatedEndTime && String(estimatedEndTime).trim() !== '' && (
                      <span className='dishwasher-cycle-meta-end'>~{formatTimeOnly(estimatedEndTime)}</span>
                    )}
                  </div>
                </div>
              ) : (
                <div className='dishwasher-timing-line'>
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
                <div className='dishwasher-footer'>
                  {energyUsed != null && (
                    <span className='dishwasher-footer-item'>
                      <Icon icon='mdi:flash' aria-hidden='true' />
                      {Number(energyUsed).toFixed(2)} kWh
                    </span>
                  )}
                  {liveCostKr != null && <span className='dishwasher-footer-item'>≈ {formatKr(liveCostKr)}</span>}
                  {feedbackUrl && (
                    <span className='dishwasher-footer-actions'>
                      <button
                        type='button'
                        className='dishwasher-footer-icon-btn'
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
            <div className='dishwasher-paused-row'>
              <Icon icon='mdi:plus-circle-outline' aria-hidden='true' />
              <span>Paused</span>
            </div>
          )}

          {state === 'Unemptied' && (
            <>
              <div className='dishwasher-hero'>
                <span className='dishwasher-hero-icon'>
                  <Icon icon='mdi:basket-outline' aria-hidden='true' />
                </span>
                <span className='dishwasher-hero-text'>
                  {doneAtDisplay && <span className='dishwasher-hero-line1'>Done {doneAtDisplay}</span>}
                  {heroLine2 && <span className='dishwasher-hero-line2'>{heroLine2}</span>}
                </span>
                {hasConnection && (
                  <button
                    type='button'
                    className='dishwasher-emptied-pill'
                    onClick={handleForceEmptied}
                    disabled={emptiedPressed}
                    aria-busy={emptiedPressed}
                  >
                    <Icon
                      icon={emptiedPressed ? 'mdi:loading' : 'mdi:check'}
                      className={emptiedPressed ? 'dishwasher-spin' : ''}
                      aria-hidden='true'
                    />
                    <span>Emptied</span>
                  </button>
                )}
              </div>

              {renderChips()}

              {(runTimeMinutes != null || energyUsed != null || runCostKr != null || feedbackUrl) && (
                <div className='dishwasher-footer'>
                  {runTimeMinutes != null && (
                    <span className='dishwasher-footer-item'>
                      <Icon icon='mdi:clock-outline' aria-hidden='true' />
                      Ran {formatDuration(runTimeMinutes)}
                    </span>
                  )}
                  {energyUsed != null && (
                    <span className='dishwasher-footer-item'>
                      <Icon icon='mdi:flash' aria-hidden='true' />
                      {Number(energyUsed).toFixed(2)} kWh
                    </span>
                  )}
                  {runCostKr != null && <span className='dishwasher-footer-item'>≈ {formatKr(runCostKr)}</span>}
                  {feedbackUrl && (
                    <span className='dishwasher-footer-actions'>
                      <button
                        type='button'
                        className='dishwasher-footer-icon-btn'
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
        </div>
      )}

      {openPicker === 'programme' && (
        <DishwasherPickerSheet
          title='Programme'
          options={options}
          current={programmeSelect?.state ?? ''}
          onPick={handlePick(handleProgrammeChange)}
          onClose={() => setOpenPicker(null)}
        />
      )}
      {openPicker === 'short' && (
        <DishwasherPickerSheet
          title='Short'
          options={SHORT_OPTIONS}
          current={shortSelect?.state ?? '—'}
          onPick={handlePick(handleShortChange)}
          onClose={() => setOpenPicker(null)}
        />
      )}
      {historyOpen && (
        <DishwasherHistorySheet
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
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}

/** A setting's current value as a tappable pill — a plain muted span when the card isn't
 * interactive (state has no editable settings right now). */
function DishwasherChip({ label, isInteractive, onClick }: { label: string; isInteractive: boolean; onClick: () => void }) {
  if (!isInteractive) return <span className='dishwasher-chip muted'>{label}</span>;
  return (
    <button type='button' className='dishwasher-chip' onClick={onClick}>
      {label}
    </button>
  );
}
