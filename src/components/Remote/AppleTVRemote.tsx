import { useCallback, useRef } from 'react';
import { Icon } from '@iconify/react';
import type { CallServiceFunction } from '../../types';
import './AppleTVRemote.css';

interface AppleTVRemoteProps {
  remoteEntityId: string;
  mediaPlayerEntityId?: string;
  callService: CallServiceFunction;
  onClose: () => void;
}

const LONG_PRESS_DURATION = 500;

export function AppleTVRemote({ remoteEntityId, mediaPlayerEntityId, callService, onClose }: AppleTVRemoteProps) {
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);

  const sendCommand = useCallback(
    (command: string) => {
      callService({
        domain: 'remote',
        service: 'send_command',
        target: { entity_id: remoteEntityId },
        serviceData: { command },
      });
    },
    [callService, remoteEntityId]
  );

  const handleVolumeUp = useCallback(() => {
    if (mediaPlayerEntityId) {
      callService({
        domain: 'media_player',
        service: 'volume_up',
        target: { entity_id: mediaPlayerEntityId },
      });
    } else {
      sendCommand('volume_up');
    }
  }, [callService, mediaPlayerEntityId, sendCommand]);

  const handleVolumeDown = useCallback(() => {
    if (mediaPlayerEntityId) {
      callService({
        domain: 'media_player',
        service: 'volume_down',
        target: { entity_id: mediaPlayerEntityId },
      });
    } else {
      sendCommand('volume_down');
    }
  }, [callService, mediaPlayerEntityId, sendCommand]);

  const handleMute = useCallback(() => {
    if (mediaPlayerEntityId) {
      callService({
        domain: 'media_player',
        service: 'volume_mute',
        target: { entity_id: mediaPlayerEntityId },
        serviceData: { is_volume_muted: true },
      });
    } else {
      sendCommand('mute');
    }
  }, [callService, mediaPlayerEntityId, sendCommand]);

  const handleBackPressStart = useCallback(() => {
    longPressTriggeredRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      sendCommand('top_menu');
    }, LONG_PRESS_DURATION);
  }, [sendCommand]);

  const handleBackPressEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (!longPressTriggeredRef.current) {
      sendCommand('menu');
    }
  }, [sendCommand]);

  const handleBackPressCancel = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  return (
    <div className='apple-remote-overlay' onClick={onClose}>
      <div className='apple-remote-container' onClick={e => e.stopPropagation()}>
        <button className='apple-remote-close' onClick={onClose}>
          <Icon icon='mdi:close' />
        </button>

        <div className='apple-remote-body'>
          {/* Power Button - top right */}
          <button className='power-btn' onClick={() => sendCommand('turn_off')} aria-label='Power'>
            <Icon icon='mdi:power' />
          </button>

          {/* Clickpad / D-pad */}
          <div className='clickpad'>
            <button className='clickpad-sector up' onClick={() => sendCommand('up')} aria-label='Up' />
            <button className='clickpad-sector right' onClick={() => sendCommand('right')} aria-label='Right' />
            <button className='clickpad-sector down' onClick={() => sendCommand('down')} aria-label='Down' />
            <button className='clickpad-sector left' onClick={() => sendCommand('left')} aria-label='Left' />
            <div className='clickpad-divider horizontal' />
            <div className='clickpad-divider vertical' />
            <button className='clickpad-center' onClick={() => sendCommand('select')} aria-label='Select' />
          </div>

          {/* Button Grid - absolute positioned */}
          <div className='button-grid'>
            {/* Left column: Back, Play/Pause, Mute */}
            <button
              className='remote-btn'
              onMouseDown={handleBackPressStart}
              onMouseUp={handleBackPressEnd}
              onMouseLeave={handleBackPressCancel}
              onTouchStart={handleBackPressStart}
              onTouchEnd={handleBackPressEnd}
              onTouchCancel={handleBackPressCancel}
              aria-label='Back (hold to close app)'
            >
              <Icon icon='mdi:chevron-left' />
            </button>
            <button className='remote-btn' onClick={() => sendCommand('play_pause')} aria-label='Play/Pause'>
              <Icon icon='mdi:play-pause' />
            </button>
            <button className='remote-btn' onClick={handleMute} aria-label='Mute'>
              <Icon icon='mdi:volume-off' />
            </button>

            {/* Right column: TV */}
            <button className='remote-btn' onClick={() => sendCommand('home')} aria-label='TV/Home'>
              <Icon icon='mdi:television' />
            </button>

            {/* Volume rocker - spans row 2-3 */}
            <div className='volume-rocker'>
              <button className='volume-btn plus' onClick={handleVolumeUp} aria-label='Volume Up'>
                <Icon icon='mdi:plus' />
              </button>
              <div className='volume-divider' />
              <button className='volume-btn minus' onClick={handleVolumeDown} aria-label='Volume Down'>
                <Icon icon='mdi:minus' />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
