import type { ReactNode } from 'react';
import { Icon } from '@iconify/react';
import { finishIcon, type ApplianceState } from './applianceFormat';
import { AnnounceBell } from './ApplianceControls';
import type { AnnounceToggle, EmptiedAction } from './useApplianceActions';

export interface ApplianceQuickButtonArgs {
  collapsed: boolean;
  state: ApplianceState;
  /** The appliance as the button names it: "Mark the ___ as emptied". */
  noun: string;
  announce: AnnounceToggle;
  emptied: EmptiedAction;
  /** A drum clean leaves nothing to empty: the door only needs opening to air it. */
  aired?: boolean;
}

/**
 * The one-tap action in a collapsed card's header: the announce bell while the run goes, the
 * mark-emptied button once it is done, nothing otherwise. A function rather than a component so a
 * state with no action leaves `ApplianceCard`'s quick slot out entirely (an empty slot still takes
 * up a gap in the header).
 */
export function applianceQuickButton({ collapsed, state, noun, announce, emptied, aired = false }: ApplianceQuickButtonArgs): ReactNode {
  if (!collapsed) return null;
  if (state === 'Running' && announce.exists) return <AnnounceBell announce={announce} variant='quick' />;
  if (state === 'Unemptied' && emptied.available) {
    return (
      <button
        type='button'
        className='appliance-quick-btn'
        onClick={emptied.press}
        disabled={emptied.pressed}
        aria-label={`Mark the ${noun} as ${aired ? 'aired' : 'emptied'}`}
        title={aired ? 'Mark aired' : 'Mark emptied'}
      >
        <Icon
          icon={emptied.pressed ? 'mdi:loading' : finishIcon(aired)}
          className={emptied.pressed ? 'appliance-spin' : ''}
          aria-hidden='true'
        />
      </button>
    );
  }
  return null;
}
