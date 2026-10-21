import { useState } from 'react';
import { Icon } from '@iconify/react';
import { useDueRows } from '../../hooks/useDueRows';
import { useViewer } from '../../hooks/useViewer';
import { MaintSheet } from '../Now/MaintSheet';

/** What needs doing in the room: its due `sensor.house_upcoming` rows, one chip each, that the viewer sees. A chip opens the
 * maintenance sheet the Now timeline opens, with Done where the row has it. */
export function RoomTodo({ areaId }: { areaId: string }) {
  const viewer = useViewer();
  const rows = useDueRows().filter(row => row.areaId === areaId);
  const [openId, setOpenId] = useState<string | null>(null);
  // The sheet reads the live row, so it follows a Done and closes with the row.
  const open = rows.find(row => row.id === openId) ?? null;
  if (rows.length === 0) return null;
  return (
    <section className='room-todo' aria-label='To do'>
      <span className='room-todo-label'>To do</span>
      <ul className='room-todo-list'>
        {rows.map(row => (
          <li key={row.id}>
            <button type='button' className='room-todo-chip' onClick={() => setOpenId(row.id)}>
              <Icon icon={row.icon} aria-hidden='true' />
              <span>{row.title}</span>
            </button>
          </li>
        ))}
      </ul>
      {open && <MaintSheet row={open} isAdmin={viewer.isAdmin === true} onClose={() => setOpenId(null)} />}
    </section>
  );
}
