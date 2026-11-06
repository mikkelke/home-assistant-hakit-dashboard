import type { ReactNode } from 'react';
import { Icon } from '@iconify/react';
import { sendCoffeeCommand } from '../../coffee/command';
import type { CoffeeState } from '../../coffee/model';
import { canStart, startFailure } from '../../coffee/view';
import { CupWait } from './CupWait';
import { HoldButton } from './HoldButton';
import { LinkChip } from './parts';
import type { BrewStart } from './useBrewStart';
import { WaterPrompt } from './WaterTank';

/** A ready brew whose cup the scale cannot see: the one case that needs a tap to be picked up. */
function PickedUp({ state, size }: { state: CoffeeState; size: 'md' | 'xl' }) {
  const brewId = state.brewId;
  const button = (
    <button
      type='button'
      className={size === 'xl' ? 'cs-wide is-green' : 'coffee-btn is-green cc-picked'}
      onClick={() => brewId && void sendCoffeeCommand('picked_up', { brew_id: brewId }).catch(() => {})}
    >
      <Icon icon='mdi:check' aria-hidden='true' />
      Picked up
    </button>
  );
  return size === 'xl' ? <div className='cs-bottom'>{button}</div> : button;
}

/** The control under a brew's screen, the same in the Kitchen card (`md`) and on the stage (`xl`). A ready brew offers
 * Picked up while the scale cannot tell whether its cup is still there, and nothing otherwise: a cup the scale sees lifted
 * is picked up by itself. A start waits for its cup, or for water, and else is the hold to brew, with `links` under it. */
export function BrewAction({ brew, size, links }: { brew: BrewStart; size: 'md' | 'xl'; links?: ReactNode }) {
  const { state, water } = brew;
  const xl = size === 'xl';
  if (state.phase === 'ready') return state.cup === 'unknown' ? <PickedUp state={state} size={size} /> : null;
  if (state.phase === 'awaiting_cup') {
    return (
      <div className={xl ? 'cs-go' : 'cc-wait'}>
        <CupWait state={state} size={size} />
      </div>
    );
  }
  if (water.short) {
    return (
      <div className={xl ? 'cs-go' : 'cc-wait'}>
        <WaterPrompt
          short={water.short}
          size={size}
          busy={water.busy}
          onFilled={() => water.filled(brew.begin)}
          onAnyway={() => water.startAnyway(brew.begin)}
        />
      </div>
    );
  }
  const hold = (
    <HoldButton
      kind='brew'
      size={size}
      className={xl ? 'cs-go' : 'cc-hold'}
      label={brew.label}
      pending={brew.pending}
      failed={brew.pending ? null : startFailure(state)}
      disabled={!brew.pending && !canStart(state)}
      onConfirm={() => water.guard(brew.begin)}
    />
  );
  return xl ? (
    <>
      {hold}
      {links}
    </>
  ) : (
    <div className='cc-go'>
      <LinkChip state={state} />
      {hold}
    </div>
  );
}
