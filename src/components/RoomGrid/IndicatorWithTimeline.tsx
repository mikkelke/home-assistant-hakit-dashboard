import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useHass } from '@hakit/core';
import { Icon } from '@iconify/react';
import { getAccessibleHistoryWindow, getHistoryUrl, replaceHistoryState } from '../../utils/navigation';
import { LazyTimeline } from '../Timeline';
import type { HassEntity } from '../../types';

function timelineHistoryUrl(): string {
  return getHistoryUrl();
}

function withHistoryWindow(action: (targetWindow: Window) => void) {
  const targetWindow = getAccessibleHistoryWindow();
  if (!targetWindow) return;
  action(targetWindow);
}

interface IndicatorWithTimelineProps {
  entityId: string;
  hassUrl: string | null;
  className: string;
  title: string;
  icon: string;
  label?: string;
  /** When set, used for timeline modal title instead of HA friendly_name */
  modalTitle?: string;
  secondaryEntityId?: string; // Optional secondary entity for combined timeline (e.g., completion tracking)
}

/** An icon that opens the entity's history. It follows only whether the entity exists; the modal shows
 * the entity as it was when tapped, so a live change neither re-renders it nor closes it. */
export function IndicatorWithTimeline({
  entityId,
  hassUrl,
  className,
  title,
  icon,
  label,
  modalTitle,
  secondaryEntityId,
}: IndicatorWithTimelineProps) {
  const exists = useHass(s => s.entities[entityId] != null);
  const [opened, setOpened] = useState<HassEntity | null>(null);
  const showTimeline = opened != null;
  const showTimelineRef = useRef(showTimeline);

  // Keep ref in sync with state
  useEffect(() => {
    showTimelineRef.current = showTimeline;
  }, [showTimeline]);

  // Handle browser back button and body class
  useEffect(() => {
    if (showTimeline) {
      const targetWindow = getAccessibleHistoryWindow();
      if (!targetWindow) return;

      // Add class to body to disable room card clicks
      document.body.classList.add('modal-open');

      const handlePopState = (event: PopStateEvent) => {
        if (showTimelineRef.current) {
          event.stopImmediatePropagation();
          setOpened(null);
          // Replace current state so back button works correctly
          try {
            withHistoryWindow(targetWindow => {
              replaceHistoryState(targetWindow, { timeline: null }, timelineHistoryUrl());
            });
          } catch {
            // Silently fail if history API is not supported
          }
        }
      };

      // Push state when opening modal
      try {
        withHistoryWindow(targetWindow => {
          targetWindow.history.pushState({ timeline: entityId }, '', timelineHistoryUrl());
        });
      } catch {
        // Silently fail if history API is not supported
      }

      targetWindow.addEventListener('popstate', handlePopState, { capture: true });
      return () => {
        targetWindow.removeEventListener('popstate', handlePopState, { capture: true });
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
    setOpened(useHass.getState().entities[entityId] ?? null);
  };

  const handleClose = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    setOpened(null);
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

  // Extract friendly name from entity attributes
  // Use the name as-is from Home Assistant, just ensure first letter is capitalized
  const rawName = opened?.attributes?.friendly_name;
  const baseName = typeof rawName === 'string' ? rawName : entityId.split('.')[1].replace(/_/g, ' ');
  const entityName = baseName.charAt(0).toUpperCase() + baseName.slice(1);
  const timelineHeading = modalTitle?.trim() || entityName;

  const modalContent = opened ? (
    <div className='person-info-overlay' role='presentation' onClick={handleOverlayClick} onMouseDown={e => e.stopPropagation()}>
      <div
        className='person-info-modal person-timeline-modal'
        role='dialog'
        aria-label={`${timelineHeading} timeline`}
        onClick={handleModalClick}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className='modal-header'>
          <span className='modal-title'>{timelineHeading}</span>
          <button className='modal-close' onClick={handleClose} onMouseDown={e => e.stopPropagation()}>
            <Icon icon='mdi:close' />
          </button>
        </div>
        <div className='modal-timeline-content'>
          <LazyTimeline
            entityId={entityId}
            entity={opened}
            hassUrl={hassUrl}
            hours={168}
            limit={100}
            secondaryEntityId={secondaryEntityId}
          />
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {exists && (
        <div className={className} title={title} onClick={handleClick} style={{ cursor: 'pointer' }}>
          <Icon icon={icon} />
          {label && <span className='indicator-label'>{label}</span>}
        </div>
      )}

      {typeof document !== 'undefined' && createPortal(modalContent, document.body)}
    </>
  );
}
