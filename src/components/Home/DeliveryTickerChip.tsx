import { Icon } from '@iconify/react';
import { QUICK_ACCESS_OPEN_EVENT } from '../../config/transit';
import { chipView, type DeliveryFeed } from '../../delivery/model';
import { useNowMs } from '../../hooks/useNowMs';
import { trackUiTap } from '../../utils/trackUiTap';

const TONE_CLASS = { live: 'is-delivery', now: 'is-delivery-now', quiet: 'is-delivery-quiet' } as const;

/** What is on its way, on the sky's ground: the first delivery with its minutes and clock time, or only a count of the
 * parcels still to come. A tap opens the delivery sheet. */
export function DeliveryTickerChip({ feed }: { feed: DeliveryFeed }) {
  const nowMs = useNowMs();
  const view = chipView(feed, nowMs);
  if (!view) return null;
  return (
    <button
      type='button'
      className={`ticker-chip ${TONE_CLASS[view.tone]}`}
      onClick={() => {
        window.dispatchEvent(new CustomEvent(QUICK_ACCESS_OPEN_EVENT, { detail: { modal: 'delivery' } }));
        trackUiTap('home.delivery');
      }}
      aria-label={view.label}
    >
      <Icon icon={view.icon} aria-hidden='true' />
      <b>{view.headline}</b>
      {view.clock && <em>{view.clock}</em>}
      {view.more > 0 && <em>+{view.more}</em>}
    </button>
  );
}
