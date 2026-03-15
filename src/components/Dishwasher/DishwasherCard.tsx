import { useState, useEffect, useCallback } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import './DishwasherCard.css';

const DISHWASHER_STATE_ID = 'sensor.dishwasher_state';
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

export function DishwasherCard({ entities, callService }: DishwasherCardProps) {
  const dishwasher = entities?.[DISHWASHER_STATE_ID];
  const programmeSelect = entities?.[PROGRAMME_SELECT_ID];
  const shortSelect = entities?.[SHORT_SELECT_ID];

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

  if (!dishwasher) return null;

  const rawState = (dishwasher.state?.trim() || 'Off').toLowerCase();
  const attrs = dishwasher.attributes || {};
  let state: DishwasherState = (dishwasher.state?.trim() || 'Off') as DishwasherState;
  if (rawState === 'on') {
    const hasRunningAttrs =
      attrs.estimated_remaining_min != null ||
      attrs.programme_duration_min != null ||
      (attrs.progress_pct != null && attrs.progress_pct !== '');
    const hasUnemptiedAttrs = attrs.run_time_minutes != null || attrs.energy_used != null;
    if (hasUnemptiedAttrs) state = 'Unemptied';
    else if (hasRunningAttrs || attrs.programme_label || attrs.detected_programme) state = 'Running';
  } else if (rawState === 'off') {
    state = 'Off';
  }

  if (state === 'Off' || state === 'Emptied') return null;

  const programmeLabel = (attrs.programme_label as string) || programmeSelect?.state || '—';
  const options: string[] = Array.isArray(programmeSelect?.attributes?.options) ? (programmeSelect.attributes.options as string[]) : [];
  const remainingMin = attrs.estimated_remaining_min != null ? Number(attrs.estimated_remaining_min) : undefined;
  const totalMin = attrs.programme_duration_min != null ? Number(attrs.programme_duration_min) : undefined;
  const cycleStartTime = attrs.cycle_start_time as string | undefined;
  const cycleStartTimeLocal = attrs.cycle_start_time_local as string | undefined;
  const startedAtDisplay = attrs.started_at_display as string | undefined;
  const estimatedEndTime = attrs.estimated_end_time as string | undefined;
  const runTimeMinutes = attrs.run_time_minutes != null ? Number(attrs.run_time_minutes) : undefined;
  const energyUsed = attrs.energy_used != null ? Number(attrs.energy_used) : undefined;

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
  const hasCountdownLine =
    state === 'Running' &&
    ((cycleStartTime && String(cycleStartTime).trim() !== '') || (startedAtDisplay && String(startedAtDisplay).trim() !== ''));
  const countdownLabel = remainingMin == null ? null : remainingMin <= 0 ? 'Almost done' : `${formatDuration(remainingMin)} left`;

  const startedDisplay =
    startedAtDisplay && String(startedAtDisplay).trim() !== ''
      ? String(startedAtDisplay).trim().slice(0, 5)
      : formatTimeOnly(cycleStartTimeLocal || cycleStartTime);

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

  const headerIcon = state === 'Running' ? 'mdi:dishwasher' : state === 'Unemptied' ? 'mdi:basket-outline' : 'mdi:dishwasher';

  const cyclesNewestFirst = feedbackData?.cycles ? [...feedbackData.cycles].reverse() : [];

  return (
    <div className={`dishwasher-card state-${state.toLowerCase()}`}>
      <div className='dishwasher-header'>
        <div className='dishwasher-title-row'>
          <span className={`dishwasher-icon-wrap ${state === 'Running' ? 'dancing' : ''}`}>
            <Icon icon={headerIcon} className='dishwasher-icon' />
          </span>
          <span className='dishwasher-label'>Dishwasher</span>
        </div>
        <span className='dishwasher-state-badge'>{state}</span>
      </div>

      <div className='dishwasher-body'>
        <div className='dishwasher-row programme-row'>
          <span className='dishwasher-field-label'>Programme:</span>
          {isInteractive && options.length > 0 ? (
            <select
              className='dishwasher-programme-select'
              value={programmeSelect?.state ?? ''}
              onChange={e => handleProgrammeChange(e.target.value)}
              aria-label='Programme'
            >
              {options.map(opt => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : (
            <span className={`dishwasher-programme-value ${!isInteractive ? 'muted' : ''}`}>{programmeLabel}</span>
          )}
        </div>

        {(state === 'Running' || state === 'Unemptied') && shortSelect && (
          <div className='dishwasher-row short-row'>
            <span className='dishwasher-field-label'>Short:</span>
            <select
              className='dishwasher-programme-select'
              value={shortSelect.state ?? '—'}
              onChange={e => handleShortChange(e.target.value)}
              aria-label='Short programme'
            >
              {SHORT_OPTIONS.map(opt => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}

        {state === 'Running' && (
          <>
            {hasProgressBar && (
              <div className='dishwasher-progress'>
                <div className='dishwasher-progress-bar'>
                  <div className='dishwasher-progress-fill' style={{ width: `${progressPct}%` }} />
                </div>
                <span className='dishwasher-progress-pct'>{Math.round(progressPct)}%</span>
              </div>
            )}
            <div className='dishwasher-countdown-line'>
              {hasCountdownLine ? (
                <>
                  {(cycleStartTime || startedAtDisplay) && <>Started {startedDisplay}</>}
                  {(cycleStartTime || startedAtDisplay) && estimatedEndTime && ' · '}
                  {estimatedEndTime && <>Done ~{formatTimeOnly(estimatedEndTime)}</>}
                  {countdownLabel && <> · {countdownLabel}</>}
                </>
              ) : (
                <span className='dishwasher-running-placeholder'>Running…</span>
              )}
            </div>
          </>
        )}

        {state === 'Paused' && (
          <div className='dishwasher-banner paused'>
            <Icon icon='mdi:plus-circle-outline' />
            <span>Adding items…</span>
          </div>
        )}

        {state === 'Unemptied' && (
          <>
            {(runTimeMinutes != null || energyUsed != null) && (
              <div className='dishwasher-stats'>
                {runTimeMinutes != null && <span>Ran {formatDuration(runTimeMinutes)}</span>}
                {runTimeMinutes != null && energyUsed != null && ' · '}
                {energyUsed != null && <span>Used {Number(energyUsed).toFixed(2)} kWh</span>}
              </div>
            )}
            <div className='dishwasher-banner unemptied'>
              <Icon icon='mdi:alert-circle-outline' />
              <span>Please empty the dishwasher</span>
            </div>
          </>
        )}

        {/* Cycle history - only when feedback URL is set */}
        <div className='dishwasher-history-section'>
          <div className='dishwasher-history-title'>
            <Icon icon='mdi:history' />
            Cycle history
          </div>
          {!feedbackUrl ? (
            <p className='dishwasher-history-configure'>Configure VITE_DISHWASHER_FEEDBACK_URL to see and confirm cycles.</p>
          ) : feedbackLoading && !feedbackData ? (
            <p className='dishwasher-history-loading'>Loading…</p>
          ) : feedbackError ? (
            <p className='dishwasher-history-error'>
              {feedbackError}
              <button type='button' onClick={fetchFeedback} style={{ marginLeft: '0.5rem', textDecoration: 'underline' }}>
                Retry
              </button>
            </p>
          ) : cyclesNewestFirst.length === 0 ? (
            <p className='dishwasher-history-empty'>No cycles recorded yet.</p>
          ) : (
            <div className='dishwasher-history-list'>
              {cyclesNewestFirst.map((cycle, index) => {
                const predictedLabel = PROGRAMME_KEY_TO_LABEL[cycle.predicted] ?? cycle.predicted;
                const confirmedLabel = PROGRAMME_KEY_TO_LABEL[cycle.confirmed] ?? cycle.confirmed;
                const isUnconfirmed = !cycle.programme_confirmed_by_human;
                const isSaving = savingCycleIndex === index;
                return (
                  <div key={`${cycle.ts}-${index}`} className={`dishwasher-cycle-row ${isUnconfirmed ? 'unconfirmed' : ''}`}>
                    <span className='dishwasher-cycle-ts'>{formatCycleTs(cycle.ts)}</span>
                    <span className='dishwasher-cycle-duration'>{formatDuration(cycle.duration_min)}</span>
                    <span className='dishwasher-cycle-energy'>{cycle.energy_kwh.toFixed(2)} kWh</span>
                    <span className='dishwasher-cycle-programme' title={isUnconfirmed ? 'Predicted (unconfirmed)' : 'Confirmed'}>
                      {isUnconfirmed ? predictedLabel : confirmedLabel}
                      {isUnconfirmed && ' (?)'}
                    </span>
                    <div className='dishwasher-cycle-actions'>
                      {isUnconfirmed && (
                        <>
                          <select
                            aria-label='Correct programme'
                            value={cycleSelection[index] ?? cycle.predicted}
                            onChange={e => setCycleSelection(prev => ({ ...prev, [index]: e.target.value }))}
                            disabled={isSaving}
                          >
                            {PROGRAMME_KEYS.map(k => (
                              <option key={k} value={k}>
                                {PROGRAMME_KEY_TO_LABEL[k]}
                              </option>
                            ))}
                          </select>
                          <button
                            type='button'
                            onClick={() => handleConfirmCycle(index)}
                            disabled={isSaving}
                            aria-label='Confirm programme'
                          >
                            Confirm
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
