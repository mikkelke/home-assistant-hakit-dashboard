import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@iconify/react';
import type { PersonStatusProps } from '../../types';
import { Timeline } from '../Timeline';
import { useSwipeToClose } from '../../hooks';
import './StatusBar.css';

export function PersonStatus({ entity, entities, hassUrl }: PersonStatusProps) {
  const person = entities?.[entity];
  const name = typeof person?.attributes?.friendly_name === 'string' ? person.attributes.friendly_name : (entity.split('.')[1] || '');
  const state = String(person?.state ?? 'unknown');
  const picture = typeof person?.attributes?.entity_picture === 'string' ? person.attributes.entity_picture : undefined;

  const [showInfo, setShowInfo] = useState(false);
  const showInfoRef = useRef(showInfo);

  // Keep ref in sync with state
  useEffect(() => {
    showInfoRef.current = showInfo;
  }, [showInfo]);

  // Handle browser back button and body class
  useEffect(() => {
    if (showInfo) {
      // Add class to body to disable room card clicks
      document.body.classList.add('modal-open');

      const handlePopState = (event: PopStateEvent) => {
        if (showInfoRef.current) {
          event.stopImmediatePropagation();
          setShowInfo(false);
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
        window.history.pushState({ timeline: entity }, '', window.location.pathname);
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
  }, [showInfo, entity]);

  const handleClose = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    setShowInfo(false);
  };

  // Use standardized swipe-to-close hook (must be called unconditionally)
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(handleClose);

  if (!person) return null;

  // Check sleep mode - pattern: input_boolean.{firstname}_sleep_mode
  const firstName = name.toLowerCase().split(' ')[0];
  const sleepModeId = `input_boolean.${firstName}_sleep_mode`;
  const isSleeping = entities?.[sleepModeId]?.state === 'on';

  const isHome = state === 'home';
  const isAway = state !== 'home';

  const imageUrl = picture ? (picture.startsWith('http') ? picture : `${hassUrl ?? ''}${picture}`) : null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setShowInfo(false);
  };

  const handleModalClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  const modalContent = showInfo ? (
    <div className='person-info-overlay' role='presentation' onClick={handleOverlayClick} onMouseDown={e => e.stopPropagation()}>
      <div
        className='person-info-modal person-timeline-modal'
        role='dialog'
        aria-label={`${name} timeline`}
        onClick={handleModalClick}
        onMouseDown={e => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className='modal-header'>
          <span className='modal-title'>{name} Timeline</span>
          <button className='modal-close modal-close-button' onClick={handleClose} onMouseDown={e => e.stopPropagation()}>
            <Icon icon='mdi:close' />
          </button>
        </div>
        <div className='modal-timeline-content'>
          <Timeline entityId={entity} entity={person} hassUrl={hassUrl} hours={168} limit={100} />
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <div
        className={`person-card ${isSleeping ? 'sleeping' : ''} ${isAway ? 'away' : ''}`}
        onClick={() => setShowInfo(true)}
        role='button'
        tabIndex={0}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setShowInfo(true);
          }
        }}
      >
        <div className='person-avatar'>
          {imageUrl ? <img src={imageUrl} alt={name} /> : <div className='person-initials'>{name ? name.charAt(0).toUpperCase() : ''}</div>}
          <div className={`person-status-dot ${isHome ? 'home' : 'away'}`} />
          {isSleeping && (
            <div className='person-sleep-indicator' title='Sleeping'>
              <Icon icon='mdi:sleep' />
            </div>
          )}
        </div>
        <span className='person-name'>{name}</span>
        <span className='person-state'>{isSleeping ? 'Sleeping' : isHome ? 'Home' : 'Away'}</span>
      </div>

      {typeof document !== 'undefined' && createPortal(modalContent, document.body)}
    </>
  );
}
