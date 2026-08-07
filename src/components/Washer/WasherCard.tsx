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
import './WasherCard.css';

const ACCENT_CLASS = 'appliance-accent-washer';
const GLYPH_ICON = 'mdi:washing-machine';

const WASHER_STATE_ID = 'sensor.washer_state';
const PROGRAMME_SELECT_ID = 'input_select.washer_confirmed_programme';
const ANNOUNCE_TOGGLE_ID = 'input_boolean.washer_announce';
const SPIN_SELECT_ID = 'input_select.washer_spin_speed';
const TEMPERATURE_SELECT_ID = 'input_select.washer_temperature';

const SPIN_OPTIONS_ORDER = ['—', '1400 rpm', '1200 rpm', '900 rpm', '700 rpm', 'No spin'];
/** Union of every programme's allowed_temperatures (washer_monitor.py _DEFAULT_PROFILES) - stable,
 * no flash from delayed `options`. Must be updated if a programme profile adds a new temperature. */
const WASHER_TEMPERATURE_OPTIONS = ['-', 'Cold', '20°C', '30°C', '40-60°C', '40°C', '60°C', '90°C'] as const;

/** Programme keys in JSON; display labels for cycle history. Extend to match your washer programmes. */
// eslint-disable-next-line react-refresh/only-export-components -- shared constant for cycle history
export const PROGRAMME_KEY_TO_LABEL: Record<string, string> = {
  bomuld: 'Bomuld',
  bomuld_40: 'Bomuld 40°C',
  bomuld_60: 'Bomuld 60°C',
  finvask: 'Finvask',
  ekspres: 'Ekspres',
  uld: 'Uld',
  håndvask: 'Håndvask',
  unknown: 'Unknown',
};

const PROGRAMME_KEYS = Object.keys(PROGRAMME_KEY_TO_LABEL) as string[];

type WasherState = 'Off' | 'Running' | 'Paused' | 'Unemptied' | 'Emptied';

export type WasherCycle = ApplianceCycle;
export type WasherFeedbackJson = ApplianceFeedbackJson;

