import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import { attrNum } from '../../types';
import { useLocalStorageBoolean, useTouchScrollSlopGuard } from '../../hooks';
import './CoverCard.css';

// Blind card — same collapsed-by-default iOS shell as HeatCard/TonightCard. Presentation only:
// every value here comes straight off the cover entity, this component never computes anything
// beyond the open/closed word derived from its own reported position.

interface CoverCardProps {
  areaName: string;
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

// The bedroom blind's single-writer owner app (AppDaemon BedroomBlindOwner) publishes who
// currently owns the blind and why. This CONTRACT is fixed on both sides (2026-08-12):
// state = winning source key manual|vent|wake|shade|idle; attributes: position (number),
// manual_pause_until (ISO string or ''), claims ([{source, position}]), reason (sentence).
// The row renders nothing until the sensor exists and something is actually managing the
// blind - silence means there is nothing to say, same rule as the weather footer.
const BLIND_OWNER_ENTITY = 'sensor.bedroom_blind_owner';

const OWNER_WORDS: Record<string, string> = {
  manual: 'Yours',
  vent: 'Held open for venting',
  wake: 'Morning routine has it',
  shade: 'Solar shade is balancing daylight',
};

const CLAIM_WORDS: Record<string, string> = {
  manual: 'you',
  vent: 'venting',
  wake: 'morning routine',
  shade: 'solar shade',
};

function pauseUntilLabel(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  const t = new Date(raw);
  if (Number.isNaN(t.getTime())) return null;
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}

export function CoverCard({ areaName, entities, callService }: CoverCardProps) {
  const headerSlop = useTouchScrollSlopGuard();
  const areaNameNormalized = areaName.toLowerCase().replace(/\s+/g, '_');
  const [collapsed, setCollapsed] = useLocalStorageBoolean(`covercard-collapsed-${areaNameNormalized}`, true);

  // Entity ID
  const coverId = `cover.${areaNameNormalized}_blind`;
  const cover = entities?.[coverId];

  // HA reports 0 = closed, 100 = open. We want UI showing 0=open, 100=closed.
  const devicePosition = attrNum(cover?.attributes?.current_position, 0); // HA: 0 = open, 100 = closed
  const uiPosition = devicePosition; // UI matches HA: 0 open, 100 closed
  const isBathroom = areaNameNormalized === 'bathroom';
  const isBedroom = areaNameNormalized === 'bedroom';
  const [sliderValue, setSliderValue] = useState(uiPosition);

  // keep slider in sync with HA updates (defer to avoid sync setState in effect)
  useEffect(() => {
    if (!Number.isNaN(uiPosition)) {
      const id = setTimeout(() => setSliderValue(uiPosition), 0);
      return () => clearTimeout(id);
    }
  }, [uiPosition]);

  if (!cover) return null;

  const state = String(cover.state ?? ''); // open, closed, opening, closing
  const isOpen = state === 'open';
  const isClosed = state === 'closed';
  const isMoving = state === 'opening' || state === 'closing';

  const positionWord = sliderValue <= 0 ? 'Open' : sliderValue >= 100 ? 'Closed' : `${sliderValue}%`;
  const movingWord = state === 'opening' ? 'Opening…' : 'Closing…';

  // Who owns the blind right now (bedroom only, and only while something is managing it).
  const ownerEntity = isBedroom ? entities?.[BLIND_OWNER_ENTITY] : undefined;
  const ownerSource = String(ownerEntity?.state ?? '');
  const ownerWord = OWNER_WORDS[ownerSource];
  const ownerPause = pauseUntilLabel(ownerEntity?.attributes?.manual_pause_until);
  const rawClaims = ownerEntity?.attributes?.claims;
  const ownerClaims = Array.isArray(rawClaims)
    ? (rawClaims as Array<Record<string, unknown>>).flatMap(c => {
        const src = typeof c?.source === 'string' ? c.source : '';
        const pos = Number(c?.position);
        const word = CLAIM_WORDS[src];
        return word && Number.isFinite(pos) ? [`${word} wants ${Math.round(pos)}`] : [];
      })
    : [];

  const handleOpen = () => {
    if (!callService) return;
    // For bathroom and bedroom, "up" (open_cover) actually closes the blinds
    if (isBathroom || isBedroom) {
      callService({
        domain: 'cover',
        service: 'close_cover',
        target: { entity_id: coverId },
      });
    } else {
      callService({
        domain: 'cover',
        service: 'open_cover',
        target: { entity_id: coverId },
      });
    }
  };

  const handleClose = () => {
    if (!callService) return;
    // For bathroom and bedroom, "down" (close_cover) actually opens the blinds
    if (isBathroom || isBedroom) {
      callService({
        domain: 'cover',
        service: 'open_cover',
        target: { entity_id: coverId },
      });
    } else {
      callService({
        domain: 'cover',
        service: 'close_cover',
        target: { entity_id: coverId },
      });
    }
  };

  const handleStop = () => {
    if (!callService) return;
    callService({
      domain: 'cover',
      service: 'stop_cover',
      target: { entity_id: coverId },
    });
  };

  // The household's one meaningful preset: ~38-40% blocks direct sun while keeping
  // daylight — the same position the solar-shade routine drives to. "Default" where
  // the motor runs inverted (bathroom/bedroom), "Day" elsewhere.
  const dayPreset = isBathroom ? 40 : 38;
  const dayLabel = isBathroom || isBedroom ? 'Default' : 'Day';
  const isAtDay = !isMoving && Math.abs(sliderValue - dayPreset) <= 2;

  const handleDay = () => {
    if (!callService) return;
    callService({
      domain: 'cover',
      service: 'set_cover_position',
      target: { entity_id: coverId },
      serviceData: { position: dayPreset },
    });
  };

  return (
    <div className='cover-card'>
      {/* Header - collapsed view */}
      <div
        className='cover-header'
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
        <span className='cover-glyph'>
          <Icon icon='mdi:blinds' aria-hidden='true' />
        </span>
        <span className='cover-title'>Blind</span>
        {/* Collapsed quick actions (user 2026-08-07): the two positions that matter without
            expanding — Default (the everyday open; past it only fixed glass shows) and Close.
            Same quick-dot grammar as LightCard's bulbs; the tinted one is where the blind is. */}
        {collapsed && (
          <span className='cover-quick' onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} role='presentation'>
            <button
              type='button'
              className={`cover-quick-btn ${isAtDay ? 'is-current' : ''}`}
              onClick={handleDay}
              aria-label={`Blind to ${dayLabel.toLowerCase()} position`}
              title={dayLabel}
            >
              <Icon icon='mdi:blinds-horizontal' aria-hidden='true' />
            </button>
            <button
              type='button'
              className={`cover-quick-btn ${sliderValue >= 98 ? 'is-current' : ''}`}
              onClick={handleClose}
              aria-label='Close the blind'
              title='Close'
            >
              <Icon icon='mdi:arrow-up-bold' aria-hidden='true' />
            </button>
          </span>
        )}
        <span className='cover-header-right'>
          <span className={`cover-word ${isMoving ? 'tint' : 'muted'}`}>{isMoving ? movingWord : positionWord}</span>
          <Icon icon={collapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'} aria-hidden='true' className='cover-chevron' />
        </span>
      </div>

      {/* Expanded content */}
      {!collapsed && (
        <div className='cover-content'>
          <div className='cover-hero'>
            <div className='cover-hero-value'>{positionWord}</div>
          </div>

          <div className='cover-controls'>
            <button type='button' className={`cover-btn ${isOpen ? 'active' : ''}`} onClick={handleOpen}>
              <Icon icon='mdi:arrow-down-bold' />
              <span>Open</span>
            </button>
            <button type='button' className={`cover-btn ${isAtDay ? 'active' : ''}`} onClick={handleDay}>
              <Icon icon='mdi:blinds-horizontal' />
              <span>{dayLabel}</span>
            </button>
            <button type='button' className='cover-btn stop' onClick={handleStop}>
              <Icon icon='mdi:stop' />
              <span>Stop</span>
            </button>
            <button type='button' className={`cover-btn ${isClosed ? 'active' : ''}`} onClick={handleClose}>
              <Icon icon='mdi:arrow-up-bold' />
              <span>Close</span>
            </button>
          </div>

          {/* Owner line: who is managing the blind and why (words are states). Hidden until
              the owner app publishes, and on idle - silence means nothing is managing it. */}
          {ownerWord && (
            <div className='cover-owner'>
              <span className='cover-owner-word'>
                {ownerSource === 'manual' && ownerPause ? `Yours — automations hold off until ${ownerPause}` : ownerWord}
              </span>
              {ownerClaims.length > 0 && <span className='cover-owner-claims'>{ownerClaims.join(' · ')}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
