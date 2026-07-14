import { useEffect, useState } from 'react';
import { Icon } from '@iconify/react';
import { useHass } from '@hakit/core';
import { deviceCostExact, useEnergyConfig, type DeviceUsage, type Period } from '../../energy';
import { labelFor, startOfLocalDay } from '../../energy/period';
import { fetchStatistics } from '../../energy/ws';
import { useModalBackButton } from '../../hooks';
import { formatKr, formatKWh } from '../../utils/format';
import './DeviceDialog.css';

interface DeviceDialogProps {
  device: DeviceUsage;
  period: Period;
  anchorStartMs: number;
  rangeEndMs: number;
  onClose: () => void;
}

/** Identifies "which exact-cost fetch is this" — request-key pattern mirroring useEnergyView, so
 * the effect never has to setState synchronously for its own "loading"/"skip" branches (only from
 * within the async .then()/.catch()); the pending/unavailable label is derived at render time by
 * comparing this key against the last-resolved result's key. */
function buildExactKey(deviceStatId: string, priceStatId: string, anchorStartMs: number, rangeEndMs: number): string {
  return `${deviceStatId}|${priceStatId}|${anchorStartMs}|${rangeEndMs}`;
}

interface ExactResult {
  key: string;
  costKr: number | null; // null = fetch resolved but deviceCostExact found no basis, or the fetch failed
}

const EMPTY_EXACT_RESULT: ExactResult = { key: '', costKr: null };

/** On-demand exact-cost dialog for one device row. Portal-less overlay (matches the app's other
 * portaled modals visually, e.g. Menu's battery overview, without actually portaling) — rendered
 * inline where EnergyPage mounts it, since `position: fixed` still covers the full viewport from
 * anywhere in this tree. */
export function DeviceDialog({ device, period, anchorStartMs, rangeEndMs, onClose }: DeviceDialogProps) {
  const { requestClose } = useModalBackButton({ isOpen: true, onRequestClose: onClose, historyKey: 'energy-device' });
  const connection = useHass(s => s.connection);
  const { config } = useEnergyConfig();

  // Clock-in-state (purity lint forbids a bare Date.now() in render): read once at mount, used
  // only to phrase the period label ("I dag" vs a weekday name) the same way the page itself does.
  const [todayStartMs] = useState(() => startOfLocalDay(Date.now()));
  const [exactResult, setExactResult] = useState<ExactResult>(EMPTY_EXACT_RESULT);

  const priceStatId = config?.priceStatId ?? null;
  const exactKey = period !== 'year' && priceStatId ? buildExactKey(device.statId, priceStatId, anchorStartMs, rangeEndMs) : null;

  useEffect(() => {
    if (!connection || !priceStatId || !exactKey) return; // year view, or no price stat configured — nothing to fetch

    let cancelled = false;

    fetchStatistics(connection, {
      startTimeIso: new Date(anchorStartMs).toISOString(),
      endTimeIso: new Date(rangeEndMs).toISOString(),
      statisticIds: [device.statId, priceStatId],
      period: 'hour',
      types: ['change', 'state'],
    })
      .then(response => {
        if (cancelled) return;
        const deviceRows = response[device.statId] ?? [];
        const priceRows = response[priceStatId] ?? [];
        setExactResult({ key: exactKey, costKr: deviceCostExact(deviceRows, priceRows) });
      })
      .catch(() => {
        if (cancelled) return;
        setExactResult({ key: exactKey, costKr: null });
      });

    return () => {
      cancelled = true;
    };
  }, [connection, priceStatId, exactKey, device.statId, anchorStartMs, rangeEndMs]);

  const exactLabel = (() => {
    if (period === 'year') return 'Eksakt beregning er ikke tilgængelig for år';
    if (config == null) return 'Beregner …'; // config still resolving (module-cached — normally near-instant)
    if (!priceStatId || !exactKey) return 'Kan ikke beregnes eksakt'; // no price stat configured
    if (exactResult.key !== exactKey) return 'Beregner …'; // fetch for the current inputs hasn't resolved yet
    if (exactResult.costKr == null) return 'Kan ikke beregnes eksakt';
    return `Eksakt: ${formatKr(exactResult.costKr)}`;
  })();

  return (
    <div className='device-dialog-overlay' role='presentation' onClick={requestClose}>
      <div
        className='device-dialog'
        role='dialog'
        aria-modal='true'
        aria-labelledby='device-dialog-title'
        onClick={e => e.stopPropagation()}
      >
        <div className='device-dialog-header'>
          <h2 id='device-dialog-title'>{device.name}</h2>
          <button className='device-dialog-close modal-close-button' onClick={requestClose} aria-label='Luk'>
            <Icon icon='mdi:close' />
          </button>
        </div>

        <p className='device-dialog-period'>{labelFor(period, anchorStartMs, todayStartMs)}</p>

        <div className='device-dialog-body'>
          <div className='device-dialog-row'>
            <span className='device-dialog-label'>Forbrug</span>
            <span className='device-dialog-value'>{formatKWh(device.kWh)}</span>
          </div>
          <div className='device-dialog-row'>
            <span className='device-dialog-label'>Omtrentlig pris</span>
            <span className='device-dialog-value'>{device.costKr != null ? `≈ ${formatKr(device.costKr)}` : '—'}</span>
          </div>
          <div className='device-dialog-row'>
            <span className='device-dialog-label'>Eksakt pris</span>
            <span className='device-dialog-value'>{exactLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
