import { useState } from 'react';
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
  applianceQuickButton,
  doneAtDisplay,
  feedbackUrlFrom,
  formatDuration,
  readCycle,
  startedLine,
  useAnnounceToggle,
  useApplianceCost,
  useApplianceFeedback,
  useEmptiedAction,
} from '../Appliance';
import type { ApplianceCycle, ApplianceFeedbackJson, ApplianceState } from '../Appliance';
import {
  DRYER_ANNOUNCE_BOOLEAN,
  DRYER_DRYNESS_SELECT,
  DRYER_EMPTIED_BUTTON,
  DRYER_PROGRAMME_SELECT,
  DRYER_SKANE_PLUS_BOOLEAN,
  DRYER_STATE_ENTITY,
  DRYER_TIME_MINUTES_SELECT,
} from '../../config/entities';
import { stateSinceIso } from '../../utils/stateSince';

const ACCENT_CLASS = 'appliance-accent-dryer';
const GLYPH_ICON = 'mdi:tumble-dryer';

const FEEDBACK_URL = feedbackUrlFrom(import.meta.env.VITE_DRYER_FEEDBACK_URL);

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

export type DryerCycle = ApplianceCycle;
export type DryerFeedbackJson = ApplianceFeedbackJson;

interface DryerCardProps {
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

type DryerPicker = 'programme' | 'dryness' | 'time' | null;

export function DryerCard({ entities, callService }: DryerCardProps) {
  const dryer = entities?.[DRYER_STATE_ENTITY];
  const programmeSelect = entities?.[DRYER_PROGRAMME_SELECT];
  const drynessSelect = entities?.[DRYER_DRYNESS_SELECT];
  const skanePlusToggle = entities?.[DRYER_SKANE_PLUS_BOOLEAN];
  const timeSelect = entities?.[DRYER_TIME_MINUTES_SELECT];

  const [collapsed, setCollapsed] = useLocalStorageBoolean('dryercard-collapsed', true);

  // Which picker/history sheet is open (at most one at a time — chips/footer icons open them).
  const [openPicker, setOpenPicker] = useState<DryerPicker>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const emptied = useEmptiedAction(callService, DRYER_EMPTIED_BUTTON);
  const announce = useAnnounceToggle(entities, callService, DRYER_ANNOUNCE_BOOLEAN);
  const history = useApplianceFeedback(FEEDBACK_URL);

  // State + the stats-line attributes are resolved unconditionally, before either early return
  // below, because useApplianceCost is a hook and must run on every render (rules-of-hooks).
  const rawState = (dryer?.state?.trim() || 'Off').toLowerCase();
  const attrs = dryer?.attributes ?? {};
  let state: ApplianceState = (dryer?.state?.trim() || 'Off') as ApplianceState;
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

  const { runCostKr, liveCostKr } = useApplianceCost(dryer, state, { energyKwh: energyUsed, runTimeMinutes, idleMinutes });

  if (!dryer) return null;

  if (state === 'Off' || state === 'Emptied') return null;

  const programmeValue = (programmeSelect?.state ?? '').trim();
  // Base programme name only — dryness/time/Skåne+ each get their own chip, so using the
  // backend's combined programme_label here (e.g. "Bomuld - Ekstra tørt") would duplicate them.
  const programmeLabel = programmeValue || (attrs.programme_label as string) || '—';
  const options: string[] = Array.isArray(programmeSelect?.attributes?.options) ? (programmeSelect.attributes.options as string[]) : [];

  // Visibility of controls by programme (physical panel rules)
  const showDryness = PROGRAMMES_WITH_DRYNESS.includes(programmeValue);
  const showSkane = PROGRAMMES_WITH_SKANE.includes(programmeValue);
  const showTime = programmeValue === PROGRAMME_WITH_TIME;
  const lockSkaneOn = PROGRAMMES_SKANE_LOCKED_ON.includes(programmeValue);
  // Overrun: cycle ran past its expected duration (attr absent when not overrunning - the
  // monitor only publishes it when > 0). Remaining is then a floor ("still drying"), not a countdown.
  const overrunMin = attrs.overrun_min != null ? Number(attrs.overrun_min) : 0;

  const cycle = readCycle(attrs, state === 'Running');
  const { remainingMin } = cycle;
  const countdownLabel =
    remainingMin == null
      ? null
      : remainingMin <= 2
        ? 'Almost done'
        : overrunMin > 0
          ? `+${Math.round(overrunMin)} min over usual — still drying`
          : `${formatDuration(remainingMin)} left`;

  const isInteractive = state === 'Running' || state === 'Unemptied';

  const handleProgrammeChange = (option: string) => {
    if (!callService || !programmeSelect) return;
    callService({
      domain: 'input_select',
      service: 'select_option',
      target: { entity_id: DRYER_PROGRAMME_SELECT },
      serviceData: { option },
    });
  };

  const handleDrynessChange = (option: string) => {
    if (!callService || !drynessSelect) return;
    callService({
      domain: 'input_select',
      service: 'select_option',
      target: { entity_id: DRYER_DRYNESS_SELECT },
      serviceData: { option },
    });
  };

  const handleSkanePlusToggle = () => {
    if (!callService || !skanePlusToggle) return;
    const on = skanePlusToggle.state === 'on';
    callService({
      domain: 'input_boolean',
      service: on ? 'turn_off' : 'turn_on',
      target: { entity_id: DRYER_SKANE_PLUS_BOOLEAN },
    });
  };

  const handleTimeChange = (option: string) => {
    if (!callService || !timeSelect) return;
    callService({
      domain: 'input_select',
      service: 'select_option',
      target: { entity_id: DRYER_TIME_MINUTES_SELECT },
      serviceData: { option },
    });
  };

  const drynessOptions: string[] = Array.isArray(drynessSelect?.attributes?.options) ? (drynessSelect.attributes.options as string[]) : [];
  const timeOptions: string[] = Array.isArray(timeSelect?.attributes?.options) ? (timeSelect.attributes.options as string[]) : [];
  const skaneOn = skanePlusToggle?.state === 'on';
  const openHistory = FEEDBACK_URL ? () => setHistoryOpen(true) : undefined;

  const handlePick = (setter: (option: string) => void) => (option: string) => {
    setter(option);
    setOpenPicker(null);
  };

  const stateWord = state === 'Running' ? 'Running' : state === 'Paused' ? 'Paused' : 'Empty it';
  const stateWordClass = state === 'Running' ? 'tint' : state === 'Unemptied' ? 'alert' : 'muted';

  const renderChips = () => (
    <div className='appliance-chips'>
      <ApplianceChip label={programmeLabel} isInteractive={isInteractive} onClick={() => setOpenPicker('programme')} />
      {showDryness && drynessSelect && (
        <ApplianceChip label={drynessSelect.state ?? '—'} isInteractive={isInteractive} onClick={() => setOpenPicker('dryness')} />
      )}
      {showTime && timeSelect?.state && (
        <ApplianceChip label={`${timeSelect.state} min`} isInteractive={isInteractive} onClick={() => setOpenPicker('time')} />
      )}
      {lockSkaneOn && (
        <span className='appliance-chip on' title='Always on for this program'>
          Skåne+
        </span>
      )}
      {!lockSkaneOn && showSkane && skanePlusToggle && (
        <ApplianceChip label='Skåne+' isInteractive={isInteractive} onClick={handleSkanePlusToggle} tinted={skaneOn} />
      )}
    </div>
  );

  return (
    <ApplianceCard
      accentClassName={ACCENT_CLASS}
      glyphIcon={GLYPH_ICON}
      title='Dryer'
      collapsed={collapsed}
      onToggleCollapsed={() => setCollapsed(v => !v)}
      quickButton={applianceQuickButton({ collapsed, state, noun: 'dryer', announce, emptied })}
      stateWord={stateWord}
      stateWordClass={stateWordClass}
      showCollapsedStrip={state === 'Running'}
      progressPct={cycle.progressPct}
    >
      {state === 'Running' && (
        <>
          <ApplianceCycleStrip cycle={cycle} countdownLabel={countdownLabel} />

          {renderChips()}

          <ApplianceFooter energyKwh={energyUsed} costKr={liveCostKr} announce={announce} onOpenHistory={openHistory} />
        </>
      )}

      {state === 'Paused' && <AppliancePausedRow text='Adding laundry…' />}

      {state === 'Unemptied' && (
        <>
          <ApplianceDonePanel
            doneAt={doneAtDisplay(stateSinceIso(dryer), idleMinutes)}
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
          {...history}
          accentClassName={ACCENT_CLASS}
          historyKey='dryer-history'
          programmeKeys={PROGRAMME_KEYS}
          programmeKeyToLabel={PROGRAMME_KEY_TO_LABEL}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </ApplianceCard>
  );
}
