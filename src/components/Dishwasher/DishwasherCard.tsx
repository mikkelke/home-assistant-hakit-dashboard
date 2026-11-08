import { useState } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import { dishwasherSupportsExpress, dishwasherTimerSince, resolveDishwasherSemanticState } from '../../utils/dishwasherSemanticState';
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
  formatTimeOnly,
  readCycle,
  startedLine,
  useAnnounceToggle,
  useApplianceCost,
  useApplianceFeedback,
  useEmptiedAction,
} from '../Appliance';
import type { ApplianceCycle, ApplianceFeedbackJson, ApplianceState } from '../Appliance';
import {
  DISHWASHER_ANNOUNCE_BOOLEAN,
  DISHWASHER_EMPTIED_BUTTON,
  DISHWASHER_PROGRAMME_SELECT,
  DISHWASHER_SHORT_SELECT,
  DISHWASHER_STATE_ENTITY,
  DISHWASHER_STATE_SELECT,
  DISHWASHER_TIMER_SENSOR,
} from '../../config/entities';
import { stateSinceIso } from '../../utils/stateSince';

const ACCENT_CLASS = 'appliance-accent-dishwasher';
const GLYPH_ICON = 'mdi:dishwasher';

const FEEDBACK_URL = feedbackUrlFrom(import.meta.env.VITE_DISHWASHER_FEEDBACK_URL);

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

export type DishwasherCycle = ApplianceCycle;
export type DishwasherFeedbackJson = ApplianceFeedbackJson;

