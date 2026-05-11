import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@iconify/react';
import type { HassEntities } from '../../types';
import {
  VACUUM_ENTITY,
  ROBOT_CLEANING_NARRATIVE_ENTITY,
  VACUUM_BATTERY_SENSOR,
  VACUUM_CLEANING_PROGRESS_SENSOR,
  ROBOT_PAUSED_BOOLEAN_ENTITY,
  ROBOT_PAUSE_REASON_ENTITY,
} from '../../config/entities';
import { Timeline } from '../Timeline';
import { RobotCleaningNarrativeTimeline } from './RobotCleaningNarrativeTimeline';
import './OfficeVacuumIndicator.css';

type OfficeVacuumTab = 'robot' | 'cleaning';

function vacuumStateLabel(state: string | undefined): string {
  if (!state) return 'Unknown';
  const stateLower = state.toLowerCase();
  const map: Record<string, string> = {
    cleaning: 'Cleaning',
    returning: 'Returning to dock',
    docked: 'Docked',
    paused: 'Paused',
    idle: 'Idle',
    off: 'Off',
    error: 'Error',
    unavailable: 'Unavailable',
    unknown: 'Unknown',
  };
  return map[stateLower] || state.charAt(0).toUpperCase() + state.slice(1);
}

function resolveNarrativeHeadline(entities: HassEntities): string | null {
  const ent = entities[ROBOT_CLEANING_NARRATIVE_ENTITY];
  const s = typeof ent?.state === 'string' ? ent.state.trim() : '';
  if (!s) return null;
  const sl = s.toLowerCase();
  if (sl === 'unknown' || sl === 'unavailable') return null;
  return s;
}

