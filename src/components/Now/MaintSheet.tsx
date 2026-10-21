import { useId, useState } from 'react';
import { useHass } from '@hakit/core';
import { Icon } from '@iconify/react';
import { opensRoom, type HouseUpcomingRow } from '../../home/houseUpcoming';
import { fireHaEvent } from '../../utils/haEvents';
import { ApplianceSheet } from '../Appliance';
import '../Appliance/Appliance.css';
import './MaintSheet.css';

/** The events HouseUpcoming listens for, with the row's id as `row`. HA lets only an admin fire them. */
export const DONE_EVENT = 'house_upcoming_done';
export const UNDO_EVENT = 'house_upcoming_undo';

/** idle: the Done button. confirm: asked once more, so a stray tap changes nothing. sending and undoing: the
 * event is on its way. done: it went through, and one tap takes it back. */
type Phase = 'idle' | 'confirm' | 'sending' | 'done' | 'undoing';

export interface MaintSheetProps {
  /** The live row: it changes under the sheet once HouseUpcoming has taken a Done. */
  row: HouseUpcomingRow;
  isAdmin: boolean;
  onClose: () => void;
  /** Without it the sheet offers no way into the room, as when it is opened from the room's own panel. */
  onOpenRoom?: (areaId: string) => void;
}

/** What to do about a maintenance row: its numbers, a step-by-step guide behind the info button, and for a
 * tapped row a Done button that asks before it fires. */
export function MaintSheet({ row, isAdmin, onClose, onOpenRoom }: MaintSheetProps) {
  const connection = useHass(s => s.connection);
  const [phase, setPhase] = useState<Phase>('idle');
  const [failed, setFailed] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const guideId = useId();
  const canDone = isAdmin && row.tapDone;
  const roomId = onOpenRoom && !row.tapDone && opensRoom(row) ? row.areaId : null;

  const send = (event: string, going: Phase, arrived: Phase, back: Phase) => {
    setPhase(going);
    setFailed(false);
    fireHaEvent(connection, event, { row: row.id }).then(
      () => setPhase(arrived),
      () => {
        setPhase(back);
        setFailed(true);
      }
    );
  };

  return (
    <ApplianceSheet accentClassName='maint-sheet' glyphIcon={row.icon} title={row.title} historyKey='now-maint' onClose={onClose}>
      <div className='maint-body'>
        {row.detail && <p className='maint-detail'>{row.detail}</p>}
        {row.info.length > 0 && (
          <ul className='maint-info'>
            {row.info.map(line => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {row.steps.length > 0 && (
          <>
            <button
              type='button'
              className='maint-how'
              onClick={() => setGuideOpen(open => !open)}
              aria-expanded={guideOpen}
              aria-controls={guideId}
            >
              <Icon icon='mdi:information-outline' aria-hidden='true' />
              How to
              <Icon icon={guideOpen ? 'mdi:chevron-up' : 'mdi:chevron-down'} aria-hidden='true' />
            </button>
            {guideOpen && (
              <div id={guideId} className='maint-guide'>
                {row.warn && (
                  <p className='maint-warn'>
                    <Icon icon='mdi:alert-outline' aria-hidden='true' />
                    {row.warn}
                  </p>
                )}
                <ol className='maint-steps'>
                  {row.steps.map(step => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
        {canDone && phase === 'idle' && (
          <button type='button' className='maint-btn is-primary' onClick={() => setPhase('confirm')}>
            <Icon icon='mdi:check' aria-hidden='true' />
            Done
          </button>
        )}
        {canDone && phase === 'confirm' && (
          <div className='maint-confirm' role='group' aria-label='Confirm done'>
            <p className='maint-ask'>Mark it done? The count starts over.</p>
            <div className='maint-actions'>
              <button type='button' className='maint-btn is-ghost' onClick={() => setPhase('idle')}>
                Cancel
              </button>
              <button type='button' className='maint-btn is-primary' onClick={() => send(DONE_EVENT, 'sending', 'done', 'idle')}>
                <Icon icon='mdi:check-bold' aria-hidden='true' />
                Yes, done
              </button>
            </div>
          </div>
        )}
        {canDone && (phase === 'sending' || phase === 'undoing') && (
          <button type='button' className='maint-btn is-primary' disabled aria-busy='true'>
            <Icon icon='mdi:loading' className='appliance-spin' aria-hidden='true' />
            {phase === 'sending' ? 'Marking done' : 'Undoing'}
          </button>
        )}
        {canDone && phase === 'done' && (
          <div className='maint-done' role='status'>
            <span className='maint-done-text'>
              <Icon icon='mdi:check-circle-outline' aria-hidden='true' />
              Marked done
            </span>
            <button type='button' className='maint-btn is-ghost' onClick={() => send(UNDO_EVENT, 'undoing', 'idle', 'done')}>
              <Icon icon='mdi:undo' aria-hidden='true' />
              Undo
            </button>
          </div>
        )}
        {failed && (
          <p className='maint-error' role='alert'>
            <Icon icon='mdi:alert-circle-outline' aria-hidden='true' />
            Home Assistant did not take that. Try again.
          </p>
        )}
        {roomId && (
          <button type='button' className='maint-btn is-ghost' onClick={() => onOpenRoom?.(roomId)}>
            <Icon icon='mdi:door-open' aria-hidden='true' />
            Open room
          </button>
        )}
      </div>
    </ApplianceSheet>
  );
}
