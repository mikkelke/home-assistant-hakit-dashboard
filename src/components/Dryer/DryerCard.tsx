import { useState, useEffect, useCallback } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import { ApplianceCycleTiming } from '../ApplianceCycleTiming';
import {
  DRYER_ANNOUNCE_BOOLEAN,
  DRYER_DRYNESS_SELECT,
  DRYER_PROGRAMME_SELECT,
  DRYER_SKANE_PLUS_BOOLEAN,
  DRYER_STATE_ENTITY,
  DRYER_TIME_MINUTES_SELECT,
} from '../../config/entities';
import './DryerCard.css';

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

export interface DryerCycle {
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

export interface DryerFeedbackJson {
  version: number;
  cycles: DryerCycle[];
}

interface DryerCardProps {
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
  const url = (import.meta.env.VITE_DRYER_FEEDBACK_URL as string)?.trim();
  return url && url.length > 0 ? url : null;
}

export function DryerCard({ entities, callService }: DryerCardProps) {
  const dryer = entities?.[DRYER_STATE_ID];
  const programmeSelect = entities?.[PROGRAMME_SELECT_ID];
  const drynessSelect = entities?.[DRYNESS_SELECT_ID];
  const skanePlusToggle = entities?.[SKANE_PLUS_TOGGLE_ID];
  const timeSelect = entities?.[TIME_SELECT_ID];
  const announceToggle = entities?.[ANNOUNCE_TOGGLE_ID];

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

  if (!dryer) return null;

  const rawState = (dryer.state?.trim() || 'Off').toLowerCase();
  const attrs = dryer.attributes || {};
  let state: DryerState = (dryer.state?.trim() || 'Off') as DryerState;
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
  const cycleStartTime = attrs.cycle_start_time as string | undefined;
  const startedAtDisplay = attrs.started_at_display as string | undefined;
  const estimatedEndTime = attrs.estimated_end_time as string | undefined;
  const runTimeMinutes = attrs.run_time_minutes != null ? Number(attrs.run_time_minutes) : undefined;
  const energyUsed = attrs.energy_used != null ? Number(attrs.energy_used) : undefined;
  const keepFreshDetected = attrs.keep_fresh_detected as boolean | undefined;

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

  // "Started HH:MM": prefer started_at_display if time-only (HH:MM); if ISO datetime, format to time; else use cycle_start_time
  const startedDisplay = (() => {
    const s = startedAtDisplay && String(startedAtDisplay).trim();
    if (!s) return formatTimeOnly(cycleStartTime);
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s.slice(0, 5);
    if (/^\d{4}-\d{2}/.test(s) || s.includes('T')) return formatTimeOnly(s);
    return formatTimeOnly(cycleStartTime);
  })();

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

  const headerIcon = state === 'Running' ? 'mdi:tumble-dryer' : state === 'Unemptied' ? 'mdi:basket-outline' : 'mdi:tumble-dryer';

  const cyclesNewestFirst = feedbackData?.cycles ? [...feedbackData.cycles].reverse() : [];

  return (
    <div className={`dryer-card state-${state.toLowerCase()}`}>
      <div className='dryer-header'>
        <div className='dryer-title-row'>
          <span className={`dryer-icon-wrap ${state === 'Running' ? 'dancing' : ''}`}>
            <Icon icon={headerIcon} className='dryer-icon' />
          </span>
          <span className='dryer-label'>Dryer</span>
        </div>
        <span className='dryer-state-badge'>{state}</span>
      </div>

      <div className='dryer-body'>
        <div className='dryer-row programme-row'>
          <span className='dryer-field-label'>Programme:</span>
          {isInteractive && programmeSelect && options.length > 0 ? (
            <select
              className='dryer-programme-select'
              value={programmeSelect.state ?? ''}
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
            <span className={`dryer-programme-value ${!isInteractive ? 'muted' : ''}`}>{programmeLabel}</span>
          )}
        </div>

        {showDryness && drynessSelect && (state === 'Running' || state === 'Unemptied' || state === 'Paused') && (
          <div className='dryer-row dryness-row'>
            <span className='dryer-field-label'>Dryness:</span>
            {isInteractive ? (
              <select
                className='dryer-programme-select'
                value={drynessSelect.state ?? ''}
                onChange={e => handleDrynessChange(e.target.value)}
                aria-label='Dryness'
              >
                {((drynessSelect.attributes?.options as string[]) || []).map((opt: string) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <span className='dryer-programme-value muted'>{drynessSelect.state ?? '—'}</span>
            )}
          </div>
        )}

        {lockSkaneOn && (state === 'Running' || state === 'Unemptied' || state === 'Paused') && (
          <div className='dryer-row skane-row'>
            <span className='dryer-field-label'>Skåne +:</span>
            <span className='dryer-programme-value muted'>Always on</span>
          </div>
        )}
        {showSkane && !lockSkaneOn && skanePlusToggle && (state === 'Running' || state === 'Unemptied' || state === 'Paused') && (
          <div className='dryer-row skane-row'>
            <span className='dryer-field-label'>Skåne +:</span>
            <button
              type='button'
              className={`dryer-skane-toggle ${skanePlusToggle.state === 'on' ? 'on' : 'off'}`}
              onClick={handleSkanePlusToggle}
              aria-pressed={skanePlusToggle.state === 'on'}
              aria-label='Skåne + (gentle)'
            >
              <div className='dryer-skane-switch' />
            </button>
          </div>
        )}

        {showTime && timeSelect && (state === 'Running' || state === 'Unemptied' || state === 'Paused') && (
          <div className='dryer-row time-row'>
            <span className='dryer-field-label'>Time (min):</span>
            {isInteractive ? (
              <select
                className='dryer-programme-select'
                value={timeSelect.state ?? ''}
                onChange={e => handleTimeChange(e.target.value)}
                aria-label='Time in minutes'
              >
                {((timeSelect.attributes?.options as string[]) || []).map((opt: string) => (
                  <option key={opt} value={opt}>
                    {opt} min
                  </option>
                ))}
              </select>
            ) : (
              <span className='dryer-programme-value muted'>{timeSelect.state ? `${timeSelect.state} min` : '—'}</span>
            )}
          </div>
        )}

        {announceToggle && (state === 'Running' || state === 'Unemptied' || state === 'Paused') && (
          <div className='dryer-row announce-row'>
            <Icon icon='mdi:bell' />
            <span className='dryer-field-label'>Announce when finished</span>
            <button
              type='button'
              className={`dryer-announce-toggle ${announceToggle.state === 'on' ? 'on' : 'off'}`}
              onClick={handleAnnounceToggle}
              aria-pressed={announceToggle.state === 'on'}
              aria-label={announceToggle.state === 'on' ? 'Announce on' : 'Announce off'}
            >
              <div className='dryer-announce-switch' />
            </button>
          </div>
        )}

        {state === 'Running' && (
          <>
            {hasProgressBar && (
              <div className='dryer-progress'>
                <div className='dryer-progress-bar'>
                  <div className='dryer-progress-fill' style={{ width: `${progressPct}%` }} />
                </div>
                <span className='dryer-progress-pct'>{Math.round(progressPct)}%</span>
              </div>
            )}
            <div className='dryer-countdown-line'>
              <ApplianceCycleTiming
                hasDetail={showApplianceTimingDetail}
                startedDisplay={startedDisplay}
                estimatedEndTime={estimatedEndTime}
                countdownLabel={countdownLabel}
                formatTimeOnly={formatTimeOnly}
              />
            </div>
          </>
        )}

        {state === 'Paused' && (
          <div className='dryer-banner paused'>
            <Icon icon='mdi:plus-circle-outline' />
            <span>Adding items…</span>
          </div>
        )}

        {state === 'Unemptied' && (
          <>
            {(runTimeMinutes != null || energyUsed != null) && (
              <div className='dryer-stats'>
                {runTimeMinutes != null && <span>Ran {formatDuration(runTimeMinutes)}</span>}
                {runTimeMinutes != null && energyUsed != null && ' · '}
                {energyUsed != null && <span>Used {Number(energyUsed).toFixed(2)} kWh</span>}
                {keepFreshDetected && ' · Keep fresh detected'}
              </div>
            )}
            <div className='dryer-banner unemptied'>
              <Icon icon='mdi:alert-circle-outline' />
              <span>Please empty the dryer</span>
            </div>
          </>
        )}

        {feedbackUrl && (
          <div className='dryer-history-section'>
            <div className='dryer-history-title'>
              <Icon icon='mdi:history' />
              Cycle history
            </div>
            {feedbackLoading && !feedbackData ? (
              <p className='dryer-history-loading'>Loading…</p>
            ) : feedbackError ? (
              <p className='dryer-history-error'>
                {feedbackError}
                <button type='button' onClick={fetchFeedback} style={{ marginLeft: '0.5rem', textDecoration: 'underline' }}>
                  Retry
                </button>
              </p>
            ) : cyclesNewestFirst.length === 0 ? (
              <p className='dryer-history-empty'>No cycles recorded yet.</p>
            ) : (
              <div className='dryer-history-list'>
                {cyclesNewestFirst.map((cycle, index) => {
                  const predictedLabel = PROGRAMME_KEY_TO_LABEL[cycle.predicted] ?? cycle.predicted;
                  const confirmedLabel = PROGRAMME_KEY_TO_LABEL[cycle.confirmed] ?? cycle.confirmed;
                  const isUnconfirmed = !cycle.programme_confirmed_by_human;
                  const isSaving = savingCycleIndex === index;
                  return (
                    <div key={`${cycle.ts}-${index}`} className={`dryer-cycle-row ${isUnconfirmed ? 'unconfirmed' : ''}`}>
                      <span className='dryer-cycle-ts'>{formatCycleTs(cycle.ts)}</span>
                      <span className='dryer-cycle-duration'>{formatDuration(cycle.duration_min)}</span>
                      <span className='dryer-cycle-energy'>{cycle.energy_kwh.toFixed(2)} kWh</span>
                      <span className='dryer-cycle-programme' title={isUnconfirmed ? 'Predicted (unconfirmed)' : 'Confirmed'}>
                        {isUnconfirmed ? predictedLabel : confirmedLabel}
                        {isUnconfirmed && ' (?)'}
                      </span>
                      <div className='dryer-cycle-actions'>
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
        )}
      </div>
    </div>
  );
}