function buildRobotMetaLine(entities: HassEntities): string | null {
  const parts: string[] = [];
  const batRaw = entities[VACUUM_BATTERY_SENSOR]?.state;
  if (batRaw != null && batRaw !== '' && batRaw !== 'unknown' && batRaw !== 'unavailable') {
    const n = Number(batRaw);
    if (!Number.isNaN(n)) parts.push(`Battery ${Math.round(n)}%`);
  } else {
    const attr = entities[VACUUM_ENTITY]?.attributes?.battery_level;
    if (attr !== undefined && attr !== null) {
      const n = Number(attr);
      if (!Number.isNaN(n)) parts.push(`Battery ${Math.round(n)}%`);
    }
  }
  const progRaw = entities[VACUUM_CLEANING_PROGRESS_SENSOR]?.state;
  if (progRaw != null && progRaw !== '' && progRaw !== 'unknown' && progRaw !== 'unavailable') {
    const n = Number(progRaw);
    if (!Number.isNaN(n)) parts.push(`${Math.round(Math.max(0, Math.min(100, n)))}% progress`);
  }
  if (entities[ROBOT_PAUSED_BOOLEAN_ENTITY]?.state === 'on') {
    const reason = typeof entities[ROBOT_PAUSE_REASON_ENTITY]?.state === 'string' ? entities[ROBOT_PAUSE_REASON_ENTITY].state.trim() : '';
    parts.push(reason ? `Paused: ${reason.slice(0, 120)}` : 'Paused');
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function vacuumStateIcon(state: string | undefined): string {
  const s = (state || '').toLowerCase();
  switch (s) {
    case 'cleaning':
      return 'mdi:robot-vacuum';
    case 'docked':
      return 'mdi:robot-vacuum-variant';
    case 'returning':
      return 'mdi:home-import-outline';
    case 'paused':
      return 'mdi:pause-circle';
    case 'error':
      return 'mdi:alert-circle';
    case 'off':
      return 'mdi:power';
    default:
      return 'mdi:robot-vacuum';
  }
}

interface OfficeVacuumIndicatorProps {
  entities: HassEntities;
  hassUrl: string | null;
  cleaningToggleId: string;
  lastCleanId: string | null;
  cleaningRequested: boolean;
  className: string;
  title: string;
}

export function OfficeVacuumIndicator({
  entities,
  hassUrl,
  cleaningToggleId,
  lastCleanId,
  cleaningRequested,
  className,
  title,
}: OfficeVacuumIndicatorProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<OfficeVacuumTab>('robot');
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handlePopState = (event: PopStateEvent) => {
      if (openRef.current) {
        event.stopImmediatePropagation();
        setOpen(false);
        try {
          window.history.replaceState({ officeVacuumModal: null }, '', window.location.pathname);
        } catch {
          /* ignore */
        }
      }
    };

    try {
      window.history.pushState({ officeVacuumModal: true }, '', window.location.pathname);
    } catch {
      /* ignore */
    }

    document.body.classList.add('modal-open');
    window.addEventListener('popstate', handlePopState, { capture: true });
    return () => {
      window.removeEventListener('popstate', handlePopState, { capture: true });
      document.body.classList.remove('modal-open');
    };
  }, [open]);

  const vacuum = entities[VACUUM_ENTITY];
  const cleaningEntity = entities[cleaningToggleId];
  const hasCleaningTab = !!cleaningEntity;

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setTab('robot');
    setOpen(true);
  };

  const handleClose = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    setOpen(false);
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

  if (!vacuum) return null;

  const rawState = vacuum.state;
  const headline = resolveNarrativeHeadline(entities) ?? vacuumStateLabel(rawState);
  const metaLine = buildRobotMetaLine(entities);

  const robotStatePanel = (
    <div className='office-vacuum-modal__panel office-vacuum-modal__panel--robot' role='tabpanel'>
      <div className='office-vacuum-modal__current'>
        <Icon icon={vacuumStateIcon(rawState)} className='office-vacuum-modal__current-icon' aria-hidden />
        <div className='office-vacuum-modal__current-text'>
          <span className='office-vacuum-modal__current-label'>{headline}</span>
          {metaLine ? <span className='office-vacuum-modal__current-meta'>{metaLine}</span> : null}
        </div>
      </div>
      <p className='office-vacuum-modal__history-caption'>Story</p>
      <div className='office-vacuum-modal__timeline-wrap'>
        <RobotCleaningNarrativeTimeline hassUrl={hassUrl} enabled={open} hours={168} limit={100} showPhaseTrack />
      </div>
    </div>
  );

  const modal = !open ? null : hasCleaningTab ? (
    <div className='person-info-overlay' role='presentation' onClick={handleOverlayClick} onMouseDown={e => e.stopPropagation()}>
      <div
        className='person-info-modal person-timeline-modal office-vacuum-modal'
        role='dialog'
        aria-label='Office robot vacuum'
        onClick={handleModalClick}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className='modal-header office-vacuum-modal__header'>
          <span className='modal-title'>Robot</span>
          <button type='button' className='modal-close' onClick={handleClose} onMouseDown={e => e.stopPropagation()}>
            <Icon icon='mdi:close' />
          </button>
        </div>
        <div className='office-vacuum-modal__tabs' role='tablist'>
          <button
            type='button'
            role='tab'
            aria-selected={tab === 'robot'}
            className={`office-vacuum-modal__tab ${tab === 'robot' ? 'active' : ''}`}
            onClick={() => setTab('robot')}
          >
            <Icon icon='mdi:robot-vacuum' />
            State
          </button>
          <button
            type='button'
            role='tab'
            aria-selected={tab === 'cleaning'}
            className={`office-vacuum-modal__tab ${tab === 'cleaning' ? 'active' : ''}`}
            onClick={() => setTab('cleaning')}
          >
            <Icon icon='mdi:broom' />
            Room clean
          </button>
        </div>
        {tab === 'robot' && robotStatePanel}
        {tab === 'cleaning' && cleaningEntity && (
          <div className='modal-timeline-content office-vacuum-modal__panel office-vacuum-modal__panel--cleaning' role='tabpanel'>
            <Timeline
              entityId={cleaningToggleId}
              entity={cleaningEntity}
              hassUrl={hassUrl}
              hours={168}
              limit={100}
              secondaryEntityId={lastCleanId || undefined}
            />
          </div>
        )}
      </div>
    </div>
  ) : (
    <div className='person-info-overlay' role='presentation' onClick={handleOverlayClick} onMouseDown={e => e.stopPropagation()}>
      <div
        className='person-info-modal person-timeline-modal office-vacuum-modal'
        role='dialog'
        aria-label='Office robot vacuum'
        onClick={handleModalClick}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className='modal-header'>
          <span className='modal-title'>Robot</span>
          <button type='button' className='modal-close' onClick={handleClose} onMouseDown={e => e.stopPropagation()}>
            <Icon icon='mdi:close' />
          </button>
        </div>
        {robotStatePanel}
      </div>
    </div>
  );

  return (
    <>
      <div className={className} title={title} onClick={handleOpen} style={{ cursor: 'pointer' }} onMouseDown={e => e.stopPropagation()}>
        <Icon icon='mdi:robot-vacuum' />
        {cleaningRequested ? <span className='indicator-label'>!</span> : null}
      </div>
      {typeof document !== 'undefined' && createPortal(modal, document.body)}
    </>
  );
}
