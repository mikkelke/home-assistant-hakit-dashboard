import type { Dispatch, SetStateAction } from 'react';
import { Icon } from '@iconify/react';
import { ApplianceSheet } from './ApplianceSheet';
import { formatCycleTs, formatDuration } from './applianceFormat';

/** One completed run, as persisted by the feedback backend. Identical shape for the washer,
 * dryer and dishwasher — each card re-exports this as its own `XCycle` name. */
export interface ApplianceCycle {
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

export interface ApplianceFeedbackJson {
  version: number;
  cycles: ApplianceCycle[];
}

export interface ApplianceHistorySheetProps {
  accentClassName: string;
  historyKey: string;
  cyclesNewestFirst: ApplianceCycle[];
  hasFeedbackData: boolean;
  feedbackLoading: boolean;
  feedbackError: string | null;
  fetchFeedback: () => void;
  cycleSelection: Record<number, string>;
  setCycleSelection: Dispatch<SetStateAction<Record<number, string>>>;
  savingCycleIndex: number | null;
  handleConfirmCycle: (index: number) => void;
  programmeKeys: string[];
  programmeKeyToLabel: Record<string, string>;
  onClose: () => void;
}

/** Cycle-history sheet shared by the washer/dryer/dishwasher cards: loading / error+Retry / empty
 * states, and the per-row unconfirmed select + confirm button. */
export function ApplianceHistorySheet({
  accentClassName,
  historyKey,
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
  programmeKeyToLabel,
  onClose,
}: ApplianceHistorySheetProps) {
  return (
    <ApplianceSheet
      accentClassName={accentClassName}
      glyphIcon='mdi:history'
      title='Cycle history'
      historyKey={historyKey}
      onClose={onClose}
    >
      {feedbackLoading && !hasFeedbackData ? (
        <p className='appliance-history-note'>Loading…</p>
      ) : feedbackError ? (
        <p className='appliance-history-note error'>
          {feedbackError}
          <button type='button' className='appliance-history-retry' onClick={fetchFeedback}>
            Retry
          </button>
        </p>
      ) : cyclesNewestFirst.length === 0 ? (
        <p className='appliance-history-note'>No cycles recorded yet.</p>
      ) : (
        <div className='appliance-history-list'>
          {cyclesNewestFirst.map((cycle, index) => {
            const predictedLabel = programmeKeyToLabel[cycle.predicted] ?? cycle.predicted;
            const confirmedLabel = programmeKeyToLabel[cycle.confirmed] ?? cycle.confirmed;
            const isUnconfirmed = !cycle.programme_confirmed_by_human;
            const isSaving = savingCycleIndex === index;
            return (
              <div key={`${cycle.ts}-${index}`} className='appliance-history-row'>
                <div className='appliance-history-line'>
                  <span className='appliance-history-ts'>{formatCycleTs(cycle.ts)}</span>
                  <span>{formatDuration(cycle.duration_min)}</span>
                  <span>{cycle.energy_kwh.toFixed(2)} kWh</span>
                  <span className='appliance-history-programme' title={isUnconfirmed ? 'Predicted (unconfirmed)' : 'Confirmed'}>
                    {isUnconfirmed ? predictedLabel : confirmedLabel}
                    {isUnconfirmed && <span className='appliance-history-unconfirmed-mark'>?</span>}
                  </span>
                </div>
                {isUnconfirmed && (
                  <div className='appliance-history-confirm'>
                    <select
                      className='appliance-history-select'
                      aria-label='Correct program'
                      value={cycleSelection[index] ?? cycle.predicted}
                      onChange={e => setCycleSelection(prev => ({ ...prev, [index]: e.target.value }))}
                      disabled={isSaving}
                    >
                      {programmeKeys.map(k => (
                        <option key={k} value={k}>
                          {programmeKeyToLabel[k] ?? k}
                        </option>
                      ))}
                    </select>
                    <button
                      type='button'
                      className='appliance-history-confirm-btn'
                      onClick={() => handleConfirmCycle(index)}
                      disabled={isSaving}
                      aria-label='Confirm program'
                    >
                      <Icon icon={isSaving ? 'mdi:loading' : 'mdi:check'} className={isSaving ? 'appliance-spin' : ''} aria-hidden='true' />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </ApplianceSheet>
  );
}
