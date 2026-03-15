import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@iconify/react';
import { Timeline } from '../Timeline';
import type { HassEntities } from '../../types';
import './MultiEntitySelector.css';

interface MultiEntitySelectorProps {
  entityIds: string[];
  entities: HassEntities;
  hassUrl: string | null;
  className: string;
  title: string;
  icon: string;
  label?: string;
  entityType: string; // e.g., "window", "light", "door"
}

export function MultiEntitySelector({ entityIds, entities, hassUrl, className, title, icon, label, entityType }: MultiEntitySelectorProps) {
  const [showSelection, setShowSelection] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const showSelectionRef = useRef(showSelection);
  const showTimelineRef = useRef(showTimeline);

  // Keep refs in sync with state
  useEffect(() => {
    showSelectionRef.current = showSelection;
  }, [showSelection]);

  useEffect(() => {
    showTimelineRef.current = showTimeline;
  }, [showTimeline]);

  // Handle browser back button for selection modal
  useEffect(() => {
    if (!showSelection) return;

    const handlePopState = (event: PopStateEvent) => {
      if (showSelectionRef.current) {
        event.stopImmediatePropagation();
        setShowSelection(false);
        try {
          window.history.replaceState({ selection: null }, '', window.location.pathname);
        } catch {
          // Silently fail if history API is not supported
        }
      }
    };

    try {
      window.history.pushState({ selection: entityType }, '', window.location.pathname);
    } catch {
      // Silently fail if history API is not supported
    }

    window.addEventListener('popstate', handlePopState, { capture: true });
    return () => window.removeEventListener('popstate', handlePopState, { capture: true });
  }, [showSelection, entityType]);

  // Handle browser back button for timeline modal
  useEffect(() => {
    if (!showTimeline || !selectedEntityId) return;

    const handlePopState = (event: PopStateEvent) => {
      if (showTimelineRef.current) {
        event.stopImmediatePropagation();
        setShowTimeline(false);
        // Reset selected entity so selection modal shows again on next click
        if (entityIds.length > 1) {
          setSelectedEntityId(null);
        }
        try {
          window.history.replaceState({ timeline: null }, '', window.location.pathname);
        } catch {
          // Silently fail if history API is not supported
        }
      }
    };

    try {
      window.history.pushState({ timeline: selectedEntityId }, '', window.location.pathname);
    } catch {
      // Silently fail if history API is not supported
    }

    window.addEventListener('popstate', handlePopState, { capture: true });
    return () => window.removeEventListener('popstate', handlePopState, { capture: true });
  }, [showTimeline, selectedEntityId, entityIds.length]);

  // Add/remove body class for modals
  useEffect(() => {
    if (showSelection || showTimeline) {
      document.body.classList.add('modal-open');
      return () => {
        document.body.classList.remove('modal-open');
      };
    } else {
      document.body.classList.remove('modal-open');
    }
  }, [showSelection, showTimeline]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (showTimeline) {
      // Timeline is open, close it and allow re-selection if multiple entities
      setShowTimeline(false);
      if (entityIds.length > 1) {
        setSelectedEntityId(null); // Reset selection so selection modal shows
        setShowSelection(true);
      }
    } else if (entityIds.length === 1) {
      // Only one entity, show timeline directly
      setSelectedEntityId(entityIds[0]);
      setShowTimeline(true);
    } else if (selectedEntityId) {
      // Entity already selected, show timeline
      setShowTimeline(true);
    } else {
      // Multiple entities, show selection modal
      setShowSelection(true);
    }
  };

  const handleSelectEntity = (entityId: string) => {
    setSelectedEntityId(entityId);
    setShowSelection(false);
    setShowTimeline(true);
  };

  const handleCloseSelection = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    setShowSelection(false);
  };

  const handleCloseTimeline = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    setShowTimeline(false);
    // Reset selected entity so selection modal shows again on next click
    if (entityIds.length > 1) {
      setSelectedEntityId(null);
    }
  };

  const handleSelectionOverlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    handleCloseSelection();
  };

  const handleTimelineOverlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setShowTimeline(false);
    // Reset selected entity so selection modal shows again on next click
    if (entityIds.length > 1) {
      setSelectedEntityId(null);
    }
  };

  const handleSelectionModalClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  const handleTimelineModalClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  // Get entity display name
  const getEntityName = (entityId: string): string => {
    const entity = entities[entityId];
    if (!entity) return entityId.split('.')[1].replace(/_/g, ' ');
    const name = entity.attributes?.friendly_name;
    return typeof name === 'string' ? name : entityId.split('.')[1].replace(/_/g, ' ');
  };

  // Get entity state for display
  const getEntityState = (entityId: string): string => {
    const entity = entities[entityId];
    if (!entity) return 'unknown';
    return entity.state || 'unknown';
  };

  // Get entity state icon
  const getEntityStateIcon = (_entityId: string, state: string): string => {
    const stateLower = state.toLowerCase();
    if (entityType === 'window') {
      return stateLower === 'on' ? 'mdi:window-open' : 'mdi:window-closed';
    }
    if (entityType === 'light') {
      return stateLower === 'on' ? 'mdi:lightbulb-on' : 'mdi:lightbulb-off';
    }
    if (entityType === 'door') {
      return stateLower === 'on' ? 'mdi:door-open' : 'mdi:door-closed';
    }
    return 'mdi:circle';
  };

  // Get entity state color
  const getEntityStateColor = (_entityId: string, state: string): string => {
    const stateLower = state.toLowerCase();
    if (entityType === 'window' || entityType === 'door') {
      return stateLower === 'on' ? '#fbbf24' : '#22c55e';
    }
    if (entityType === 'light') {
      return stateLower === 'on' ? '#fbbf24' : '#71717a';
    }
    return '#a1a1aa';
  };

  const selectionModal = showSelection ? (
    <div className='person-info-overlay' role='presentation' onClick={handleSelectionOverlayClick} onMouseDown={e => e.stopPropagation()}>
      <div
        className='person-info-modal entity-selection-modal'
        role='dialog'
        aria-label={`Select ${entityType}`}
        onClick={handleSelectionModalClick}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className='modal-header'>
          <span className='modal-title'>Select {entityType.charAt(0).toUpperCase() + entityType.slice(1)}</span>
          <button className='modal-close' onClick={handleCloseSelection} onMouseDown={e => e.stopPropagation()}>
            <Icon icon='mdi:close' />
          </button>
        </div>
        <div className='entity-selection-list'>
          {entityIds.map(entityId => {
            const entity = entities[entityId];
            if (!entity) return null;
            const state = getEntityState(entityId);
            const stateIcon = getEntityStateIcon(entityId, state);
            const stateColor = getEntityStateColor(entityId, state);
            const entityName = getEntityName(entityId);

            return (
              <button
                key={entityId}
                className='entity-selection-item'
                onClick={e => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleSelectEntity(entityId);
                }}
                onMouseDown={e => e.stopPropagation()}
              >
                <div className='entity-selection-icon' style={{ color: stateColor }}>
                  <Icon icon={stateIcon} />
                </div>
                <div className='entity-selection-info'>
                  <span className='entity-selection-name'>{entityName}</span>
                  <span className='entity-selection-state' style={{ color: stateColor }}>
                    {state.charAt(0).toUpperCase() + state.slice(1)}
                  </span>
                </div>
                <Icon icon='mdi:chevron-right' className='entity-selection-arrow' />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  ) : null;

  // Timeline modal for selected entity
  const timelineModal =
    showTimeline && selectedEntityId
      ? (() => {
          const entity = entities[selectedEntityId];
          if (!entity) return null;
          const entityName = getEntityName(selectedEntityId);

          return (
            <div
              className='person-info-overlay'
              role='presentation'
              onClick={handleTimelineOverlayClick}
              onMouseDown={e => e.stopPropagation()}
            >
              <div
                className='person-info-modal person-timeline-modal'
                role='dialog'
                aria-label={`${entityName} timeline`}
                onClick={handleTimelineModalClick}
                onMouseDown={e => e.stopPropagation()}
              >
                <div className='modal-header'>
                  <span className='modal-title'>{entityName}</span>
                  <button className='modal-close' onClick={handleCloseTimeline} onMouseDown={e => e.stopPropagation()}>
                    <Icon icon='mdi:close' />
                  </button>
                </div>
                <div className='modal-timeline-content'>
                  <Timeline
                    entityId={selectedEntityId}
                    entity={entity}
                    hassUrl={hassUrl}
                    hours={entityType === 'light' ? 48 : 168}
                    limit={entityType === 'light' ? 50 : 100}
                  />
                </div>
              </div>
            </div>
          );
        })()
      : null;

  return (
    <>
      <div className={className} title={title} onClick={handleClick} style={{ cursor: 'pointer' }}>
        <Icon icon={icon} />
        {label && <span className='indicator-label'>{label}</span>}
      </div>
      {typeof document !== 'undefined' && createPortal(selectionModal, document.body)}
      {typeof document !== 'undefined' && createPortal(timelineModal, document.body)}
    </>
  );
}
