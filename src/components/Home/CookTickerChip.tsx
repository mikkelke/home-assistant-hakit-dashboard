import { Icon } from '@iconify/react';
import { cookProgress, nextCookMoment } from '../../cook/moments';
import type { CookState } from '../../cook/model';
import { useCookLive } from '../../cook/useCook';
import { formatHomeClock } from '../../energy/homeTime';
import { useNowMs } from '../../hooks/useNowMs';

export function CookTickerChip({ state, onOpen }: { state: CookState; onOpen: () => void }) {
  const nowMs = useNowMs();
  const live = useCookLive();
  const moment = nextCookMoment(state, nowMs);
  if (!moment) return null;
  const progress = cookProgress(state, live, nowMs);
  const time = moment.atMs != null ? `${moment.approximate ? '≈ ' : ''}${formatHomeClock(moment.atMs)}` : moment.urgent ? '' : '—';
  const tone = moment.alarm ? 'is-cook-alarm' : moment.urgent ? 'is-cook-now' : state.probe.phase === 'off' ? 'is-cook-bath' : 'is-cook';
  return (
    <button type='button' className={`ticker-chip ${tone}`} onClick={onOpen} aria-label={`Cook, ${moment.label}${time ? ` ${time}` : ''}`}>
      <Icon
        icon={moment.alarm ? 'mdi:alert-circle-outline' : state.probe.phase === 'off' ? 'mdi:pot-steam-outline' : 'mdi:thermometer'}
        aria-hidden='true'
      />
      <b>{moment.label}</b>
      {time && <em>{time}</em>}
      <span className='ticker-fill' aria-hidden='true'>
        <i style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
      </span>
    </button>
  );
}
