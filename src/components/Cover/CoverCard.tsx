import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import { attrNum } from '../../types';
import './CoverCard.css';

interface CoverCardProps {
  areaName: string;
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

export function CoverCard({ areaName, entities, callService }: CoverCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const areaNameNormalized = areaName.toLowerCase().replace(/\s+/g, '_');

  // Entity ID
  const coverId = `cover.${areaNameNormalized}_blind`;
  const cover = entities?.[coverId];

  // HA reports 0 = closed, 100 = open. We want UI showing 0=open, 100=closed.
  const devicePosition = attrNum(cover?.attributes?.current_position, 0); // HA: 0 = open, 100 = closed
  const uiPosition = devicePosition; // UI matches HA: 0 open, 100 closed
  const isBathroom = areaNameNormalized === 'bathroom';
  const isBedroom = areaNameNormalized === 'bedroom';
  const dayPreset = isBathroom ? 40 : 38;
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

  // Highlight buttons based on current position
  // Down arrow (dayPreset) highlighted when position is 38% (bedroom) or 40% (bathroom)
  const isDownHighlighted = Math.abs(sliderValue - dayPreset) <= 1; // Allow 1% tolerance
  // Up arrow (100%) highlighted when position is 99-100%
  const isUpHighlighted = sliderValue >= 99;

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

  const handlePositionCommit = (uiPos: number) => {
    if (!callService) return;
    const devicePos = Math.max(0, Math.min(100, uiPos));
    callService({
      domain: 'cover',
      service: 'set_cover_position',
      target: { entity_id: coverId },
      serviceData: { position: devicePos },
    });
  };

  return (
    <div className={`cover-card ${isExpanded ? 'expanded' : ''}`}>
      {/* Header - Collapsed View */}
      <div
        className='cover-header'
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
        role='button'
        tabIndex={0}
        aria-expanded={isExpanded}
      >
        <div className='cover-header-info'>
          <Icon icon='mdi:blinds' className='cover-icon' />
          <div className='cover-status'>
            <span className='cover-name'>Blinds</span>
            <span className='cover-position'>{sliderValue}% closed</span>
          </div>
        </div>
        <div className='cover-header-right'>
          <div className='cover-quick-actions'>
            <button
              className={`cover-quick-btn ${isUpHighlighted ? 'active' : ''}`}
              onClick={e => {
                e.stopPropagation();
                handlePositionCommit(100);
              }}
              title='Close (100%)'
            >
              <Icon icon='mdi:arrow-up-bold' />
            </button>
            <button
              className={`cover-quick-btn ${isDownHighlighted ? 'active' : ''}`}
              onClick={e => {
                e.stopPropagation();
                handlePositionCommit(dayPreset);
              }}
              title={`Open (${dayPreset}%)`}
            >
              <Icon icon='mdi:arrow-down-bold' />
            </button>
          </div>
          <span className={`cover-state ${state}`}>
            {isMoving && <Icon icon='mdi:loading' className='spinning' />}
            {state}
          </span>
          <Icon icon={isExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} />
        </div>
      </div>

      {/* Expanded view */}
      {isExpanded && (
        <div className='cover-content'>
          {/* Visual representation - blinds open from top (retract upward) */}
          <div className='cover-visual'>
            <div className='cover-window'>
              <div className='cover-blind' style={{ height: `${sliderValue}%` }} />
            </div>
            <span className='cover-percent'>{sliderValue}% closed</span>
          </div>

          {/* Control buttons */}
          <div className='cover-controls'>
            <button className={`cover-btn ${isOpen ? 'active' : ''}`} onClick={handleOpen}>
              <Icon icon='mdi:arrow-down-bold' />
              <span>Open</span>
            </button>
            <button className='cover-btn stop' onClick={handleStop}>
              <Icon icon='mdi:stop' />
              <span>Stop</span>
            </button>
            <button className={`cover-btn ${isClosed ? 'active' : ''}`} onClick={handleClose}>
              <Icon icon='mdi:arrow-up-bold' />
              <span>Close</span>
            </button>
          </div>

          {/* Quick positions */}
          <div className='cover-presets'>
            {[
              { label: 'Open (0%)', value: 0 },
              { label: `${isBathroom || isBedroom ? 'Default' : 'Day'} (${dayPreset}%)`, value: dayPreset },
              ...(isBathroom || isBedroom
                ? []
                : [
                    { label: '50%', value: 50 },
                    { label: '75%', value: 75 },
                  ]),
              { label: 'Closed (100%)', value: 100 },
            ].map(preset => (
              <button key={`${preset.label}-${preset.value}`} className='preset-btn' onClick={() => handlePositionCommit(preset.value)}>
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
