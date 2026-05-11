import { Icon } from '@iconify/react';
import type { HassEntities } from '../../types';
import { PersonStatus } from './PersonStatus';
import './StatusBar.css';

interface StatusBarProps {
  entities: HassEntities;
  hassUrl: string | null;
  onMenuToggle: () => void;
}

export function StatusBar({ entities, hassUrl, onMenuToggle }: StatusBarProps) {
  const entityKeys = Object.keys(entities || {});
  const personEntities = entityKeys.filter(key => key.startsWith('person.'));

  return (
    <header className='status-bar'>
      <div className='status-bar-content'>
        <div className='people-section'>
          {personEntities.map(person => (
            <PersonStatus key={person} entity={person} entities={entities} hassUrl={hassUrl} />
          ))}
        </div>
        <div className='status-section'>
          <button className='sidebar-toggle-btn' onClick={onMenuToggle} title='Open menu' aria-label='Open menu'>
            <Icon icon='mdi:menu' />
          </button>
        </div>
      </div>
    </header>
  );
}
