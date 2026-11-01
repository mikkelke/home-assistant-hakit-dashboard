import { useSyncExternalStore } from 'react';
import { COFFEE_TABLET_VIEWER } from '../../coffee/entities';
import { useViewer } from '../../hooks/useViewer';
import type { CallServiceFunction, HassEntities } from '../../types';
import { WakeAlarmSession } from './WakeAlarmSession';

const PHONE_QUERY = '(max-width: 600px)';

const subscribePhone = (notify: () => void) => {
  const query = window.matchMedia?.(PHONE_QUERY);
  query?.addEventListener('change', notify);
  return () => query?.removeEventListener('change', notify);
};
const isPhoneNow = () => window.matchMedia?.(PHONE_QUERY).matches ?? false;

interface Props {
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

/** The alarm is Mikkel's: the sheet opens on the administrator's phone only, never on the tablet or a housemate's device. */
export function WakeAlarmGate(props: Props) {
  const viewer = useViewer();
  const phone = useSyncExternalStore(subscribePhone, isPhoneNow, () => false);
  if (viewer.isAdmin !== true || viewer.name === COFFEE_TABLET_VIEWER || !phone) return null;
  return <WakeAlarmSession {...props} />;
}
