import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import type { HomePulseProps, PulseChip } from '../../types';
import { useModalBackButton } from '../../hooks';
import { ROBOT_MAPS_PATH, ROBOT_PAUSED_BOOLEAN_ENTITY, ROBOT_PAUSE_REASON_ENTITY } from '../../config/entities';
import { QUICK_ACCESS_OPEN_EVENT } from '../../config/transit';
import { deriveHomePulseSummary } from '../../utils/homePulse';
import '../Vacuum/VacuumCard.css';
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

  if (chip.action) {
    return (
      <button
        type='button'
        className={`home-pulse-chip tone-${chip.tone} ${chip.pulse ? 'is-pulsing' : ''}`}
        onClick={() => window.dispatchEvent(new CustomEvent(QUICK_ACCESS_OPEN_EVENT, { detail: { modal: chip.action } }))}
      >
        {content}
      </button>
    );
  }

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

interface RobotMapEntry {
  filename: string;
  timestamp: string;
  datetime?: string;
  room?: string;
  url: string;
}

const STUCK_MAP_ROOMS = ['stuck_in_the_office', 'stuck_trying_to_leave_the_office'];

export function HomePulse({ areas, entities, hassUrl, onRoomSelect }: HomePulseProps) {
  const summary = useMemo(() => deriveHomePulseSummary(areas, entities), [areas, entities]);
  const robotNeedsAttention = entities?.[ROBOT_PAUSED_BOOLEAN_ENTITY]?.state === 'on';
  const robotPauseReason = (entities?.[ROBOT_PAUSE_REASON_ENTITY]?.state?.trim() as string) || 'Rober2 needs attention';
  const [stuckMapUrl, setStuckMapUrl] = useState<string | null>(null);
  const [stuckMapLoading, setStuckMapLoading] = useState(false);
  const [stuckMapViewerOpen, setStuckMapViewerOpen] = useState(false);
  const handleCloseStuckMapViewer = useCallback(() => {
    setStuckMapViewerOpen(false);
  }, []);
  const { requestClose: requestCloseStuckMapViewer } = useModalBackButton({
    isOpen: stuckMapViewerOpen && !!stuckMapUrl,
    onRequestClose: handleCloseStuckMapViewer,
    historyKey: 'home-pulse-rober2-map',
  });

  const haBase = useMemo(() => {
    const base =
      (typeof window !== 'undefined' && (import.meta.env.VITE_HA_URL as string)?.length > 0
        ? (import.meta.env.VITE_HA_URL as string)
        : (hassUrl ?? (typeof window !== 'undefined' ? window.location.origin : ''))
      )?.replace(/\/$/, '') ?? '';
    return base;
  }, [hassUrl]);

  const sameOrigin = useMemo(
    () => (typeof window !== 'undefined' && haBase ? new URL(haBase).origin === window.location.origin : false),
    [haBase]
  );

  const isDev = useMemo(
    () => typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'),
    []
  );

  useEffect(() => {
    if (!robotNeedsAttention) {
      setStuckMapUrl(null);
      setStuckMapViewerOpen(false);
      return;
    }

    let cancelled = false;
    const toHaUrl = (path: string) => (path.startsWith('http') ? path : `${haBase}${path}`);

    const load = async () => {
      setStuckMapLoading(true);
      setStuckMapUrl(null);

      try {
        const indexUrl = sameOrigin || isDev ? `/local/${ROBOT_MAPS_PATH}/index.json` : toHaUrl(`/local/${ROBOT_MAPS_PATH}/index.json`);
        const res = await fetch(indexUrl, { cache: 'no-cache' });
        if (!res.ok || cancelled) return;

        const data = await res.json();
        const entries: RobotMapEntry[] = Array.isArray(data?.maps) ? data.maps : [];
        const stuck = entries.find(entry => entry.room && STUCK_MAP_ROOMS.includes(entry.room));
        if (cancelled) return;

        if (stuck) {
          const fullUrl = sameOrigin || isDev ? stuck.url : toHaUrl(stuck.url);
          setStuckMapUrl(fullUrl);
        }
      } catch {
        if (!cancelled) setStuckMapUrl(null);
      } finally {
        if (!cancelled) setStuckMapLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [robotNeedsAttention, haBase, sameOrigin, isDev]);

  if (!summary.insight && summary.chips.length === 0 && !robotNeedsAttention) {
    return null;
  }

  return (
    <>
      <section className='home-pulse' aria-label='Home Pulse'>
        <div className={`home-pulse-card tone-${summary.tone} ${summary.insight ? 'has-insight' : 'chips-only'}`}>
          {(summary.chips.length > 0 || robotNeedsAttention) && (
            <div className='home-pulse-chips'>
              {robotNeedsAttention && stuckMapUrl && (
                <button type='button' className='home-pulse-chip tone-attention is-pulsing' onClick={() => setStuckMapViewerOpen(true)}>
                  <span className='home-pulse-chip-icon' aria-hidden='true'>
                    <Icon icon='mdi:map-outline' />
                  </span>
                  <span className='home-pulse-chip-label'>View Rober2 map</span>
                </button>
              )}

              {robotNeedsAttention && !stuckMapUrl && (
                <div className={`home-pulse-chip tone-attention ${stuckMapLoading ? 'is-disabled' : 'is-pulsing'}`}>
                  <span className='home-pulse-chip-icon' aria-hidden='true'>
                    <Icon icon={stuckMapLoading ? 'mdi:map-clock-outline' : 'mdi:robot-vacuum-alert'} />
                  </span>
                  <span className='home-pulse-chip-label'>{stuckMapLoading ? 'Loading Rober2 map' : 'Rober2 needs help'}</span>
                </div>
              )}

              {summary.chips.map(chip => (
                <PulseChipButton key={chip.id} chip={chip} onRoomSelect={onRoomSelect} />
              ))}
            </div>
          )}
        </div>
      </section>

      {stuckMapViewerOpen && stuckMapUrl && (
        <>
          <div className='vacuum-map-overlay' onClick={requestCloseStuckMapViewer} />
          <div className='vacuum-map-modal' role='dialog' aria-modal='true' aria-label='Rober2 map'>
            <div className='vacuum-map-modal-header'>
              <div className='vacuum-map-modal-title'>
                <Icon icon='mdi:map' />
                <div>
                  <span className='room'>Rober2 map</span>
                  <span className='date'>{robotPauseReason}</span>
                </div>
              </div>
              <button
                type='button'
                className='vacuum-map-modal-close modal-close-button'
                onClick={requestCloseStuckMapViewer}
                aria-label='Close'
              >
                <Icon icon='mdi:close' />
              </button>
            </div>
            <div className='vacuum-map-modal-content'>
              <img src={stuckMapUrl} alt='Map when Rober2 got stuck' />
            </div>
          </div>
        </>
      )}
    </>
  );
}
