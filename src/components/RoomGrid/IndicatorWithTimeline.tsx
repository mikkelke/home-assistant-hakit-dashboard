import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@iconify/react';
import { Timeline } from '../Timeline';
import type { HassEntities } from '../../types';

interface IndicatorWithTimelineProps {
  entityId: string;
  entities: HassEntities;
  hassUrl: string | null;
  className: string;
  title: string;
  icon: string;
  label?: string;
  secondaryEntityId?: string; // Optional secondary entity for combined timeline (e.g., completion tracking)
}

export function IndicatorWithTimeline({
  entityId,
  entities,
  hassUrl,
  className,
  title,
  icon,
  label,
  secondaryEntityId,
}: IndicatorWithTimelineProps) {
  const [showTimeline, setShowTimeline] = useState(false);
  const showTimelineRef = useRef(showTimeline);
  const entity = entities[entityId];

  // Keep ref in sync with state
  useEffect(() => {
    showTimelineRef.current = showTimeline;
  }, [showTimeline]);

  // Handle browser back button and body class
  useEffect(() => {
    if (showTimeline) {
      // Add class to body to disable room card clicks
      document.body.classList.add('modal-open');

      const handlePopState = (event: PopStateEvent) => {
        if (showTimelineRef.current) {
          event.stopImmediatePropagation();
          setShowTimeline(false);
          // Replace current state so back button works correctly
          try {
            window.history.replaceState({ timeline: null }, '', window.location.pathname);
          } catch {
            // Silently fail if history API is not supported
          }
        }
      };

      // Push state when opening modal
      try {
        window.history.pushState({ timeline: entityId }, '', window.location.pathname);
      } catch {
        // Silently fail if history API is not supported
      }

      window.addEventListener('popstate', handlePopState, { capture: true });
      return () => {
        window.removeEventListener('popstate', handlePopState, { capture: true });
        // Remove class when modal closes
        document.body.classList.remove('modal-open');
      };
    } else {
      // Remove class when modal is not open
      document.body.classList.remove('modal-open');
    }
  }, [showTimeline, entityId]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent room card click
    e.preventDefault(); // Prevent any default behavior
    setShowTimeline(true);
  };

  const handleClose = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    setShowTimeline(false);
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    handleClose();
  };

  const handleModalClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  if (!entity) return null;

  // Extract friendly name from entity attributes
  // Use the name as-is from Home Assistant, just ensure first letter is capitalized
  const rawName = entity.attributes?.friendly_name;
  const baseName = typeof rawName === 'string' ? rawName : entityId.split('.')[1].replace(/_/g, ' ');
  const entityName = baseName.charAt(0).toUpperCase() + baseName.slice(1);

  const modalContent = showTimeline ? (
    <div className='person-info-overlay' role='presentation' onClick={handleOverlayClick} onMouseDown={e => e.stopPropagation()}>
      <div
        className='person-info-modal person-timeline-modal'
        role='dialog'
        aria-label={`${entityName} timeline`}
        onClick={handleModalClick}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className='modal-header'>
          <span className='modal-title'>{entityName}</span>
          <button className='modal-close' onClick={handleClose} onMouseDown={e => e.stopPropagation()}>
            <Icon icon='mdi:close' />
          </button>
        </div>
        <div className='modal-timeline-content'>
          <Timeline entityId={entityId} entity={entity} hassUrl={hassUrl} hours={168} limit={100} secondaryEntityId={secondaryEntityId} />
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className={className} title={title} onClick={handleClick} style={{ cursor: 'pointer' }}>
        <Icon icon={icon} />
        {label && <span className='indicator-label'>{label}</span>}
      </div>

      {typeof document !== 'undefined' && createPortal(modalContent, document.body)}
    </>
  );
}
