import { useMemo } from 'react';
import { Icon } from '@iconify/react';
import type { HomePulseProps, PulseChip } from '../../types';
import { deriveHomePulseSummary } from '../../utils/homePulse';
import './HomePulse.css';

function PulseChipButton({ chip, onRoomSelect }: { chip: PulseChip; onRoomSelect?: (areaId: string) => void }) {
  const content = (
    <>
      <span className='home-pulse-chip-icon' aria-hidden='true'>
        <Icon icon={chip.icon} />
      </span>
      <span className='home-pulse-chip-label'>{chip.label}</span>
      {chip.areaId && onRoomSelect && <Icon icon='mdi:chevron-right' className='home-pulse-chip-arrow' aria-hidden='true' />}
    </>
  );

  if (chip.areaId && onRoomSelect) {
    return (
      <button
        type='button'
        className={`home-pulse-chip tone-${chip.tone} ${chip.pulse ? 'is-pulsing' : ''}`}
        onClick={() => onRoomSelect(chip.areaId as string)}
      >
        {content}
      </button>
    );
  }

  return <div className={`home-pulse-chip tone-${chip.tone}`}>{content}</div>;
}

export function HomePulse({ areas, entities, onRoomSelect }: HomePulseProps) {
  const summary = useMemo(() => deriveHomePulseSummary(areas, entities), [areas, entities]);

  if (!summary.insight && summary.chips.length === 0) {
    return null;
  }

  return (
    <section className='home-pulse' aria-label='Home Pulse'>
      <div className={`home-pulse-card tone-${summary.tone} ${summary.insight ? 'has-insight' : 'chips-only'}`}>
        {summary.insight && <p className='home-pulse-narrative'>{summary.insight.text}</p>}

        {summary.chips.length > 0 && (
          <div className='home-pulse-chips'>
            {summary.chips.map(chip => (
              <PulseChipButton key={chip.id} chip={chip} onRoomSelect={onRoomSelect} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
