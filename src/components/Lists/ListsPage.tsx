import { useState, type ReactNode, type TouchEvent } from 'react';
import { Icon } from '@iconify/react';
import { useSwipeToClose, useViewer } from '../../hooks';
import { useListVisibility } from '../../todo/useListVisibility';
import { useTodoLists } from '../../todo/useTodoLists';
import { visibleLists } from '../../todo/visibility';
import { ListCard } from './ListCard';
import { VisibilitySheet } from './VisibilitySheet';
import '../Appliance/Appliance.css';
import '../RoomDetail/RoomClimateHeader.css';
import './Lists.css';

interface ListsPageProps {
  onClose: () => void;
}

function Note({ icon, spin = false, role, children }: { icon: string; spin?: boolean; role?: 'status' | 'alert'; children?: ReactNode }) {
  return (
    <p className='lists-page-note' role={role}>
      <Icon icon={icon} className={spin ? 'appliance-spin' : undefined} aria-hidden='true' />
      {children}
    </p>
  );
}

/** The `#lists` page: one card per to-do list the viewer may see. An administrator sees them all and decides who sees which. */
export function ListsPage({ onClose }: ListsPageProps) {
  const viewer = useViewer();
  const lists = useTodoLists();
  const visibility = useListVisibility();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const swipe = useSwipeToClose(onClose);
  const onPage = (handler: ((e: TouchEvent) => void) | undefined) =>
    handler && ((e: TouchEvent) => e.currentTarget.contains(e.target as Node) && handler(e));

  const isAdmin = viewer.isAdmin === true;
  const listIds = lists.map(list => list.id);
  const allowed = visibleLists(listIds, viewer, visibility.doc);
  const shown = lists.filter(list => allowed.includes(list.id));

  let content: ReactNode;
  if (viewer.isAdmin === null || (!isAdmin && visibility.doc === null && !visibility.failed)) {
    content = <Note icon='mdi:loading' spin role='status' />;
  } else if (!isAdmin && visibility.doc === null) {
    content = (
      <Note icon='mdi:alert-circle-outline' role='alert'>
        Could not load the lists
      </Note>
    );
  } else if (shown.length === 0) {
    content = (
      <Note icon='mdi:clipboard-text-off-outline'>{isAdmin ? 'No to-do lists in Home Assistant' : 'No lists shared with you'}</Note>
    );
  } else {
    content = shown.map(list => <ListCard key={list.id} list={list} />);
  }

  return (
    <div
      className='lists-page'
      onTouchStart={onPage(swipe.handleTouchStart)}
      onTouchMove={onPage(swipe.handleTouchMove)}
      onTouchEnd={onPage(swipe.handleTouchEnd)}
    >
      <header className='lists-page-header'>
        <span className='lists-page-glyph' aria-hidden='true'>
          <Icon icon='mdi:format-list-checks' />
        </span>
        <h1 className='lists-page-title'>Lists</h1>
        {isAdmin && lists.length > 0 && (
          <button type='button' className='lists-icon-btn' onClick={() => setSettingsOpen(true)} aria-label='List visibility'>
            <Icon icon='mdi:account-eye-outline' aria-hidden='true' />
          </button>
        )}
      </header>

      <div className='lists-page-content'>{content}</div>

      <button type='button' className='lists-page-exit' onClick={onClose} aria-label='Close lists'>
        <Icon icon='mdi:close' aria-hidden='true' />
      </button>

      {isAdmin && settingsOpen && (
        <VisibilitySheet lists={lists} visibility={visibility} selfId={viewer.id} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
