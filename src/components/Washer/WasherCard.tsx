import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import './WasherCard.css';

const WASHER_STATE_ID = 'sensor.washer_state';
const PROGRAMME_SELECT_ID = 'input_select.washer_confirmed_programme';
const ANNOUNCE_TOGGLE_ID = 'input_boolean.washer_announce';
const SPIN_SELECT_ID = 'input_select.washer_spin_speed';
const TEMPERATURE_SELECT_ID = 'input_select.washer_temperature';

const SPIN_OPTIONS_ORDER = ['—', '1400 rpm', '1200 rpm', '900 rpm', '700 rpm', 'No spin'];
const TEMPERATURE_OPTIONS_ORDER = ['—', '20°C', '30°C', '40°C', '60°C', '90°C'];

type WasherState = 'Off' | 'Running' | 'Paused' | 'Unemptied' | 'Emptied';

interface WasherCardProps {
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

function formatTimeOnly(isoOrTime: string | undefined): string {
  if (!isoOrTime) return '--:--';
  const s = String(isoOrTime).trim();
  // Local "HH:MM" from backend (e.g. estimated_end_time) — use as-is
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s.slice(0, 5);
  try {
    // UTC ISO (e.g. cycle_start_time with +00:00 or Z): parse as UTC, convert to browser local
    const d = new Date(isoOrTime);
    if (Number.isNaN(d.getTime())) return s.slice(0, 5);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return s.slice(0, 5);
  }
}

function formatDuration(minutes: number | undefined): string {
  if (minutes === undefined || minutes === null || Number.isNaN(minutes)) return '--';
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return min > 0 ? `${h}h ${min}m` : `${h}h`;
}

export function WasherCard({ entities, callService }: WasherCardProps) {
  const washer = entities?.[WASHER_STATE_ID];
  const programmeSelect = entities?.[PROGRAMME_SELECT_ID];
  const announceToggle = entities?.[ANNOUNCE_TOGGLE_ID];
  const spinSelect = entities?.[SPIN_SELECT_ID];
  const temperatureSelect = entities?.[TEMPERATURE_SELECT_ID];

  // No local cache: entities come from parent (useHass); re-render when sensor.washer_state updates
  if (!washer) return null;

  const rawState = (washer.state?.trim() || 'Off').toLowerCase();
  const attrs = washer.attributes || {};
  // Normalize: HA may send "On"/"Off" instead of "Running"/"Off"; infer from attributes
  let state: WasherState = (washer.state?.trim() || 'Off') as WasherState;
  if (rawState === 'on') {
    const hasRunningAttrs =
      attrs.estimated_remaining_min != null ||
      attrs.programme_duration_min != null ||
      (attrs.programme_duration_min != null && attrs.cycle_start_time);
    const hasUnemptiedAttrs = attrs.run_time_minutes != null || attrs.energy_used != null;
    if (hasUnemptiedAttrs) state = 'Unemptied';
    else if (hasRunningAttrs || attrs.programme_label) state = 'Running';
  } else if (rawState === 'off') {
    state = 'Off';
  }

  // Hide the whole card when off or emptied (only show when there's a cycle or something to do)
  if (state === 'Off' || state === 'Emptied') return null;

  const programmeLabel = (attrs.programme_label as string) || programmeSelect?.state || '—';
  const options: string[] = Array.isArray(programmeSelect?.attributes?.options) ? (programmeSelect.attributes.options as string[]) : [];
  const remainingMin = attrs.estimated_remaining_min != null ? Number(attrs.estimated_remaining_min) : undefined;
  const totalMin = attrs.programme_duration_min != null ? Number(attrs.programme_duration_min) : undefined;
  const cycleStartTime = attrs.cycle_start_time as string | undefined; // UTC ISO (backend may set from epoch)
  const cycleStartTimeLocal = attrs.cycle_start_time_local as string | undefined; // ISO in user timezone
  const startedAtDisplay = attrs.started_at_display as string | undefined; // "HH:MM" in user timezone — use as-is for "Started"
  const estimatedEndTime = attrs.estimated_end_time as string | undefined; // "HH:MM" in user timezone — use as-is
  const runTimeMinutes = attrs.run_time_minutes != null ? Number(attrs.run_time_minutes) : undefined;
  const energyUsed = attrs.energy_used != null ? Number(attrs.energy_used) : undefined;
  const spinRpm = attrs.spin_rpm !== undefined && attrs.spin_rpm !== null ? Number(attrs.spin_rpm) : undefined;

  // Progress: only when Running; backend clears progress attrs when Off/Unemptied/Emptied
  const progressWhenRunning =
    state === 'Running' && ((totalMin != null && totalMin > 0) || (attrs.progress_pct != null && attrs.progress_pct !== ''));
  const hasProgressBar = progressWhenRunning;
  const elapsedMin =
    hasProgressBar && remainingMin != null && totalMin != null
      ? totalMin - remainingMin
      : attrs.elapsed_minutes != null
        ? Number(attrs.elapsed_minutes)
        : 0;
  const progressPct = !progressWhenRunning
    ? 0
    : attrs.progress_pct != null && attrs.progress_pct !== ''
      ? Math.min(100, Math.max(0, Number(attrs.progress_pct)))
      : totalMin != null && totalMin > 0
        ? Math.min(100, (elapsedMin / totalMin) * 100)
        : 0;
  const hasCountdownLine =
    state === 'Running' &&
    ((cycleStartTime && String(cycleStartTime).trim() !== '') || (startedAtDisplay && String(startedAtDisplay).trim() !== ''));
  const countdownLabel = remainingMin == null ? null : remainingMin <= 0 ? 'Almost done' : `${formatDuration(remainingMin)} left`;

  // "Started HH:MM": prefer started_at_display (backend local "HH:MM"); else format from cycle_start_time_local or cycle_start_time
  const startedDisplay =
    startedAtDisplay && String(startedAtDisplay).trim() !== ''
      ? String(startedAtDisplay).trim().slice(0, 5)
      : formatTimeOnly(cycleStartTimeLocal || cycleStartTime);

  const isInteractive = state === 'Running' || state === 'Unemptied';
  const announceOn = announceToggle?.state === 'on';

  const handleProgrammeChange = (option: string) => {
    if (!callService || !programmeSelect) return;
    callService({
      domain: 'input_select',
      service: 'select_option',
      target: { entity_id: PROGRAMME_SELECT_ID },
      serviceData: { option },
    });
  };

  const handleAnnounceToggle = () => {
    if (!callService || !announceToggle) return;
    callService({
      domain: 'input_boolean',
      service: announceOn ? 'turn_off' : 'turn_on',
      target: { entity_id: ANNOUNCE_TOGGLE_ID },
    });
  };

  const spinOpts = spinSelect?.attributes?.options;
  const spinOptions: string[] = Array.isArray(spinOpts) && spinOpts.length > 0 ? (spinOpts as string[]) : SPIN_OPTIONS_ORDER;
  const handleSpinChange = (option: string) => {
    if (!callService) return;
    callService({
      domain: 'input_select',
      service: 'select_option',
      target: { entity_id: SPIN_SELECT_ID },
      serviceData: { option },
    });
  };

  const tempOpts = temperatureSelect?.attributes?.options;
  const temperatureOptions: string[] = Array.isArray(tempOpts) && tempOpts.length > 0 ? (tempOpts as string[]) : TEMPERATURE_OPTIONS_ORDER;
  const handleTemperatureChange = (option: string) => {
    if (!callService) return;
    callService({
      domain: 'input_select',
      service: 'select_option',
      target: { entity_id: TEMPERATURE_SELECT_ID },
      serviceData: { option },
    });
  };

  // Temperature only applies to Bomuld (cotton); hide or show dropdown accordingly
  const isBomuldProgramme = (programmeSelect?.state ?? programmeLabel ?? '').toLowerCase().includes('bomuld');

  const spinLabel = spinRpm !== undefined ? (spinRpm === 0 ? 'No spin' : `${spinRpm} rpm`) : null;
  const programmeAndSpinLabel =
    state === 'Unemptied' && spinLabel != null ? `${programmeLabel} ${spinRpm === 0 ? '· No spin' : `@ ${spinRpm} rpm`}` : programmeLabel;

  // State-specific header icon: dancing washer when running, basket when unemptied
  const headerIcon = state === 'Running' ? 'mdi:washing-machine' : state === 'Unemptied' ? 'mdi:basket-outline' : 'mdi:washing-machine';

  return (
    <div className={`washer-card state-${state.toLowerCase()}`}>
      <div className='washer-header'>
        <div className='washer-title-row'>
          <span className={`washer-icon-wrap ${state === 'Running' ? 'dancing' : ''}`}>
            <Icon icon={headerIcon} className='washer-icon' />
          </span>
          <span className='washer-label'>Washer</span>
        </div>
        <span className='washer-state-badge'>{state}</span>
      </div>

      <div className='washer-body'>
        {/* Programme row */}
        <div className='washer-row programme-row'>
          <span className='washer-field-label'>Program:</span>
          {isInteractive && options.length > 0 ? (
            <select
              className='washer-programme-select'
              value={programmeSelect?.state ?? ''}
              onChange={e => handleProgrammeChange(e.target.value)}
              aria-label='Program'
            >
              {options.map(opt => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : (
            <span className={`washer-programme-value ${!isInteractive ? 'muted' : ''}`}>{programmeAndSpinLabel}</span>
          )}
        </div>

        {/* Temperature: only for Bomuld (cotton); backend uses it at cycle end to derive e.g. Bomuld 40 */}
        {(state === 'Running' || state === 'Unemptied') && temperatureSelect && isBomuldProgramme && (
          <div className='washer-row temperature-row'>
            <span className='washer-field-label'>Temperature:</span>
            <select
              className='washer-programme-select washer-temperature-select'
              value={temperatureSelect.state ?? '—'}
              onChange={e => handleTemperatureChange(e.target.value)}
              aria-label='Wash temperature'
            >
              {temperatureOptions.map(opt => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Spin speed: during Running or when Unemptied (backend reads at cycle end) */}
        {(state === 'Running' || state === 'Unemptied') && spinSelect && (
          <div className='washer-row spin-row'>
            <span className='washer-field-label'>Spin:</span>
            <select
              className='washer-programme-select washer-spin-select'
              value={spinSelect.state ?? '—'}
              onChange={e => handleSpinChange(e.target.value)}
              aria-label='Spin speed'
            >
              {spinOptions.map(opt => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Running: progress bar + countdown */}
        {state === 'Running' && (
          <>
            {hasProgressBar && (
              <div className='washer-progress'>
                <div className='washer-progress-bar'>
                  <div className='washer-progress-fill' style={{ width: `${progressPct}%` }} />
                </div>
                <span className='washer-progress-pct'>{Math.round(progressPct)}%</span>
              </div>
            )}
            <div className='washer-countdown-line'>
              {hasCountdownLine ? (
                <>
                  {(cycleStartTime || startedAtDisplay) && <>Started {startedDisplay}</>}
                  {(cycleStartTime || startedAtDisplay) && estimatedEndTime && ' · '}
                  {estimatedEndTime && <>Done ~{formatTimeOnly(estimatedEndTime)}</>}
                  {countdownLabel && <> · {countdownLabel}</>}
                </>
              ) : (
                <span className='washer-running-placeholder'>Running…</span>
              )}
            </div>
            {announceToggle && (
              <div className='washer-row announce-row'>
                <Icon icon='mdi:bell' />
                <span className='washer-field-label'>Announce</span>
                <button
                  type='button'
                  className={`washer-announce-toggle ${announceOn ? 'on' : 'off'}`}
                  onClick={handleAnnounceToggle}
                  aria-pressed={announceOn}
                  aria-label={announceOn ? 'Announce on' : 'Announce off'}
                >
                  <div className='washer-announce-switch' />
                </button>
              </div>
            )}
          </>
        )}

        {/* Paused */}
        {state === 'Paused' && (
          <div className='washer-banner paused'>
            <Icon icon='mdi:plus-circle-outline' />
            <span>Adding laundry…</span>
          </div>
        )}

        {/* Unemptied */}
        {state === 'Unemptied' && (
          <>
            {(runTimeMinutes != null || energyUsed != null) && (
              <div className='washer-stats'>
                {runTimeMinutes != null && <span>Ran {formatDuration(runTimeMinutes)}</span>}
                {runTimeMinutes != null && energyUsed != null && ' · '}
                {energyUsed != null && <span>Used {Number(energyUsed).toFixed(2)} kWh</span>}
              </div>
            )}
            <div className='washer-banner unemptied'>
              <Icon icon='mdi:alert-circle-outline' />
              <span>Please empty the washer</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
