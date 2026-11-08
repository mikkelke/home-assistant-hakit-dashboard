import { useState } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import { useLocalStorageBoolean } from '../../hooks';
import {
  ApplianceCard,
  ApplianceChip,
  ApplianceCycleStrip,
  ApplianceDonePanel,
  ApplianceFooter,
  ApplianceHistorySheet,
  AppliancePausedRow,
  AppliancePickerSheet,
  ApplianceToggleChip,
  applianceQuickButton,
  countdownLabel,
  doneAtDisplay,
  feedbackUrlFrom,
  readCycle,
  startedLine,
  useAnnounceToggle,
  useApplianceCost,
  useApplianceFeedback,
  useEmptiedAction,
  useTimedFlag,
} from '../Appliance';
import type { ApplianceCycle, ApplianceFeedbackJson, ApplianceState } from '../Appliance';
import {
  WASHER_ANNOUNCE_BOOLEAN,
  WASHER_EMPTIED_BUTTON,
  WASHER_PROGRAMME_SELECT,
  WASHER_SOAK_BOOLEAN,
  WASHER_SPIN_SELECT,
  WASHER_STATE_ENTITY,
  WASHER_TEMPERATURE_SELECT,
} from '../../config/entities';
import './WasherCard.css';
import { stateSinceIso } from '../../utils/stateSince';

const ACCENT_CLASS = 'appliance-accent-washer';
const GLYPH_ICON = 'mdi:washing-machine';

const UNCONFIRMED_PROGRAMME = 'Auto (unconfirmed)';
const NO_CHOICE = '—';

const FEEDBACK_URL = feedbackUrlFrom(import.meta.env.VITE_WASHER_FEEDBACK_URL);
const PREDICTION_FLASH_MS = 2000;

/** A select's live options. washer_monitor narrows the temperature and spin selects to the confirmed
 * programme's own values (_apply_programme_ui_dropdowns), with NO_CHOICE alone when it has none. */
function selectOptions(entity: HassEntities[string] | undefined): string[] {
  const opts = entity?.attributes?.options;
  return Array.isArray(opts) ? (opts as string[]) : [];
}

const hasChoice = (options: string[]) => options.some(o => o !== NO_CHOICE);

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

export type WasherCycle = ApplianceCycle;
export type WasherFeedbackJson = ApplianceFeedbackJson;

interface WasherCardProps {
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

type WasherPicker = 'programme' | 'temperature' | 'spin' | null;

export function WasherCard({ entities, callService }: WasherCardProps) {
  const washer = entities?.[WASHER_STATE_ENTITY];
  const programmeSelect = entities?.[WASHER_PROGRAMME_SELECT];
  const spinSelect = entities?.[WASHER_SPIN_SELECT];
  const temperatureSelect = entities?.[WASHER_TEMPERATURE_SELECT];
  const soakToggle = entities?.[WASHER_SOAK_BOOLEAN];

  const [collapsed, setCollapsed] = useLocalStorageBoolean('washercard-collapsed', true);

  // Which picker/history sheet is open (at most one at a time — chips/footer icons open them).
  const [openPicker, setOpenPicker] = useState<WasherPicker>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Brief flash on the prediction-confirm disc after a successful auto-confirm.
  const [predictionConfirmed, flashPredictionConfirmed] = useTimedFlag(PREDICTION_FLASH_MS);
  const emptied = useEmptiedAction(callService, WASHER_EMPTIED_BUTTON);
  const announce = useAnnounceToggle(entities, callService, WASHER_ANNOUNCE_BOOLEAN);
  const history = useApplianceFeedback(FEEDBACK_URL);

  // No local cache: entities come from parent (useHass); re-render when sensor.washer_state updates.
  // State + the stats-line attributes are resolved unconditionally, before either early return
  // below, because useApplianceCost is a hook and must run on every render (rules-of-hooks).
  const rawState = (washer?.state?.trim() || 'Off').toLowerCase();
  const attrs = washer?.attributes ?? {};
  // Normalize: HA may send "On"/"Off" instead of "Running"/"Off"; infer from attributes
  let state: ApplianceState = (washer?.state?.trim() || 'Off') as ApplianceState;
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

  const { runCostKr, liveCostKr } = useApplianceCost(washer, state, { energyKwh: energyUsed, runTimeMinutes, idleMinutes });

  if (!washer) return null;

  // Hide the whole card when off or emptied (only show when there's a cycle or something to do)
  if (state === 'Off' || state === 'Emptied') return null;

  const programmeLabel = (attrs.programme_label as string) || programmeSelect?.state || '—';
  const options: string[] = Array.isArray(programmeSelect?.attributes?.options) ? (programmeSelect.attributes.options as string[]) : [];
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

  const cycle = readCycle(attrs, state === 'Running');

  const isInteractive = state === 'Running' || state === 'Unemptied';
  // supports_soak comes from washer_monitor.py (washer_programmes.yaml is the single source
  // of truth for which programmes support it) - true/'true' handles either HA attribute form.
  const supportsSoak = attrs.supports_soak === true || attrs.supports_soak === 'true';
  const soakOn = soakToggle?.state === 'on';

  const handleProgrammeChange = (option: string) => {
    if (!callService || !programmeSelect) return;
    callService({
      domain: 'input_select',
      service: 'select_option',
      target: { entity_id: WASHER_PROGRAMME_SELECT },
      serviceData: { option },
    });
  };

  const handleSoakToggle = () => {
    if (!callService || !soakToggle) return;
    callService({
      domain: 'input_boolean',
      service: soakOn ? 'turn_off' : 'turn_on',
      target: { entity_id: WASHER_SOAK_BOOLEAN },
    });
  };

  // Until a programme is confirmed the selects still hold the previous programme's values.
  const programmeConfirmed = !!programmeSelect?.state && programmeSelect.state !== UNCONFIRMED_PROGRAMME;
  const spinOptions = selectOptions(spinSelect);
  const temperatureOptions = selectOptions(temperatureSelect);
  const showSpin = !!spinSelect && programmeConfirmed && hasChoice(spinOptions);
  const showTemperature = !!temperatureSelect && programmeConfirmed && hasChoice(temperatureOptions);
  const handleSpinChange = (option: string) => {
    if (!callService) return;
    callService({
      domain: 'input_select',
      service: 'select_option',
      target: { entity_id: WASHER_SPIN_SELECT },
      serviceData: { option },
    });
  };

  const handleTemperatureChange = (option: string) => {
    if (!callService) return;
    callService({
      domain: 'input_select',
      service: 'select_option',
      target: { entity_id: WASHER_TEMPERATURE_SELECT },
      serviceData: { option },
    });
  };

  const programmeKeysForHistory = options.length > 0 ? options : PROGRAMME_KEYS;
  const openHistory = FEEDBACK_URL ? () => setHistoryOpen(true) : undefined;

  // Preferred (attribute-derived) spin label, e.g. "1400 rpm"/"No spin" — falls back to the
  // select's own raw state so the chip and its picker's checkmark still agree.
  const spinLabel = spinRpm !== undefined ? (spinRpm === 0 ? 'No spin' : `${spinRpm} rpm`) : null;
  const spinChipValue = spinLabel ?? spinSelect?.state ?? NO_CHOICE;

  const handlePick = (setter: (option: string) => void) => (option: string) => {
    setter(option);
    setOpenPicker(null);
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
      flashPredictionConfirmed();
    } else {
      setOpenPicker('programme');
    }
  };

