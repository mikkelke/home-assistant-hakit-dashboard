import type { CSSProperties } from 'react';
import { Icon } from '@iconify/react';
import { CAPTURE_WINDOW_S } from '../../sensorMap/fingerprint';
import type { Zone } from '../../sensorMap/mapDoc';
import type { Capture } from './types';
import type { PhoneStatus } from './usePhones';

interface PhoneLayerProps {
  statuses: readonly PhoneStatus[];
  error: string | null;
  zones: readonly Zone[];
  phonesConfigured: boolean;
  capture: Capture;
  onAim: () => void;
  onCancelCapture: () => void;
  onScanners: (address: string) => void;
}

const FRESH_TEXT = { unknown: 'unknown', fresh: 'fresh', stale: 'stale' } as const;

/** Chips for each tracked phone (Bermuda's own area and whether the adverts are moving), and the control that
 * starts a fingerprint capture. No position is estimated or drawn. */
export function PhoneLayer({ statuses, error, zones, phonesConfigured, capture, onAim, onCancelCapture, onScanners }: PhoneLayerProps) {
  const areaName = (area: string | null) => {
    if (!area) return 'no area';
    return zones.find(zone => zone.ha_area_id === area)?.name ?? area;
  };
  const ratio = capture.phase === 'running' ? Math.min(1, capture.elapsedS / CAPTURE_WINDOW_S) : 0;
  return (
    <>
      <div className='sm-phones' role='status'>
        {!phonesConfigured && <span className='sm-chip small static'>No tracked phone is set up</span>}
        {statuses.map(status => (
          <button
            key={status.phone.bermuda_address}
            type='button'
            className={`sm-chip small phone ${status.freshness}`}
            onClick={() => onScanners(status.phone.bermuda_address)}
          >
            <span className='sm-dot' />
            {status.phone.name}: {status.seen ? areaName(status.area) : 'not seen'} · {FRESH_TEXT[status.freshness]}
          </button>
        ))}
        {error && <span className='sm-chip small static warn'>Bermuda: {error}</span>}
      </div>
      <div className='sm-fab-wrap'>
        {capture.phase === 'idle' && (
          <button type='button' className='sm-fab' disabled={!phonesConfigured} onClick={onAim}>
            <Icon icon='mdi:crosshairs-gps' /> I am here
          </button>
        )}
        {capture.phase === 'aim' && (
          <>
            <span className='sm-hint'>Tap the spot where you stand</span>
            <button type='button' className='sm-fab' onClick={onCancelCapture}>
              Cancel
            </button>
          </>
        )}
        {capture.phase === 'running' && (
          <>
            <span className='sm-ring' style={{ '--ratio': ratio } as CSSProperties} aria-hidden='true' />
            <span className='sm-hint'>Stand still</span>
            <button type='button' className='sm-fab' onClick={onCancelCapture}>
              Cancel
            </button>
          </>
        )}
      </div>
    </>
  );
}
