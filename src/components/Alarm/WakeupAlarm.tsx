import { useState, useCallback } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import './WakeupAlarm.css';

interface WakeupAlarmProps {
  areaName: string;
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

export function WakeupAlarm({ areaName, entities, callService }: WakeupAlarmProps) {
  const [isEditing, setIsEditing] = useState(false);

  const areaNameNormalized = areaName.toLowerCase().replace(/\s+/g, '_');

  const toggleId = `input_boolean.wakeup_${areaNameNormalized}`;
  const timeId = `input_datetime.wakeup_${areaNameNormalized}`;

  const toggleEntity = entities?.[toggleId];
  const timeEntity = entities?.[timeId];
  const hasAlarmEntities = !!(toggleEntity || timeEntity);

  const isEnabled = toggleEntity?.state === 'on';
  const alarmTime = timeEntity?.state || '07:00:00';

  // Format time for display (HH:MM)
  const displayTime = alarmTime.slice(0, 5);

  // Parse hours and minutes for the time input
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

  if (!hasAlarmEntities) return null;

  return (
    <div className={`wakeup-alarm ${isEnabled ? 'enabled' : 'disabled'}`}>
      <div className='alarm-main'>
        <button className={`alarm-toggle ${isEnabled ? 'on' : 'off'}`} onClick={handleToggle}>
          <Icon icon={isEnabled ? 'mdi:alarm' : 'mdi:alarm-off'} />
        </button>

        <div className='alarm-info'>
          <span className='alarm-label'>Wake-up Alarm</span>
          <button className='alarm-time' onClick={() => setIsEditing(!isEditing)}>
            <span className='time-display'>{displayTime}</span>
            <Icon icon='mdi:pencil' className='edit-icon' />
          </button>
        </div>

        <div className={`alarm-switch ${isEnabled ? 'on' : ''}`} onClick={handleToggle}>
          <div className='switch-track'>
            <div className='switch-thumb' />
          </div>
        </div>
      </div>

      {/* Time Editor */}
      {isEditing && (
        <div className='alarm-editor'>
          <div className='time-picker'>
            <div className='time-column'>
              <button className='time-btn' onClick={() => adjustHours(1)}>
                <Icon icon='mdi:chevron-up' />
              </button>
              <span className='time-value'>{String(hours).padStart(2, '0')}</span>
              <button className='time-btn' onClick={() => adjustHours(-1)}>
                <Icon icon='mdi:chevron-down' />
              </button>
            </div>
            <span className='time-separator'>:</span>
            <div className='time-column'>
              <button className='time-btn' onClick={() => adjustTime(5)}>
                <Icon icon='mdi:chevron-up' />
              </button>
              <span className='time-value'>{String(minutes).padStart(2, '0')}</span>
              <button className='time-btn' onClick={() => adjustTime(-5)}>
                <Icon icon='mdi:chevron-down' />
              </button>
            </div>
          </div>

          {/* Quick presets */}
          <div className='alarm-presets'>
            {['06:00', '06:30', '07:00', '07:30', '08:00'].map(preset => (
              <button
                key={preset}
                className={`preset-btn ${displayTime === preset ? 'active' : ''}`}
                onClick={() => {
                  const [h, m] = preset.split(':').map(Number);
                  handleTimeChange(h, m);
                }}
              >
                {preset}
              </button>
            ))}
          </div>

          <button className='done-btn' onClick={() => setIsEditing(false)}>
            <Icon icon='mdi:check' />
            Done
          </button>
        </div>
      )}
    </div>
  );
}
