import { Icon } from '@iconify/react';
import { sendCoffeeCommand } from '../../coffee/command';
import type { CoffeeState } from '../../coffee/model';
import { useMotionSlot } from '../../home/motionBudget';
import { Glyph } from './Glyph';

/** A start waiting for its cup: the brew goes by itself once the scale shows one, or at once on "Cup is already on",
 * offered only while the scale cannot tell. */
export function CupWait({ state, size }: { state: Pick<CoffeeState, 'cup' | 'link' | 'machine'>; size: 'xl' | 'md' }) {
  const pulse = useMotionSlot('coffee:cup-wait', 'appliance', true);
  const send = (op: 'cancel' | 'cup_confirmed') => void sendCoffeeCommand(op, {}).catch(() => {});
  const hint =
    state.machine === 'asleep' ? 'Waking the machine…' : state.link === 'connected' ? 'The brew starts by itself' : 'Connecting…';
  return (
    <div className={`coffee-cupwait is-${size}`} role='status'>
      <div className='coffee-cupwait-main'>
        <span className={`coffee-cupwait-disc ${pulse ? 'is-pulsing' : ''}`}>
          <Glyph name='cup' />
        </span>
        <span className='coffee-cupwait-tx'>
          <b>Put your cup on</b>
          <small>{hint}</small>
        </span>
      </div>
      <div className='coffee-cupwait-btns'>
        <button type='button' onClick={() => send('cancel')}>
          <Icon icon='mdi:close' aria-hidden='true' />
          Cancel
        </button>
        {state.cup === 'unknown' && (
          <button type='button' className='is-cof' onClick={() => send('cup_confirmed')}>
            <Glyph name='cup' />
            Cup is already on
          </button>
        )}
      </div>
    </div>
  );
}
