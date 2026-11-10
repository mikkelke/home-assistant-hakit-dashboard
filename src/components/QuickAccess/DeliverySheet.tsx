import { Icon } from '@iconify/react';
import {
  carrierName,
  deliveryIcon,
  itemsText,
  railSteps,
  stageWord,
  timing,
  upcomingView,
  type Delivery,
  type DeliveryStage,
  type Timing,
} from '../../delivery/model';
import { useHomeDelivery } from '../../delivery/useHomeDelivery';
import { useNowMs } from '../../hooks/useNowMs';
import './DeliverySheet.css';

function Hero({ when }: { when: Timing }) {
  return (
    <div className='dl-hero'>
      <strong>{when.headline}</strong>
      {when.clock && <span>≈ {when.clock}</span>}
    </div>
  );
}

function Rail({ stage }: { stage: DeliveryStage }) {
  return (
    <ol className='dl-rail' aria-label='Order progress'>
      {railSteps(stage).map(step => (
        <li key={step.key} className={`dl-step is-${step.state}`} aria-current={step.state === 'now' ? 'step' : undefined}>
          <span className='dl-dot'>
            <Icon icon={step.icon} aria-hidden='true' />
          </span>
          <b>{step.label}</b>
        </li>
      ))}
    </ol>
  );
}

function Row({ icon, text }: { icon: string; text: string }) {
  return (
    <li className='dl-row'>
      <Icon icon={icon} aria-hidden='true' />
      <span>
        <b>{text}</b>
      </span>
    </li>
  );
}

function ActiveCard({ delivery, nowMs }: { delivery: Delivery; nowMs: number }) {
  const when = timing(delivery, nowMs);
  const carrier = delivery.kind === 'parcel' ? carrierName(delivery.source) : '';
  const sub = carrier && carrier.toLowerCase() !== delivery.title.toLowerCase() ? carrier : null;
  return (
    <section className={`dl-card ${delivery.stage === 'arriving' ? 'is-now' : ''}`} aria-label={delivery.title}>
      <div className='dl-head'>
        <span className='dl-disc'>
          <Icon icon={deliveryIcon(delivery)} aria-hidden='true' />
        </span>
        <span className='dl-name'>
          <b>{delivery.title}</b>
          {sub && <small>{sub}</small>}
        </span>
      </div>
      {when && <Hero when={when} />}
      {delivery.kind === 'food' && <Rail stage={delivery.stage} />}
      <ul className='dl-rows'>
        {delivery.kind === 'food' ? (
          delivery.itemCount != null && <Row icon='mdi:receipt-text-outline' text={itemsText(delivery.itemCount)} />
        ) : (
          <Row
            icon={delivery.stage === 'preparing' ? 'mdi:calendar-clock-outline' : 'mdi:truck-delivery-outline'}
            text={stageWord(delivery)}
          />
        )}
      </ul>
    </section>
  );
}

/** The sheet's body: the deliveries on their way with their minutes, then the parcels still days away. It reads and
 * trims the feed itself, so it shows only what the viewer may see. */
export function DeliverySheetBody() {
  const feed = useHomeDelivery();
  const nowMs = useNowMs();
  if (feed.active.length === 0 && feed.upcoming.length === 0) {
    return (
      <p className='dl-empty'>
        <Icon icon='mdi:package-variant-closed-check' aria-hidden='true' />
        Nothing on the way
      </p>
    );
  }
  return (
    <div className='dl-body'>
      {feed.active.map(delivery => (
        <ActiveCard key={delivery.id} delivery={delivery} nowMs={nowMs} />
      ))}
      {feed.upcoming.length > 0 && (
        <>
          {feed.active.length > 0 && (
            <p className='dl-later'>
              <Icon icon='mdi:calendar-clock-outline' aria-hidden='true' />
              Later
            </p>
          )}
          <ul className='dl-rows dl-upcoming'>
            {feed.upcoming.map(parcel => {
              const view = upcomingView(parcel, nowMs);
              return (
                <li key={view.id} className={`dl-row ${view.attention ? 'is-attention' : ''}`}>
                  <Icon icon={view.icon} aria-hidden='true' />
                  <span>
                    <b>{view.title}</b>
                    <small>{view.sub}</small>
                  </span>
                  {view.planned && (
                    <em>
                      <Icon icon='mdi:calendar-clock-outline' aria-hidden='true' />
                      {view.planned}
                    </em>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
