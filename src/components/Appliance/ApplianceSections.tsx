import { Icon } from '@iconify/react';
import { formatKr } from '../../utils/format';
import { ApplianceCycleTiming } from '../ApplianceCycleTiming';
import { formatDuration, formatTimeOnly, finishIcon, type CycleReading } from './applianceFormat';
import { AnnounceBell } from './ApplianceControls';
import type { AnnounceToggle, EmptiedAction } from './useApplianceActions';

export interface ApplianceCycleStripProps {
  cycle: CycleReading;
  /** The countdown wording, which each appliance words for itself; null while the remaining time is unknown. */
  countdownLabel: string | null;
}

/** A running cycle: the progress bar with its start, countdown and end, or the plain timing line
 * when there is nothing to chart (no percentage and no known length). */
export function ApplianceCycleStrip({ cycle, countdownLabel }: ApplianceCycleStripProps) {
  const { progressPct, totalMin, startedDisplay, hasStartedDisplay, hasStart, estimatedEndTime } = cycle;
  const hasEnd = !!estimatedEndTime && String(estimatedEndTime).trim() !== '';

  if (progressPct === 0 && totalMin == null) {
    return (
      <div className='appliance-timing-line'>
        <ApplianceCycleTiming
          hasDetail={hasStart || countdownLabel != null || hasEnd}
          startedDisplay={startedDisplay}
          estimatedEndTime={estimatedEndTime}
          countdownLabel={countdownLabel}
          formatTimeOnly={formatTimeOnly}
        />
      </div>
    );
  }

  return (
    <div className='appliance-cycle-strip'>
      <div className='appliance-cycle-bar'>
        <div className='appliance-cycle-track'>
          <div className='appliance-cycle-fill' style={{ '--progress': progressPct } as React.CSSProperties} />
        </div>
        <div className='appliance-cycle-now' style={{ left: `${progressPct}%` }} />
      </div>
      <div className='appliance-cycle-meta'>
        {hasStartedDisplay && <span className='appliance-cycle-meta-start'>{startedDisplay}</span>}
        {countdownLabel != null && <span className='appliance-cycle-meta-countdown'>{countdownLabel}</span>}
        {hasEnd && <span className='appliance-cycle-meta-end'>~{formatTimeOnly(estimatedEndTime)}</span>}
      </div>
    </div>
  );
}

/** A paused run: an icon and a line of text. */
export function AppliancePausedRow({ text }: { text: string }) {
  return (
    <div className='appliance-paused-row'>
      <Icon icon='mdi:plus-circle-outline' aria-hidden='true' />
      <span>{text}</span>
    </div>
  );
}

export interface ApplianceDonePanelProps {
  /** A drum clean leaves nothing to empty: the door only needs opening to air it. */
  aired?: boolean;
  doneAt: string | null;
  startedLine: string | null;
  emptied: EmptiedAction;
}

/** A finished run: when it ended, who started it and when, and the button that marks it emptied. */
export function ApplianceDonePanel({ aired = false, doneAt, startedLine, emptied }: ApplianceDonePanelProps) {
  return (
    <div className='appliance-hero'>
      <span className='appliance-hero-icon'>
        <Icon icon={finishIcon(aired)} aria-hidden='true' />
      </span>
      <span className='appliance-hero-text'>
        {doneAt && <span className='appliance-hero-line1'>Done {doneAt}</span>}
        {startedLine && <span className='appliance-hero-line2'>{startedLine}</span>}
      </span>
      {emptied.available && (
        <button
          type='button'
          className='appliance-emptied-pill'
          onClick={emptied.press}
          disabled={emptied.pressed}
          aria-busy={emptied.pressed}
        >
          <Icon
            icon={emptied.pressed ? 'mdi:loading' : 'mdi:check'}
            className={emptied.pressed ? 'appliance-spin' : ''}
            aria-hidden='true'
          />
          <span>{aired ? 'Aired' : 'Emptied'}</span>
        </button>
      )}
    </div>
  );
}

export interface ApplianceFooterProps {
  /** A finished run's length. */
  runTimeMinutes?: number;
  energyKwh?: number;
  /** The cost so far of a running cycle, or of a finished one. */
  costKr: number | null;
  /** The bell, while the run is going. */
  announce?: AnnounceToggle;
  /** Present when there is a history to open. */
  onOpenHistory?: () => void;
}

/** The stats line under a running or finished cycle, with its announce bell and history button. */
export function ApplianceFooter({ runTimeMinutes, energyKwh, costKr, announce, onOpenHistory }: ApplianceFooterProps) {
  const showBell = announce?.exists === true;
  if (runTimeMinutes == null && energyKwh == null && costKr == null && !showBell && !onOpenHistory) return null;
  return (
    <div className='appliance-footer'>
      {runTimeMinutes != null && (
        <span className='appliance-footer-item'>
          <Icon icon='mdi:clock-outline' aria-hidden='true' />
          Ran {formatDuration(runTimeMinutes)}
        </span>
      )}
      {energyKwh != null && (
        <span className='appliance-footer-item'>
          <Icon icon='mdi:flash' aria-hidden='true' />
          {Number(energyKwh).toFixed(2)} kWh
        </span>
      )}
      {costKr != null && <span className='appliance-footer-item'>≈ {formatKr(costKr)}</span>}
      {(showBell || onOpenHistory) && (
        <span className='appliance-footer-actions'>
          {showBell && <AnnounceBell announce={announce} variant='footer' />}
          {onOpenHistory && (
            <button type='button' className='appliance-footer-icon-btn' onClick={onOpenHistory} aria-label='Cycle history'>
              <Icon icon='mdi:history' aria-hidden='true' />
            </button>
          )}
        </span>
      )}
    </div>
  );
}