interface WasherCardProps {
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

function getFeedbackUrl(): string | null {
  const url = (import.meta.env.VITE_WASHER_FEEDBACK_URL as string)?.trim();
  return url && url.length > 0 ? url : null;
}

type WasherPicker = 'programme' | 'temperature' | 'spin' | null;

export function WasherCard({ entities, callService }: WasherCardProps) {
  const washer = entities?.[WASHER_STATE_ID];
  const programmeSelect = entities?.[PROGRAMME_SELECT_ID];
  const announceToggle = entities?.[ANNOUNCE_TOGGLE_ID];
  const spinSelect = entities?.[SPIN_SELECT_ID];
  const temperatureSelect = entities?.[TEMPERATURE_SELECT_ID];

  const [collapsed, setCollapsed] = useLocalStorageBoolean('washercard-collapsed', true);
  const connection = useHass((s: { connection?: unknown }) => s.connection);
  // `connection` is typed `unknown` (see energy/ws.ts / VacuumCard) — narrow to boolean once so
  // it can gate JSX directly (`unknown && <Jsx/>` doesn't type-check as ReactNode).
  const hasConnection = Boolean(connection);

  // Which picker/history sheet is open (at most one at a time — chips/footer icons open them).
  const [openPicker, setOpenPicker] = useState<WasherPicker>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Press feedback for the "Emptied" action (quick button or hero pill): acknowledges instantly,
  // then the entity flipping to Emptied hides the whole card — that's the real success signal.
  const [emptiedPressed, setEmptiedPressed] = useState(false);
  const emptiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Brief flash on the prediction-confirm disc after a successful auto-confirm.
  const [predictionConfirmed, setPredictionConfirmed] = useState(false);
  const predictionFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (emptiedTimerRef.current) clearTimeout(emptiedTimerRef.current);
      if (predictionFlashTimerRef.current) clearTimeout(predictionFlashTimerRef.current);
    };
  }, []);

  const [feedbackData, setFeedbackData] = useState<WasherFeedbackJson | null>(null);
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
      const data: WasherFeedbackJson = await res.json();
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
    async (payload: WasherFeedbackJson) => {
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

  // No local cache: entities come from parent (useHass); re-render when sensor.washer_state updates.
  // State + the stats-line attributes are resolved unconditionally, before either early return
  // below, because useRunCost is a hook and must run on every render (rules-of-hooks).
  const rawState = (washer?.state?.trim() || 'Off').toLowerCase();
  const attrs = washer?.attributes ?? {};
  // Normalize: HA may send "On"/"Off" instead of "Running"/"Off"; infer from attributes
  let state: WasherState = (washer?.state?.trim() || 'Off') as WasherState;
  if (rawState === 'on') {
    const hasRunningAttrs =
      attrs.estimated_remaining_min != null ||
      attrs.programme_duration_min != null ||
      (attrs.programme_duration_min != null && attrs.cycle_start_time);
    // Run stats (run_time_minutes/energy_used) alone no longer imply a finished cycle — energy_used
    // is now also published live while Running, so only treat them as Unemptied once the cycle has
    // actually ended (cycle_complete flagged, or cycle_start_time cleared).
    const hasEndedCycleAttrs =
      (attrs.run_time_minutes != null || attrs.energy_used != null) &&
      (attrs.cycle_complete === true || attrs.cycle_complete === 'true' || !attrs.cycle_start_time);
    if (hasEndedCycleAttrs) state = 'Unemptied';
    else if (hasRunningAttrs || attrs.programme_label) state = 'Running';
  } else if (rawState === 'off') {
    state = 'Off';
  }

  const runTimeMinutes = attrs.run_time_minutes != null ? Number(attrs.run_time_minutes) : undefined;
  const energyUsed = attrs.energy_used != null ? Number(attrs.energy_used) : undefined;
  // Detection lag: the sensor flips Running -> Unemptied `idle_min` minutes after the real cycle
  // end, unlike the dishwasher/dryer where that transition is immediate.
  const idleMinutes = attrs.idle_min != null ? Number(attrs.idle_min) : undefined;

  const runCostKr = useRunCost({
    mode: 'finished',
    active: state === 'Unemptied',
    endDetectedIso: washer?.last_changed,
    runTimeMinutes,
    idleMinutes,
    energyKwh: energyUsed,
  });
  const liveCostKr = useRunCost({
    mode: 'live',
    active: state === 'Running',
    startIso: typeof attrs.cycle_start_time === 'string' && attrs.cycle_start_time ? attrs.cycle_start_time : undefined,
    endAnchorIso: washer?.last_updated,
    energyKwh: energyUsed,
  });

  if (!washer) return null;

  // Hide the whole card when off or emptied (only show when there's a cycle or something to do)
  if (state === 'Off' || state === 'Emptied') return null;

  const programmeLabel = (attrs.programme_label as string) || programmeSelect?.state || '—';
  const options: string[] = Array.isArray(programmeSelect?.attributes?.options) ? (programmeSelect.attributes.options as string[]) : [];
  const remainingMin = attrs.estimated_remaining_min != null ? Number(attrs.estimated_remaining_min) : undefined;
  const totalMin = attrs.programme_duration_min != null ? Number(attrs.programme_duration_min) : undefined;
  const cycleStartTime = attrs.cycle_start_time as string | undefined; // UTC ISO (backend may set from epoch)
  const cycleStartTimeLocal = attrs.cycle_start_time_local as string | undefined; // ISO in user timezone
  const startedAtDisplay = attrs.started_at_display as string | undefined; // "HH:MM" in user timezone — use as-is for "Started"
  const estimatedEndTime = attrs.estimated_end_time as string | undefined; // "HH:MM" in user timezone — use as-is
  const spinRpm = attrs.spin_rpm !== undefined && attrs.spin_rpm !== null ? Number(attrs.spin_rpm) : undefined;

  const predictedProgrammeLabel = (attrs.predicted_programme_label as string | undefined)?.trim();
  const predictedProgramme = (attrs.predicted_programme as string | undefined)?.trim();
  const predictedTemperature = (attrs.predicted_temperature as string | undefined)?.trim();
  const predictionDisplay = predictedProgrammeLabel || [predictedProgramme, predictedTemperature].filter(Boolean).join(' · ') || '';
  const confirmSelectState = programmeSelect?.state ?? '';
  const looksLikeAutoUnconfirmed = /auto/i.test(confirmSelectState) && /unconfirmed/i.test(confirmSelectState);
  const showPredictedProgramme =
    (state === 'Running' || state === 'Paused') &&
    predictionDisplay.length > 0 &&
    (attrs.programme_confirmed_by_user === false || (attrs.programme_confirmed_by_user !== true && looksLikeAutoUnconfirmed));

  // Progress: only when Running; backend clears progress attrs when Off/Unemptied/Emptied
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
  const showApplianceTimingDetail =
    state === 'Running' &&
    ((cycleStartTime && String(cycleStartTime).trim() !== '') ||
      (startedAtDisplay && String(startedAtDisplay).trim() !== '') ||
      countdownLabel != null ||
      (estimatedEndTime != null && String(estimatedEndTime).trim() !== ''));
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

  const isInteractive = state === 'Running' || state === 'Unemptied';
  const announceOn = announceToggle?.state === 'on';

  const handleProgrammeChange = (option: string) => {
    if (!callService || !programmeSelect) return;
    callService({
      domain: 'input_select',
      service: 'select_option',
      target: { entity_id: PROGRAMME_SELECT_ID },
      serviceData: { option },
    });
  };

  const handleAnnounceToggle = () => {
    if (!callService || !announceToggle) return;
    callService({
      domain: 'input_boolean',
      service: announceOn ? 'turn_off' : 'turn_on',
      target: { entity_id: ANNOUNCE_TOGGLE_ID },
    });
  };

  const spinOpts = spinSelect?.attributes?.options;
  const spinOptions: string[] = Array.isArray(spinOpts) && spinOpts.length > 0 ? (spinOpts as string[]) : SPIN_OPTIONS_ORDER;
  const handleSpinChange = (option: string) => {
    if (!callService) return;
    callService({
      domain: 'input_select',
      service: 'select_option',
      target: { entity_id: SPIN_SELECT_ID },
      serviceData: { option },
    });
  };

  const temperatureOptions: readonly string[] = WASHER_TEMPERATURE_OPTIONS;
  const handleTemperatureChange = (option: string) => {
    if (!callService) return;
    callService({
      domain: 'input_select',
      service: 'select_option',
      target: { entity_id: TEMPERATURE_SELECT_ID },
      serviceData: { option },
    });
  };

  const cyclesNewestFirst = feedbackData?.cycles ? [...feedbackData.cycles].reverse() : [];
  const programmeKeysForHistory = options.length > 0 ? options : PROGRAMME_KEYS;

  // Preferred (attribute-derived) spin label, e.g. "1400 rpm"/"No spin" — falls back to the
  // select's own raw state so the chip and its picker's checkmark still agree.
  const spinLabel = spinRpm !== undefined ? (spinRpm === 0 ? 'No spin' : `${spinRpm} rpm`) : null;
  const spinChipValue = spinLabel ?? spinSelect?.state ?? '—';

  const handlePick = (setter: (option: string) => void) => (option: string) => {
    setter(option);
    setOpenPicker(null);
  };

  const handleForceEmptied = () => {
    if (!connection) return;
    setEmptiedPressed(true);
    if (emptiedTimerRef.current) clearTimeout(emptiedTimerRef.current);
    emptiedTimerRef.current = setTimeout(() => setEmptiedPressed(false), 5000);
    fireHaEvent(connection, 'washer_force_emptied', { reason: 'Dashboard' });
  };

  // Tap the prediction disc: adopt the matching programme option directly (flash to confirm), or
  // fall back to the picker sheet when nothing in the list matches the predicted label.
  const handleConfirmPrediction = () => {
    const predictedLower = predictionDisplay.toLowerCase();
    const match = options.find(opt => {
      const optLower = opt.toLowerCase();
      return optLower === predictedLower || optLower.includes(predictedLower);
    });
    if (match) {
      handleProgrammeChange(match);
      setPredictionConfirmed(true);
      if (predictionFlashTimerRef.current) clearTimeout(predictionFlashTimerRef.current);
      predictionFlashTimerRef.current = setTimeout(() => setPredictionConfirmed(false), 2000);
    } else {
      setOpenPicker('programme');
    }
  };

  const stateWord = state === 'Running' ? 'Running' : state === 'Paused' ? 'Paused' : 'Empty it';
  const stateWordClass = state === 'Running' ? 'tint' : state === 'Unemptied' ? 'alert' : 'muted';

  // "Done HH:MM": the real cycle end, recovered from the Unemptied-flip timestamp minus the
  // backend's known detection lag (idle_min) — omitted entirely when last_changed can't be parsed.
  const lastChangedMs = washer.last_changed ? Date.parse(washer.last_changed) : NaN;
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
      <WasherChip label={programmeLabel} isInteractive={isInteractive} onClick={() => setOpenPicker('programme')} />
      {temperatureSelect && (
        <WasherChip label={temperatureSelect.state ?? '-'} isInteractive={isInteractive} onClick={() => setOpenPicker('temperature')} />
      )}
      {spinSelect && <WasherChip label={spinChipValue} isInteractive={isInteractive} onClick={() => setOpenPicker('spin')} />}
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
        aria-label='Mark the washer as emptied'
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
      title='Washer'
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

          {showPredictedProgramme && (
            <div className='washer-predict-row' role='status'>
              <Icon icon='mdi:lightbulb-outline' className='washer-predict-icon' aria-hidden='true' />
              <span className='washer-predict-text'>We think {predictionDisplay}</span>
              <button
                type='button'
                className={`washer-predict-confirm ${predictionConfirmed ? 'flash' : ''}`}
                onClick={handleConfirmPrediction}
                aria-label={`Confirm ${predictionDisplay}`}
              >
                <Icon icon='mdi:check' aria-hidden='true' />
              </button>
            </div>
          )}

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
          historyKey='washer-picker'
          title='Program'
          options={options}
          current={programmeSelect?.state ?? ''}
          onPick={handlePick(handleProgrammeChange)}
          onClose={() => setOpenPicker(null)}
        />
      )}
      {openPicker === 'temperature' && (
        <AppliancePickerSheet
          accentClassName={ACCENT_CLASS}
          glyphIcon={GLYPH_ICON}
          historyKey='washer-picker'
          title='Temperature'
          options={temperatureOptions}
          current={temperatureSelect?.state ?? '-'}
          onPick={handlePick(handleTemperatureChange)}
          onClose={() => setOpenPicker(null)}
        />
      )}
      {openPicker === 'spin' && (
        <AppliancePickerSheet
          accentClassName={ACCENT_CLASS}
          glyphIcon={GLYPH_ICON}
          historyKey='washer-picker'
          title='Spin'
          options={spinOptions}
          current={spinSelect?.state ?? '—'}
          onPick={handlePick(handleSpinChange)}
          onClose={() => setOpenPicker(null)}
        />
      )}
      {historyOpen && (
        <ApplianceHistorySheet
          accentClassName={ACCENT_CLASS}
          historyKey='washer-history'
          cyclesNewestFirst={cyclesNewestFirst}
          hasFeedbackData={feedbackData !== null}
          feedbackLoading={feedbackLoading}
          feedbackError={feedbackError}
          fetchFeedback={fetchFeedback}
          cycleSelection={cycleSelection}
          setCycleSelection={setCycleSelection}
          savingCycleIndex={savingCycleIndex}
          handleConfirmCycle={handleConfirmCycle}
          programmeKeys={programmeKeysForHistory}
          programmeKeyToLabel={PROGRAMME_KEY_TO_LABEL}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </ApplianceCard>
  );
}

/** A setting's current value as a tappable pill — a plain muted span when the card isn't
 * interactive (state has no editable settings right now). */
function WasherChip({ label, isInteractive, onClick }: { label: string; isInteractive: boolean; onClick: () => void }) {
  if (!isInteractive) return <span className='appliance-chip muted'>{label}</span>;
  return (
    <button type='button' className='appliance-chip' onClick={onClick}>
      {label}
    </button>
  );
}
