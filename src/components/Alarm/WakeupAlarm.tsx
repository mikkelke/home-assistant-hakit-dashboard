import { useCallback, useState } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import { useLocalStorageBoolean, useTouchScrollSlopGuard } from '../../hooks';
import './WakeupAlarm.css';

// Wake-up alarm card — same collapsed-by-default iOS shell as HeatCard/TonightCard. Presentation
// only: every value here comes straight off input_boolean.wakeup_<room> / input_datetime.wakeup_
// <room>, this component never computes anything beyond hour/minute arithmetic for the stepper.

interface WakeupAlarmProps {
  areaName: string;
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

export function WakeupAlarm({ areaName, entities, callService }: WakeupAlarmProps) {
  const areaNameNormalized = areaName.toLowerCase().replace(/\s+/g, '_');
  const headerSlop = useTouchScrollSlopGuard();
  const [collapsed, setCollapsed] = useLocalStorageBoolean(`wakeupalarm-collapsed-${areaNameNormalized}`, true);

  const toggleId = `input_boolean.wakeup_${areaNameNormalized}`;
  const timeId = `input_datetime.wakeup_${areaNameNormalized}`;

  const toggleEntity = entities?.[toggleId];
  const timeEntity = entities?.[timeId];
  const hasAlarmEntities = !!(toggleEntity || timeEntity);

  const isEnabled = toggleEntity?.state === 'on';

  // Optimistic time (user 2026-07-31: "the reaction is very bad"): each press used to wait
  // for the HA round-trip before the display moved, and rapid presses computed from the
  // stale entity value so they swallowed each other. A just-sent local value wins the
  // display until the entity moves (our echo, or any external change), then the entity wins
  // again - the React adjust-state-during-render reset pattern, so the render stays pure.
  const [localTime, setLocalTime] = useState<string | null>(null);
  const entityTime = timeEntity?.state || '07:00:00';
  const [lastEntityTime, setLastEntityTime] = useState(entityTime);
  if (entityTime !== lastEntityTime) {
    setLastEntityTime(entityTime);
    setLocalTime(null);
  }
  const alarmTime = localTime ?? entityTime;

  // Format time for display (HH:MM)
  const displayTime = alarmTime.slice(0, 5);

  // Parse hours and minutes for the time control
  const [hours, minutes] = alarmTime.split(':').map(Number);

  const handleToggle = useCallback(() => {
    if (!callService || !toggleEntity) return;
    callService({
      domain: 'input_boolean',
      service: isEnabled ? 'turn_off' : 'turn_on',
      target: { entity_id: toggleId },
    });
  }, [callService, toggleId, isEnabled, toggleEntity]);

  const handleTimeChange = useCallback(
    (newHours: number, newMinutes: number) => {
      if (!callService || !timeEntity) return;
      const timeString = `${String(newHours).padStart(2, '0')}:${String(newMinutes).padStart(2, '0')}:00`;
      setLocalTime(timeString);
      callService({
        domain: 'input_datetime',
        service: 'set_datetime',
        target: { entity_id: timeId },
        serviceData: { time: timeString },
      });
    },
    [callService, timeId, timeEntity]
  );

  const adjustTime = useCallback(
    (minutesDelta: number) => {
      let newMinutes = minutes + minutesDelta;
      let newHours = hours;

      if (newMinutes >= 60) {
        newMinutes = 0;
        newHours = (newHours + 1) % 24;
      } else if (newMinutes < 0) {
        newMinutes = 55;
        newHours = (newHours - 1 + 24) % 24;
      }

      handleTimeChange(newHours, newMinutes);
    },
    [hours, minutes, handleTimeChange]
  );

  const adjustHours = useCallback(
    (hoursDelta: number) => {
      const newHours = (hours + hoursDelta + 24) % 24;
      handleTimeChange(newHours, minutes);
    },
    [hours, minutes, handleTimeChange]
  );

  // "Wake up now": starts the whole wake sequence immediately (lights ramp, covers, radio) and
  // counts as the wake moment for the morning briefing. Backed by input_button.wake_up_now --
  // only rendered where that helper exists.
  const wakeNowId = 'input_button.wake_up_now';
  const wakeNowEntity = entities?.[wakeNowId];
  const handleWakeNow = useCallback(() => {
    if (!callService || !wakeNowEntity) return;
    callService({
      domain: 'input_button',
      service: 'press',
      target: { entity_id: wakeNowId },
    });
  }, [callService, wakeNowEntity]);

  if (!hasAlarmEntities) return null;

  return (
    <div className='wakeup-card'>
      <div
        className='wakeup-header'
        onClick={() => {
          if (headerSlop.consumeBlockClick()) return;
          setCollapsed(v => !v);
        }}
        onTouchStart={headerSlop.onTouchStart}
        onTouchMove={headerSlop.onTouchMove}
        onTouchEnd={headerSlop.onTouchEnd}
        onTouchCancel={headerSlop.onTouchCancel}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setCollapsed(v => !v);
          }
        }}
        role='button'
        tabIndex={0}
        aria-expanded={!collapsed}
      >
        <span className='wakeup-glyph'>
          <Icon icon='mdi:alarm' aria-hidden='true' />
        </span>
        <span className='wakeup-title'>Wake-up</span>
        <span className='wakeup-header-right'>
          <span className='wakeup-current'>{displayTime}</span>
          <span className={`wakeup-state ${isEnabled ? 'tint' : 'muted'}`}>{isEnabled ? 'On' : 'Off'}</span>
          <Icon icon={collapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'} aria-hidden='true' className='wakeup-chevron' />
        </span>
      </div>

      {!collapsed && (
        <div className='wakeup-content'>
          <div className='wakeup-time-row'>
            <div className='wakeup-time-group'>
              <button type='button' className='wakeup-time-btn' onClick={() => adjustHours(-1)} aria-label='Lower hour'>
                <Icon icon='mdi:minus' />
              </button>
              <span className='wakeup-time-value'>{String(hours).padStart(2, '0')}</span>
              <button type='button' className='wakeup-time-btn' onClick={() => adjustHours(1)} aria-label='Raise hour'>
                <Icon icon='mdi:plus' />
              </button>
            </div>
            <span className='wakeup-time-sep'>:</span>
            <div className='wakeup-time-group'>
              <button type='button' className='wakeup-time-btn' onClick={() => adjustTime(-5)} aria-label='Lower minute'>
                <Icon icon='mdi:minus' />
              </button>
              <span className='wakeup-time-value'>{String(minutes).padStart(2, '0')}</span>
              <button type='button' className='wakeup-time-btn' onClick={() => adjustTime(5)} aria-label='Raise minute'>
                <Icon icon='mdi:plus' />
              </button>
            </div>
            {wakeNowEntity && (
              <button type='button' className='wakeup-now-btn' onClick={handleWakeNow} aria-label='Wake up now' title='Wake up now'>
                <Icon icon='mdi:weather-sunset-up' />
              </button>
            )}
          </div>

          <div className='wakeup-footer'>
            <button type='button' className='wakeup-footer-action' onClick={handleToggle}>
              {isEnabled ? 'Turn off' : 'Turn on'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
