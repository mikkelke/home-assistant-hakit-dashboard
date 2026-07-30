import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import { attrNum } from '../../types';
import { useLocalStorageBoolean, useTouchScrollSlopGuard } from '../../hooks';
import './CoverCard.css';

// Blind card — same collapsed-by-default iOS shell as HeatCard/TonightCard. Presentation only:
// every value here comes straight off the cover entity, this component never computes anything
// beyond the open/closed word derived from its own reported position.

interface CoverCardProps {
  areaName: string;
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

export function CoverCard({ areaName, entities, callService }: CoverCardProps) {
  const headerSlop = useTouchScrollSlopGuard();
  const areaNameNormalized = areaName.toLowerCase().replace(/\s+/g, '_');
  const [collapsed, setCollapsed] = useLocalStorageBoolean(`covercard-collapsed-${areaNameNormalized}`, true);

  // Entity ID
  const coverId = `cover.${areaNameNormalized}_blind`;
  const cover = entities?.[coverId];

  // HA reports 0 = closed, 100 = open. We want UI showing 0=open, 100=closed.
  const devicePosition = attrNum(cover?.attributes?.current_position, 0); // HA: 0 = open, 100 = closed
  const uiPosition = devicePosition; // UI matches HA: 0 open, 100 closed
  const isBathroom = areaNameNormalized === 'bathroom';
  const isBedroom = areaNameNormalized === 'bedroom';
  const [sliderValue, setSliderValue] = useState(uiPosition);

  // keep slider in sync with HA updates (defer to avoid sync setState in effect)
  useEffect(() => {
    if (!Number.isNaN(uiPosition)) {
      const id = setTimeout(() => setSliderValue(uiPosition), 0);
      return () => clearTimeout(id);
    }
  }, [uiPosition]);

  if (!cover) return null;

  const state = String(cover.state ?? ''); // open, closed, opening, closing
  const isOpen = state === 'open';
  const isClosed = state === 'closed';
  const isMoving = state === 'opening' || state === 'closing';

  const positionWord = sliderValue <= 0 ? 'Open' : sliderValue >= 100 ? 'Closed' : `${sliderValue}%`;
  const movingWord = state === 'opening' ? 'Opening…' : 'Closing…';

  const handleOpen = () => {
    if (!callService) return;
    // For bathroom and bedroom, "up" (open_cover) actually closes the blinds
    if (isBathroom || isBedroom) {
      callService({
        domain: 'cover',
        service: 'close_cover',
        target: { entity_id: coverId },
      });
    } else {
      callService({
        domain: 'cover',
        service: 'open_cover',
        target: { entity_id: coverId },
      });
    }
  };

  const handleClose = () => {
    if (!callService) return;
    // For bathroom and bedroom, "down" (close_cover) actually opens the blinds
    if (isBathroom || isBedroom) {
      callService({
        domain: 'cover',
        service: 'open_cover',
        target: { entity_id: coverId },
      });
    } else {
      callService({
        domain: 'cover',
        service: 'close_cover',
        target: { entity_id: coverId },
      });
    }
  };

  const handleStop = () => {
    if (!callService) return;
    callService({
      domain: 'cover',
      service: 'stop_cover',
      target: { entity_id: coverId },
    });
  };

  // The household's one meaningful preset: ~38-40% blocks direct sun while keeping
  // daylight — the same position the solar-shade routine drives to. "Default" where
  // the motor runs inverted (bathroom/bedroom), "Day" elsewhere.
  const dayPreset = isBathroom ? 40 : 38;
  const dayLabel = isBathroom || isBedroom ? 'Default' : 'Day';
  const isAtDay = !isMoving && Math.abs(sliderValue - dayPreset) <= 2;

  const handleDay = () => {
    if (!callService) return;
    callService({
      domain: 'cover',
      service: 'set_cover_position',
      target: { entity_id: coverId },
      serviceData: { position: dayPreset },
    });
  };

  return (
    <div className='cover-card'>
      {/* Header - collapsed view */}
      <div
        className='cover-header'
        onClick={() => {
          if (headerSlop.consumeBlockClick()) return;
          setCollapsed(v => !v);
        }}
        onTouchStart={headerSlop.onTouchStart}
        onTouchMove={headerSlop.onTouchMove}
        onTouchEnd={headerSlop.onTouchEnd}
        onTouchCancel={headerSlop.onTouchCancel}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setCollapsed(v => !v);
          }
        }}
        role='button'
        tabIndex={0}
        aria-expanded={!collapsed}
      >
        <span className='cover-glyph'>
          <Icon icon='mdi:blinds' aria-hidden='true' />
        </span>
        <span className='cover-title'>Blind</span>
        <span className='cover-header-right'>
          <span className={`cover-word ${isMoving ? 'tint' : 'muted'}`}>{isMoving ? movingWord : positionWord}</span>
          <Icon icon={collapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'} aria-hidden='true' className='cover-chevron' />
        </span>
      </div>

      {/* Expanded content */}
      {!collapsed && (
        <div className='cover-content'>
          <div className='cover-hero'>
            <div className='cover-hero-value'>{positionWord}</div>
          </div>

          <div className='cover-controls'>
            <button type='button' className={`cover-btn ${isOpen ? 'active' : ''}`} onClick={handleOpen}>
              <Icon icon='mdi:arrow-down-bold' />
              <span>Open</span>
            </button>
            <button type='button' className={`cover-btn ${isAtDay ? 'active' : ''}`} onClick={handleDay}>
              <Icon icon='mdi:blinds-horizontal' />
              <span>{dayLabel}</span>
            </button>
            <button type='button' className='cover-btn stop' onClick={handleStop}>
              <Icon icon='mdi:stop' />
              <span>Stop</span>
            </button>
            <button type='button' className={`cover-btn ${isClosed ? 'active' : ''}`} onClick={handleClose}>
              <Icon icon='mdi:arrow-up-bold' />
              <span>Close</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
