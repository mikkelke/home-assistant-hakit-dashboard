import { useId, useState } from 'react';
import { useHass } from '@hakit/core';
import { Icon } from '@iconify/react';
import { opensRoom, type HousePlant, type HouseUpcomingRow } from '../../home/houseUpcoming';
import { fireHaEvent } from '../../utils/haEvents';
import { ApplianceSheet } from '../Appliance';
import '../Appliance/Appliance.css';
import { plantPhoto } from './plantPhotos';
import './MaintSheet.css';

/** The events HouseUpcoming listens for, with the id of the row, or of the plant on a plants row, as `row`. HA lets only an
 * admin fire them. */
export const DONE_EVENT = 'house_upcoming_done';
export const UNDO_EVENT = 'house_upcoming_undo';

/** idle: the Done button. confirm: asked once more, so a stray tap changes nothing. sending and undoing: the
 * event is on its way. done: it went through, and one tap takes it back. */
type Phase = 'idle' | 'confirm' | 'sending' | 'done' | 'undoing';

/** A plant's Done fires at once, since its Undo is right there. */
type PlantPhase = Exclude<Phase, 'confirm'>;

/** A plant this sheet has sent a Done or an Undo for: the entry as it was, its place in the list, and how far the event has got.
 * The publisher drops a plant it has taken a Done for, but its card stays until the sheet closes. */
interface PlantMark {
  plant: HousePlant;
  at: number;
  phase: PlantPhase;
  failed: boolean;
}

/** The plants the sheet lists: the row's, and the marked ones it has dropped since, back in the place they stood. */
function listedPlants(plants: readonly HousePlant[], marks: Record<string, PlantMark>): HousePlant[] {
  const listed = [...plants];
  const dropped = Object.values(marks)
    .filter(mark => !plants.some(plant => plant.id === mark.plant.id))
    .sort((a, b) => a.at - b.at);
  for (const mark of dropped) listed.splice(mark.at, 0, mark.plant);
  return listed;
}

const PLANT_BUTTON: Record<PlantPhase, { icon: string; label: string }> = {
  idle: { icon: 'mdi:check', label: 'Mark done' },
  sending: { icon: 'mdi:loading', label: 'Marking done' },
  done: { icon: 'mdi:undo', label: 'Undo' },
  undoing: { icon: 'mdi:loading', label: 'Undoing' },
};

interface PlantCardProps {
  plant: HousePlant;
  phase: PlantPhase;
  failed: boolean;
  /** The viewer may mark it done; without that the card shows the plant's detail in the button's place. */
  canDone: boolean;
  onDone: () => void;
  onUndo: () => void;
}

/** One plant of a plants row: its photo, name and amount, where it stands and what it looks like, and a round button that
 * marks it done and takes that back. */
function PlantCard({ plant, phase, failed, canDone, onDone, onUndo }: PlantCardProps) {
  const photo = plant.photo ? plantPhoto(plant.photo) : undefined;
  const busy = phase === 'sending' || phase === 'undoing';
  const done = phase === 'done' || phase === 'undoing';
  const button = PLANT_BUTTON[phase];
  return (
    <li className={done ? 'maint-plant is-done' : 'maint-plant'}>
      {photo ? (
        <img className='maint-plant-photo' src={photo} alt='' />
      ) : (
        <span className='maint-plant-photo is-blank'>
          <Icon icon='mdi:sprout' aria-hidden='true' />
        </span>
      )}
      <div className='maint-plant-text'>
        <span className='maint-plant-head'>
          <b className='maint-plant-name'>{plant.name}</b>
          {plant.amount && <span className='maint-plant-amount'>{plant.amount}</span>}
        </span>
        {!canDone && plant.detail && <span className='maint-plant-detail'>{plant.detail}</span>}
        {plant.where && (
          <span className='maint-plant-where'>
            <Icon icon='mdi:map-marker-outline' aria-hidden='true' />
            {plant.where}
          </span>
        )}
        {plant.aka && <span className='maint-plant-aka'>{plant.aka}</span>}
      </div>
      {canDone && (
        <button
          type='button'
          className={`maint-btn maint-plant-btn ${done ? 'is-ghost' : 'is-primary'}`}
          onClick={done ? onUndo : onDone}
          disabled={busy}
          aria-busy={busy || undefined}
          aria-label={`${button.label}: ${plant.name}`}
        >
          <Icon icon={button.icon} className={busy ? 'appliance-spin' : undefined} aria-hidden='true' />
        </button>
      )}
      {failed && (
        <p className='maint-error' role='alert'>
          <Icon icon='mdi:alert-circle-outline' aria-hidden='true' />
          Home Assistant did not take that. Try again.
        </p>
      )}
    </li>
  );
}

export interface MaintSheetProps {
  /** The live row: it changes under the sheet once HouseUpcoming has taken a Done. */
  row: HouseUpcomingRow;
  isAdmin: boolean;
  onClose: () => void;
  /** Without it the sheet offers no way into the room, as when it is opened from the room's own panel. */
  onOpenRoom?: (areaId: string) => void;
}

/** What to do about a maintenance row: its numbers, the lines of an overview row or the plants of a plants row with a Done
 * button for each, a step-by-step guide behind the info button, and for a tapped row a Done button that asks before it fires. */
export function MaintSheet({ row, isAdmin, onClose, onOpenRoom }: MaintSheetProps) {
  const connection = useHass(s => s.connection);
  const [phase, setPhase] = useState<Phase>('idle');
  const [failed, setFailed] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [marks, setMarks] = useState<Record<string, PlantMark>>({});
  const guideId = useId();
  const canDone = isAdmin && row.tapDone;
  const roomId = onOpenRoom && !row.tapDone && opensRoom(row) ? row.areaId : null;
  const plants = listedPlants(row.plants, marks);

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

  const sendPlant = (plant: HousePlant, at: number, event: string, going: PlantPhase, arrived: PlantPhase, back: PlantPhase) => {
    const mark = (next: PlantPhase, refused = false) =>
      setMarks(all => ({ ...all, [plant.id]: { plant, at, phase: next, failed: refused } }));
    mark(going);
    fireHaEvent(connection, event, { row: plant.id }).then(
      () => mark(arrived),
      () => mark(back, true)
    );
  };

  return (
    <ApplianceSheet accentClassName='maint-sheet' glyphIcon={row.icon} title={row.title} historyKey='now-maint' onClose={onClose}>
      <div className='maint-body'>
        {row.detail && plants.length === 0 && <p className='maint-detail'>{row.detail}</p>}
        {plants.length > 0 && (
          <ul className='maint-plants'>
            {plants.map((plant, index) => {
              const mark: PlantMark | undefined = marks[plant.id];
              return (
                <PlantCard
                  key={plant.id}
                  plant={plant}
                  phase={mark?.phase ?? 'idle'}
                  failed={mark?.failed ?? false}
                  canDone={isAdmin && plant.tapDone}
                  onDone={() => sendPlant(plant, index, DONE_EVENT, 'sending', 'done', 'idle')}
                  onUndo={() => sendPlant(plant, index, UNDO_EVENT, 'undoing', 'idle', 'done')}
                />
              );
            })}
          </ul>
        )}
        {plants.length === 0 && row.items.length > 0 && (
          <ul className='maint-items'>
            {row.items.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        )}
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
