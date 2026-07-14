import { useTouchScrollSlopGuard } from '../../hooks';
import type { DeviceUsage, EnergyDevices, EnergyView, Period } from '../../energy';
import { formatKr, formatKWh } from '../../utils/format';
import './DeviceBreakdown.css';

interface DeviceBreakdownProps {
  period: Period;
  view: EnergyView;
  devices: EnergyDevices | null;
  loading: boolean;
  /** True while `devices` is a stale cache hit shown instantly and a real fetch is still in
   * flight — rows stay visible, dimmed, with a small "opdaterer…" indicator in the header. */
  refreshing: boolean;
  error: string | null;
  onReload: () => void;
  onSelectDevice: (device: DeviceUsage) => void;
}

const VISIBLE_TOP_LEVEL_COUNT = 12;
const SKELETON_ROW_COUNT = 5;

/** Bar width as a percentage of the shared scale (the period's largest top-level device) —
 * always at least 2% once there's any consumption at all, so small devices stay visible; capped
 * at 100% since "Ikke målt" can exceed every individual device's kWh. */
function barWidthPercent(kWh: number, maxKWh: number): number {
  if (maxKWh <= 0 || kWh <= 0) return 0;
  return Math.max(2, Math.min(100, (kWh / maxKWh) * 100));
}

/** "≈ 18,40 kr" / "18,40 kr" / "—" — the ≈ prefix marks an approximated (not yet exact) cost. */
function formatDeviceCost(costKr: number | null, costExact: boolean): string {
  if (costKr == null) return '—';
  return costExact ? formatKr(costKr) : `≈ ${formatKr(costKr)}`;
}

/** Null-propagating sum: once any item's cost is unknown, the aggregate's cost is unknown too. */
function sumCostKr(items: DeviceUsage[]): number | null {
  return items.reduce<number | null>((sum, item) => (sum == null || item.costKr == null ? null : sum + item.costKr), 0);
}

interface DeviceRowProps {
  name: string;
  kWh: number;
  costKr: number | null;
  costExact: boolean;
  maxKWh: number;
  indent?: boolean;
  untracked?: boolean;
  tappable?: boolean;
  onSelect?: () => void;
}

/** One row of the breakdown — a genuine sub-component (not an inline render inside `.map`) so its
 * touch-slop guard hook is called unconditionally at this component's own top level, never inside
 * a loop. */
function DeviceRow({ name, kWh, costKr, costExact, maxKWh, indent, untracked, tappable, onSelect }: DeviceRowProps) {
  const slop = useTouchScrollSlopGuard();
  const widthPercent = barWidthPercent(kWh, maxKWh);
  const rowClassName = ['device-row', indent && 'device-row--child', tappable && 'device-row--tappable'].filter(Boolean).join(' ');
  const fillClassName = ['device-row-bar-fill', untracked && 'device-row-bar-fill--untracked'].filter(Boolean).join(' ');

  return (
    <div
      className={rowClassName}
      onClick={
        tappable
          ? () => {
              if (slop.consumeBlockClick()) return;
              onSelect?.();
            }
          : undefined
      }
      onTouchStart={tappable ? slop.onTouchStart : undefined}
      onTouchMove={tappable ? slop.onTouchMove : undefined}
      onTouchEnd={tappable ? slop.onTouchEnd : undefined}
      onTouchCancel={tappable ? slop.onTouchCancel : undefined}
      role={tappable ? 'button' : undefined}
      tabIndex={tappable ? 0 : undefined}
      onKeyDown={
        tappable
          ? e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect?.();
              }
            }
          : undefined
      }
    >
      <span className='device-row-name'>{indent ? `↳ ${name}` : name}</span>
      <span className='device-row-bar-track'>
        <span className={fillClassName} style={{ width: `${widthPercent}%` }} />
      </span>
      <span className='device-row-kwh'>{formatKWh(kWh)}</span>
      <span className='device-row-cost'>{formatDeviceCost(costKr, costExact)}</span>
    </div>
  );
}

/** Card "Enheder": per-device kWh/kr breakdown below the consumption chart, all periods. Top-level
 * devices sorted desc (children nested directly under their parent, excluded from the shared
 * ranking); the tail beyond the top 12 collapses into one "Andre enheder" row, followed by the
 * untracked remainder. `period`/`view` are accepted for API parity with the rest of the page's
 * cards (e.g. `StatTiles`) — the row scale and content here are entirely derived from `devices`. */
export function DeviceBreakdown({ devices, loading, refreshing, error, onReload, onSelectDevice }: DeviceBreakdownProps) {
  const topLevel = devices?.devices ?? [];
  const visibleTopLevel = topLevel.slice(0, VISIBLE_TOP_LEVEL_COUNT);
  const overflow = topLevel.slice(VISIBLE_TOP_LEVEL_COUNT);
  const maxKWh = topLevel[0]?.kWh ?? 0;

  return (
    <div className='device-breakdown'>
      <div className='device-breakdown-header'>
        <div className='device-breakdown-header-left'>
          <h2>Enheder</h2>
          {refreshing && (
            <span className='device-breakdown-refreshing'>
              <span className='device-breakdown-refreshing-dot' />
              opdaterer…
            </span>
          )}
        </div>
      </div>

      {loading && (
        <div className='device-breakdown-skeleton'>
          {Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => (
            <div key={i} className='device-row device-row--skeleton' />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className='device-breakdown-state-error'>
          <p>{error}</p>
          <button type='button' onClick={onReload}>
            Prøv igen
          </button>
        </div>
      )}

      {!loading && !error && devices && (
        <div className={`device-breakdown-rows ${refreshing ? 'device-breakdown-rows--refreshing' : ''}`}>
          {visibleTopLevel.map(device => (
            <div className='device-row-group' key={device.statId}>
              <DeviceRow
                name={device.name}
                kWh={device.kWh}
                costKr={device.costKr}
                costExact={device.costExact}
                maxKWh={maxKWh}
                tappable={device.kWh > 0}
                onSelect={() => onSelectDevice(device)}
              />
              {device.children?.map(child => (
                <DeviceRow
                  key={child.statId}
                  name={child.name}
                  kWh={child.kWh}
                  costKr={child.costKr}
                  costExact={child.costExact}
                  maxKWh={maxKWh}
                  indent
                />
              ))}
            </div>
          ))}

          {overflow.length > 0 && (
            <DeviceRow
              name={`Andre enheder (${overflow.length})`}
              kWh={overflow.reduce((sum, device) => sum + device.kWh, 0)}
              costKr={sumCostKr(overflow)}
              costExact={false}
              maxKWh={maxKWh}
            />
          )}

          <DeviceRow
            name='Ikke målt'
            kWh={devices.untracked.kWh}
            costKr={devices.untracked.costKr}
            costExact={false}
            maxKWh={maxKWh}
            untracked
          />
        </div>
      )}
    </div>
  );
}
