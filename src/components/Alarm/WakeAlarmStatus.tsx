import { useEffect, useState } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities } from '../../types';
import { activeWakeSession, readWakeSession, snoozeCountdown, WAKE_ALARM_OPEN_EVENT, WAKE_SESSION_ENTITY } from './wakeSession';

export function WakeAlarmStatus({ entities }: { entities: HassEntities }) {
  const session = readWakeSession(entities[WAKE_SESSION_ENTITY]);
  const [now, setNow] = useState(() => Date.now());
  const snoozing = session.state === 'snoozing';
  useEffect(() => {
    if (!snoozing) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [snoozing]);
  if (!activeWakeSession(session)) return null;
  return (
    <button type='button' className='wakeup-session-status' onClick={() => window.dispatchEvent(new Event(WAKE_ALARM_OPEN_EVENT))}>
      <Icon icon={snoozing ? 'mdi:alarm-snooze' : session.radioPlaying ? 'mdi:radio' : 'mdi:volume-off'} aria-hidden='true' />
      <span>
        {snoozing ? `Snoozing · ${snoozeCountdown(session.until, now)}` : session.radioPlaying ? 'Radio playing' : 'Radio stopped'}
      </span>
      <span className='wakeup-session-open'>
        Open alarm
        <Icon icon='mdi:chevron-right' aria-hidden='true' />
      </span>
    </button>
  );
}