interface DishwasherCardProps {
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

type DishwasherPicker = 'programme' | null;

export function DishwasherCard({ entities, callService }: DishwasherCardProps) {
  const dishwasher = entities?.[DISHWASHER_STATE_ENTITY];
  const dishwasherInputState = entities?.[DISHWASHER_STATE_SELECT];
  const programmeSelect = entities?.[DISHWASHER_PROGRAMME_SELECT];
  const shortSelect = entities?.[DISHWASHER_SHORT_SELECT];

  const [collapsed, setCollapsed] = useLocalStorageBoolean('dishwashercard-collapsed', true);

  // Which picker/history sheet is open (at most one at a time — chips/footer icons open them).
  const [openPicker, setOpenPicker] = useState<DishwasherPicker>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const emptied = useEmptiedAction(callService, DISHWASHER_EMPTIED_BUTTON);
  const announce = useAnnounceToggle(entities, callService, DISHWASHER_ANNOUNCE_BOOLEAN);
  const history = useApplianceFeedback(FEEDBACK_URL);

  // Semantic state and the stats-line attributes are resolved unconditionally, before either early
  // return below, because useApplianceCost is a hook and must run on every render (rules-of-hooks).
  const attrs = dishwasher?.attributes ?? {};
  const state: ApplianceState = resolveDishwasherSemanticState(dishwasher, dishwasherInputState);
  const runTimeMinutes = attrs.run_time_minutes != null ? Number(attrs.run_time_minutes) : undefined;
  const energyUsed = attrs.energy_used != null ? Number(attrs.energy_used) : undefined;

  const { runCostKr, liveCostKr } = useApplianceCost(dishwasher, state, { energyKwh: energyUsed, runTimeMinutes });

  if (!dishwasher) return null;

  // A set delay timer keeps the card up while Off, so the programme can be picked for the timed run.
  const timerSince = dishwasherTimerSince(entities?.[DISHWASHER_TIMER_SENSOR], state);
  const timerSet = timerSince !== null;
  if ((state === 'Off' && !timerSet) || state === 'Emptied') return null;

  const programmeLabel = timerSet ? programmeSelect?.state || '—' : (attrs.programme_label as string) || programmeSelect?.state || '—';
  const options: string[] = Array.isArray(programmeSelect?.attributes?.options) ? (programmeSelect.attributes.options as string[]) : [];
  const cycle = readCycle(attrs, state === 'Running');

  const isInteractive = state === 'Running' || state === 'Unemptied' || timerSet;
  const openHistory = FEEDBACK_URL ? () => setHistoryOpen(true) : undefined;

  const handleProgrammeChange = (option: string) => {
    if (!callService || !programmeSelect) return;
    callService({
      domain: 'input_select',
      service: 'select_option',
      target: { entity_id: DISHWASHER_PROGRAMME_SELECT },
      serviceData: { option },
    });
  };

  const handleShortChange = (option: string) => {
    if (!callService) return;
    callService({
      domain: 'input_select',
      service: 'select_option',
      target: { entity_id: DISHWASHER_SHORT_SELECT },
      serviceData: { option },
    });
  };

  const handlePick = (setter: (option: string) => void) => (option: string) => {
    setter(option);
    setOpenPicker(null);
  };

  const stateWord = timerSet ? 'Timer' : state === 'Running' ? 'Running' : state === 'Paused' ? 'Paused' : 'Empty it';
  const stateWordClass = state === 'Running' || timerSet ? 'tint' : state === 'Unemptied' ? 'alert' : 'muted';

  const renderChips = () => (
    <div className='appliance-chips'>
      {timerSet && (
        <span className='appliance-chip on appliance-chip-icon' aria-label='Delay timer set'>
          <Icon icon='mdi:timer-outline' aria-hidden='true' />
          {timerSince && formatTimeOnly(timerSince)}
        </span>
      )}
      <ApplianceChip label={programmeLabel} isInteractive={isInteractive} onClick={() => setOpenPicker('programme')} />
      {/* Express (Miele "Ekspres") sits beside the programme only when that programme has it; off, the default, is the full programme. */}
      {shortSelect && dishwasherSupportsExpress(programmeLabel) && (
        <ApplianceToggleChip
          icon='mdi:clock-fast'
          className='appliance-chip-icon'
          on={shortSelect.state === 'Yes'}
          isInteractive={isInteractive}
          onClick={() => handleShortChange(shortSelect.state === 'Yes' ? 'No' : 'Yes')}
          option='Express'
          staticLabel={shortSelect.state === 'Yes' ? 'Express' : 'Full programme'}
        />
      )}
    </div>
  );

  return (
    <ApplianceCard
      accentClassName={ACCENT_CLASS}
      glyphIcon={GLYPH_ICON}
      title='Dishwasher'
      collapsed={collapsed}
      onToggleCollapsed={() => setCollapsed(v => !v)}
      quickButton={applianceQuickButton({ collapsed, state, noun: 'dishwasher', announce, emptied })}
      stateWord={stateWord}
      stateWordClass={stateWordClass}
      showCollapsedStrip={state === 'Running'}
      progressPct={cycle.progressPct}
    >
      {state === 'Running' && (
        <>
          <ApplianceCycleStrip cycle={cycle} countdownLabel={countdownLabel(cycle.remainingMin)} />

          {renderChips()}

          <ApplianceFooter energyKwh={energyUsed} costKr={liveCostKr} announce={announce} onOpenHistory={openHistory} />
        </>
      )}

      {timerSet && renderChips()}

      {state === 'Paused' && <AppliancePausedRow text='Paused' />}

      {state === 'Unemptied' && (
        <>
          <ApplianceDonePanel
            doneAt={doneAtDisplay(stateSinceIso(dishwasher))}
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
          historyKey='dishwasher-picker'
          title='Program'
          options={options}
          current={programmeSelect?.state ?? ''}
          onPick={handlePick(handleProgrammeChange)}
          onClose={() => setOpenPicker(null)}
        />
      )}
      {historyOpen && (
        <ApplianceHistorySheet
          {...history}
          accentClassName={ACCENT_CLASS}
          historyKey='dishwasher-history'
          programmeKeys={PROGRAMME_KEYS}
          programmeKeyToLabel={PROGRAMME_KEY_TO_LABEL}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </ApplianceCard>
  );
}
