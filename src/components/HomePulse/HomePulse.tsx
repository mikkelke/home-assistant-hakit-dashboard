import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import type { HomePulseProps, PulseChip } from '../../types';
import { useModalBackButton } from '../../hooks';
import { useTrackedEntities } from '../../hooks/useTrackedEntities';
import { ROBOT_PAUSED_BOOLEAN_ENTITY, ROBOT_PAUSE_REASON_ENTITY } from '../../config/entities';
import { QUICK_ACCESS_OPEN_EVENT } from '../../config/transit';
import { deriveHomePulseSummary } from '../../utils/homePulse';
import { FIRE_SAFETY_OPEN_EVENT } from '../../utils/fireSafety';
import { useMotionSlot } from '../../home/motionBudget';
import { readArchiveIndex } from '../../utils/haArchive';
import { ArchiveImage } from '../Archive/ArchiveMedia';
import '../Vacuum/VacuumCard.css';
import './HomePulse.css';

/** An attention chip glows three times when it appears, as a one-shot under the motion budget. */
const PULSE_MS = 3 * 2800;

function usePulseClass(id: string, active: boolean): string {
  return useMotionSlot(`pulse:${id}`, 'oneShot', active, PULSE_MS) ? 'is-pulsing' : '';
}

function PulseChipButton({ chip, onRoomSelect }: { chip: PulseChip; onRoomSelect?: (areaId: string) => void }) {
  const pulseClass = usePulseClass(chip.id, !!chip.pulse);
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
        className={`home-pulse-chip tone-${chip.tone} ${pulseClass}`}
        onClick={() =>
          window.dispatchEvent(
            chip.action === 'fire'
              ? new CustomEvent(FIRE_SAFETY_OPEN_EVENT)
              : new CustomEvent(QUICK_ACCESS_OPEN_EVENT, { detail: { modal: chip.action } })
          )
        }
      >
        {content}
      </button>
    );
  }

  if (chip.areaId && onRoomSelect) {
    return (
      <button
        type='button'
        className={`home-pulse-chip tone-${chip.tone} ${pulseClass}`}
        onClick={() => onRoomSelect(chip.areaId as string)}
      >
        {content}
      </button>
    );
  }

  return <div className={`home-pulse-chip tone-${chip.tone}`}>{content}</div>;
}

// Stuck-diagnostic snapshots are keyed "stuck_…" by the rober2 app (room name varies with the dock location)
const isStuckMapRoom = (room?: string) => !!room && room.startsWith('stuck');

export function HomePulse({ areas, entities: demoEntities, onRoomSelect }: HomePulseProps) {
  // Appliance sensors update every few seconds while a cycle runs; tracked here, they re-render only this row.
  const tracked = useTrackedEntities();
  const entities = demoEntities ?? tracked;
  const summary = useMemo(() => deriveHomePulseSummary(areas, entities), [areas, entities]);
  const robotNeedsAttention = entities?.[ROBOT_PAUSED_BOOLEAN_ENTITY]?.state === 'on';
  const robotPauseReason = (entities?.[ROBOT_PAUSE_REASON_ENTITY]?.state?.trim() as string) || 'Rober2 needs attention';
  const [stuckMapUrl, setStuckMapUrl] = useState<string | null>(null);
  const [stuckMapLoading, setStuckMapLoading] = useState(false);
  const [stuckMapViewerOpen, setStuckMapViewerOpen] = useState(false);
  const robotPulseClass = usePulseClass('rober2', robotNeedsAttention);
  const handleCloseStuckMapViewer = useCallback(() => {
    setStuckMapViewerOpen(false);
  }, []);
  const { requestClose: requestCloseStuckMapViewer } = useModalBackButton({
    isOpen: stuckMapViewerOpen && !!stuckMapUrl,
    onRequestClose: handleCloseStuckMapViewer,
    historyKey: 'home-pulse-rober2-map',
  });

  useEffect(() => {
    if (!robotNeedsAttention) {
      setStuckMapUrl(null);
      setStuckMapViewerOpen(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setStuckMapLoading(true);
      setStuckMapUrl(null);
      try {
        const maps = ((await readArchiveIndex('rober2_maps_index')) as { maps?: { room?: string; url: string }[] } | null)?.maps;
        const stuck = Array.isArray(maps) ? maps.find(entry => isStuckMapRoom(entry.room)) : undefined;
        if (!cancelled) setStuckMapUrl(stuck?.url ?? null);
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
  }, [robotNeedsAttention]);

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
                <button
                  type='button'
                  className={`home-pulse-chip tone-attention ${robotPulseClass}`}
                  onClick={() => setStuckMapViewerOpen(true)}
                >
                  <span className='home-pulse-chip-icon' aria-hidden='true'>
                    <Icon icon='mdi:map-outline' />
                  </span>
                  <span className='home-pulse-chip-label'>View Rober2 map</span>
                </button>
              )}

              {robotNeedsAttention && !stuckMapUrl && (
                <div className={`home-pulse-chip tone-attention ${stuckMapLoading ? 'is-disabled' : robotPulseClass}`}>
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
              <ArchiveImage path={stuckMapUrl} alt='Map when Rober2 got stuck' />
            </div>
          </div>
        </>
      )}
    </>
  );
}
