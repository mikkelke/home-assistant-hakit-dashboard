import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@iconify/react';
import type { PersonStatusProps } from '../../types';
import { getAccessibleHistoryWindow, getHistoryUrl, replaceHistoryState } from '../../utils/navigation';
import { LazyTimeline } from '../Timeline';
import { useSwipeToClose } from '../../hooks';
import './StatusBar.css';

function timelineHistoryUrl(): string {
  return getHistoryUrl();
}

function withHistoryWindow(action: (targetWindow: Window) => void) {
  const targetWindow = getAccessibleHistoryWindow();
  if (!targetWindow) return;
  action(targetWindow);
}

type AvatarSize = 'sky' | 'strip';

interface PersonAvatarProps extends PersonStatusProps {
  size?: AvatarSize;
  /** Rings the avatar of the person looking at the dashboard. */
  isViewer?: boolean;
}

interface PersonLook {
  name: string;
  isHome: boolean;
  isSleeping: boolean;
  imageUrl: string | null;
}

function personLook(entity: string, entities: PersonStatusProps['entities'], hassUrl: string | null): PersonLook | null {
  const person = entities?.[entity];
  if (!person) return null;
  const name = typeof person.attributes?.friendly_name === 'string' ? person.attributes.friendly_name : entity.split('.')[1] || '';
  const picture = typeof person.attributes?.entity_picture === 'string' ? person.attributes.entity_picture : undefined;
  // Sleep mode pattern: input_boolean.{firstname}_sleep_mode
  const firstName = name.toLowerCase().split(' ')[0];
  return {
    name,
    isHome: String(person.state) === 'home',
    isSleeping: entities?.[`input_boolean.${firstName}_sleep_mode`]?.state === 'on',
    imageUrl: picture ? (picture.startsWith('http') ? picture : `${hassUrl ?? ''}${picture}`) : null,
  };
}

function AvatarFace({ look, size, isViewer }: { look: PersonLook; size: AvatarSize; isViewer: boolean }) {
  return (
    <span
      className={`sky-av sky-av--${size} ${look.isHome ? '' : 'is-away'} ${look.isSleeping ? 'is-asleep' : ''} ${isViewer ? 'is-you' : ''}`}
      aria-hidden='true'
    >
      <span className='sky-av-face'>{look.imageUrl ? <img src={look.imageUrl} alt='' /> : look.name.charAt(0).toUpperCase()}</span>
      {look.isSleeping ? (
        <i className='sky-av-zz'>
          <Icon icon='mdi:moon-waning-crescent' />
        </i>
      ) : (
        look.isHome && <i className='sky-av-dot' />
      )}
    </span>
  );
}

function stateWord(look: PersonLook): string {
  return look.isSleeping ? 'asleep' : look.isHome ? 'home' : 'away';
}

/** A person's avatar for display only. */
export function PersonAvatar({ entity, entities, hassUrl, size = 'strip', isViewer = false }: PersonAvatarProps) {
  const look = personLook(entity, entities, hassUrl);
  if (!look) return null;
  return (
    <span className='sky-av-slot' role='img' aria-label={`${look.name}, ${stateWord(look)}`}>
      <AvatarFace look={look} size={size} isViewer={isViewer} />
    </span>
  );
}

/** A person's avatar; a tap opens their presence timeline. */
export function PersonStatus({ entity, entities, hassUrl, size = 'sky' }: PersonAvatarProps) {
  const person = entities?.[entity];
  const look = personLook(entity, entities, hassUrl);
  const name = look?.name ?? '';

  const [showInfo, setShowInfo] = useState(false);
  const showInfoRef = useRef(showInfo);

  // Keep ref in sync with state
  useEffect(() => {
    showInfoRef.current = showInfo;
  }, [showInfo]);

  // Handle browser back button and body class
  useEffect(() => {
    if (showInfo) {
      const targetWindow = getAccessibleHistoryWindow();
      if (!targetWindow) return;

      // Add class to body to disable room card clicks
      document.body.classList.add('modal-open');

      const handlePopState = (event: PopStateEvent) => {
        if (showInfoRef.current) {
          event.stopImmediatePropagation();
          setShowInfo(false);
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
          targetWindow.history.pushState({ timeline: entity }, '', timelineHistoryUrl());
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

  if (!look) return null;

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
          <LazyTimeline entityId={entity} entity={person} hassUrl={hassUrl} hours={168} limit={100} />
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button type='button' className='sky-av-slot' onClick={() => setShowInfo(true)} aria-label={`${name}, ${stateWord(look)}`}>
        <AvatarFace look={look} size={size} isViewer={false} />
      </button>

      {typeof document !== 'undefined' && createPortal(modalContent, document.body)}
    </>
  );
}