  // A drum clean leaves nothing to empty; the door only needs opening to air the drum.
  const isDrumClean = attrs.detected_programme === 'drum_clean';
  const stateWord = state === 'Running' ? 'Running' : state === 'Paused' ? 'Paused' : isDrumClean ? 'Air it' : 'Empty it';
  const stateWordClass = state === 'Running' ? 'tint' : state === 'Unemptied' ? 'alert' : 'muted';

  const renderChips = () => (
    <div className='appliance-chips'>
      <ApplianceChip label={programmeLabel} isInteractive={isInteractive} onClick={() => setOpenPicker('programme')} />
      {showTemperature && (
        <ApplianceChip
          label={temperatureSelect?.state ?? NO_CHOICE}
          isInteractive={isInteractive}
          onClick={() => setOpenPicker('temperature')}
        />
      )}
      {showSpin && <ApplianceChip label={spinChipValue} isInteractive={isInteractive} onClick={() => setOpenPicker('spin')} />}
      {soakToggle && supportsSoak && (
        <ApplianceToggleChip
          icon='mdi:water-sync'
          className='washer-soak-chip'
          on={soakOn}
          isInteractive={isInteractive}
          onClick={handleSoakToggle}
          option='soak'
        />
      )}
    </div>
  );

  return (
    <ApplianceCard
      accentClassName={ACCENT_CLASS}
      glyphIcon={GLYPH_ICON}
      title='Washer'
      collapsed={collapsed}
      onToggleCollapsed={() => setCollapsed(v => !v)}
      quickButton={applianceQuickButton({ collapsed, state, noun: 'washer', announce, emptied, aired: isDrumClean })}
      stateWord={stateWord}
      stateWordClass={stateWordClass}
      showCollapsedStrip={state === 'Running'}
      progressPct={cycle.progressPct}
    >
      {state === 'Running' && (
        <>
          <ApplianceCycleStrip cycle={cycle} countdownLabel={countdownLabel(cycle.remainingMin)} />

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

          <ApplianceFooter energyKwh={energyUsed} costKr={liveCostKr} announce={announce} onOpenHistory={openHistory} />
        </>
      )}

      {state === 'Paused' && <AppliancePausedRow text='Adding laundry…' />}

      {state === 'Unemptied' && (
        <>
          <ApplianceDonePanel
            aired={isDrumClean}
            doneAt={doneAtDisplay(stateSinceIso(washer), idleMinutes)}
            startedLine={startedLine(attrs, cycle.startedDisplay, cycle.hasStartedDisplay)}
            emptied={emptied}
          />

          {renderChips()}

          <ApplianceFooter runTimeMinutes={runTimeMinutes} energyKwh={energyUsed} costKr={runCostKr} onOpenHistory={openHistory} />
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
          current={temperatureSelect?.state ?? NO_CHOICE}
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
          current={spinSelect?.state ?? NO_CHOICE}
          onPick={handlePick(handleSpinChange)}
          onClose={() => setOpenPicker(null)}
        />
      )}
      {historyOpen && (
        <ApplianceHistorySheet
          {...history}
          accentClassName={ACCENT_CLASS}
          historyKey='washer-history'
          programmeKeys={programmeKeysForHistory}
          programmeKeyToLabel={PROGRAMME_KEY_TO_LABEL}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </ApplianceCard>
  );
}
