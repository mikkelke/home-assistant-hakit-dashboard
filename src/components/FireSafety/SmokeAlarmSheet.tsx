import { useMemo } from 'react';
import type { CallServiceFunction, HassEntities } from '../../types';
import {
  KITCHEN_COOKING_MODE_BOOLEAN,
  SMOKE_ALARM_HEARTBEAT_SWITCH,
  SMOKE_ALARM_PRE_ALARM_SWITCH,
  SMOKE_ALARM_SELF_TEST_SWITCH,
  SMOKE_ALARM_SENSITIVITY_SELECT,
  SMOKE_ALARM_SENSORS,
} from '../../config/entities';
import { deriveFireSafety, isCooking } from '../../utils/fireSafety';
import { ApplianceSheet } from '../Appliance';
import { HoldToAct } from './HoldToAct';
import './FireSafety.css';

const ACCENT_CLASS = 'appliance-accent-fire';
const SENSITIVITY_OPTIONS = ['low', 'medium', 'high'] as const;

interface SmokeAlarmSheetProps {
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
  onClose: () => void;
}

function formatWhen(date: Date | null, now: Date): string {
  if (!date) return 'Never';
  const diffMin = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60000));
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 36) return `${diffH} h ago`;
  const diffD = Math.round(diffH / 24);
  return `${diffD} days ago`;
}

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type='button'
      role='switch'
      aria-checked={on}
      aria-label={label}
      className={`smoke-switch ${on ? 'on' : ''}`}
      onClick={onToggle}
    >
      <span className='smoke-switch-dot' />
    </button>
  );
}

export function SmokeAlarmSheet({ entities, callService, onClose }: SmokeAlarmSheetProps) {
  const fire = useMemo(() => deriveFireSafety(entities), [entities]);
  const now = new Date();

  const readState = (id: string): string | null => {
    const state = entities[id]?.state;
    return state == null || state === 'unknown' || state === 'unavailable' ? null : state;
  };
  const isOn = (id: string) => readState(id) === 'on';

  const toggle = (domain: 'switch' | 'input_boolean', entityId: string) => {
    callService?.({ domain, service: isOn(entityId) ? 'turn_off' : 'turn_on', target: { entity_id: entityId } });
  };
  const setSensitivity = (option: string) => {
    callService?.({
      domain: 'select',
      service: 'select_option',
      target: { entity_id: SMOKE_ALARM_SENSITIVITY_SELECT },
      serviceData: { option },
    });
  };
  const selfTest = () => {
    callService?.({ domain: 'switch', service: 'turn_on', target: { entity_id: SMOKE_ALARM_SELF_TEST_SWITCH } });
  };

  const battery = readState(SMOKE_ALARM_SENSORS.battery) ?? (fire.batteryPct != null ? String(fire.batteryPct) : null);
  const linkQuality = readState(SMOKE_ALARM_SENSORS.linkquality);
  const lastSeenRaw = readState(SMOKE_ALARM_SENSORS.lastSeen);
  const lastSeen = lastSeenRaw ? new Date(lastSeenRaw) : null;
  const siren = readState(SMOKE_ALARM_SENSORS.sirenState);
  const sensitivity = readState(SMOKE_ALARM_SENSITIVITY_SELECT);
  const cookingOn = isOn(KITCHEN_COOKING_MODE_BOOLEAN);
  const cooking = isCooking(fire, now);
  const testing = isOn(SMOKE_ALARM_SELF_TEST_SWITCH);

  return (
    <ApplianceSheet
      accentClassName={ACCENT_CLASS}
      glyphIcon='mdi:smoke-detector-variant'
      title='Smoke alarm'
      historyKey='smoke-alarm-sheet'
      onClose={onClose}
    >
      <div className='smoke-sheet-section'>Health</div>
      <div className='smoke-row'>
        <span className='smoke-row-label'>Status</span>
        <span className={`smoke-row-value ${fire.fault ? 'alert' : ''}`}>{fire.headline}</span>
      </div>
      <div className='smoke-row'>
        <span className='smoke-row-label'>Battery</span>
        <span className={`smoke-row-value ${fire.batteryLow ? 'alert' : ''}`}>{battery != null ? `${battery}%` : '—'}</span>
      </div>
      <div className='smoke-row'>
        <span className='smoke-row-label'>Last test</span>
        <span className={`smoke-row-value ${fire.testOverdue ? 'alert' : ''}`}>{formatWhen(fire.lastTest, now)}</span>
      </div>
      {lastSeen && !Number.isNaN(lastSeen.getTime()) && (
        <div className='smoke-row'>
          <span className='smoke-row-label'>Last seen</span>
          <span className='smoke-row-value'>{formatWhen(lastSeen, now)}</span>
        </div>
      )}
      {linkQuality && (
        <div className='smoke-row'>
          <span className='smoke-row-label'>Link quality</span>
          <span className='smoke-row-value'>{linkQuality}</span>
        </div>
      )}
      <div className='smoke-row'>
        <span className='smoke-row-label'>Siren</span>
        <span className={`smoke-row-value ${siren && siren !== 'clear' ? 'alert' : ''}`}>
          {siren ?? (fire.deviceAvailable ? '—' : 'Offline')}
        </span>
      </div>

      <div className='smoke-sheet-section'>Settings</div>
      <div className='smoke-row'>
        <span className='smoke-row-label'>
          Cooking mode
          <small>{cooking ? 'Softer for the next while' : 'Softer for 45 min'}</small>
        </span>
        <Switch on={cookingOn || cooking} label='Cooking mode' onToggle={() => toggle('input_boolean', KITCHEN_COOKING_MODE_BOOLEAN)} />
      </div>
      <div className='smoke-row'>
        <span className='smoke-row-label'>Sensitivity</span>
        <span className='smoke-segment' role='radiogroup' aria-label='Sensitivity'>
          {SENSITIVITY_OPTIONS.map(option => (
            <button
              key={option}
              type='button'
              role='radio'
              aria-checked={sensitivity === option}
              className={sensitivity === option ? 'on' : ''}
              onClick={() => setSensitivity(option)}
            >
              {option}
            </button>
          ))}
        </span>
      </div>
      <div className='smoke-row'>
        <span className='smoke-row-label'>
          Heartbeat LED
          <small>Brief blink to show it is alive</small>
        </span>
        <Switch
          on={isOn(SMOKE_ALARM_HEARTBEAT_SWITCH)}
          label='Heartbeat LED'
          onToggle={() => toggle('switch', SMOKE_ALARM_HEARTBEAT_SWITCH)}
        />
      </div>
      <div className='smoke-row'>
        <span className='smoke-row-label'>
          Pre-alarm
          <small>Warn softly before the full siren</small>
        </span>
        <Switch on={isOn(SMOKE_ALARM_PRE_ALARM_SWITCH)} label='Pre-alarm' onToggle={() => toggle('switch', SMOKE_ALARM_PRE_ALARM_SWITCH)} />
      </div>

      <div className='smoke-sheet-test'>
        <HoldToAct
          tone='dark'
          label={testing ? 'Testing…' : 'Self-test'}
          hint='The alarm will beep for about a minute'
          onAct={selfTest}
          disabled={testing || !fire.deviceAvailable}
        />
      </div>
    </ApplianceSheet>
  );
}
