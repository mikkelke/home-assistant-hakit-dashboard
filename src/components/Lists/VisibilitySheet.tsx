import { useState } from 'react';
import { Icon } from '@iconify/react';
import type { TodoList } from '../../todo/lists';
import type { ListVisibility } from '../../todo/useListVisibility';
import { useShareableUsers } from '../../todo/useShareableUsers';
import { isShownTo, withVisibility } from '../../todo/visibility';
import { ApplianceSheet } from '../Appliance';

interface VisibilitySheetProps {
  lists: readonly TodoList[];
  visibility: ListVisibility;
  /** The administrator's own id: they see every list, so no switch is for them. */
  selfId: string | null;
  onClose: () => void;
}

export function VisibilitySheet({ lists, visibility, selfId, onClose }: VisibilitySheetProps) {
  const { status, users } = useShareableUsers(selfId);
  const { doc, change } = visibility;
  const [saveFailed, setSaveFailed] = useState(false);

  const toggle = (listId: string, userId: string, shown: boolean) => {
    setSaveFailed(false);
    change(current => withVisibility(current, listId, userId, shown)).catch(() => setSaveFailed(true));
  };

  const failed = status === 'error' || visibility.failed;

  return (
    <ApplianceSheet
      accentClassName='climate-sheet lists-sheet'
      glyphIcon='mdi:account-eye-outline'
      title='Visibility'
      historyKey='lists-visibility'
      onClose={onClose}
    >
      <div className='climate-scroll' tabIndex={0} role='region' aria-label='Who sees which list'>
        {failed ? (
          <p className='lists-vis-note is-error' role='alert'>
            <Icon icon='mdi:alert-circle-outline' aria-hidden='true' />
            Could not load who the lists can be shown to
          </p>
        ) : status !== 'ready' || doc === null ? (
          <p className='lists-vis-note' role='status' aria-label='Loading'>
            <Icon icon='mdi:loading' className='appliance-spin' aria-hidden='true' />
          </p>
        ) : users.length === 0 ? (
          <p className='lists-vis-note'>No one else to show the lists to</p>
        ) : (
          <ul className='lists-vis'>
            {lists.map(list => (
              <li key={list.id} className='lists-vis-row'>
                <span className='lists-vis-name'>
                  <Icon icon={list.icon} aria-hidden='true' />
                  {list.name}
                </span>
                <div className='lists-vis-users' role='group' aria-label={`Who sees ${list.name}`}>
                  {users.map(user => {
                    const shown = isShownTo(doc, list.id, user.id);
                    return (
                      <button
                        key={user.id}
                        type='button'
                        role='switch'
                        aria-checked={shown}
                        className={`lists-vis-chip ${shown ? 'is-on' : ''}`}
                        onClick={() => toggle(list.id, user.id, !shown)}
                      >
                        <Icon icon={shown ? 'mdi:eye-outline' : 'mdi:eye-off-outline'} aria-hidden='true' />
                        {user.label}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
        {saveFailed && (
          <p className='lists-vis-note is-error' role='alert'>
            <Icon icon='mdi:alert-circle-outline' aria-hidden='true' />
            Not saved. Try again.
          </p>
        )}
      </div>
    </ApplianceSheet>
  );
}
