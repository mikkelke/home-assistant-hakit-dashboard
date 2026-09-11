import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@iconify/react';
import type { CallServiceFunction, HassEntities } from '../../types';
import { FIRE_HUSH_BUTTON, FIRE_REARM_BUTTON } from '../../config/entities';
import { deriveFireSafety, faultLabel, formatCountdown, FIRE_SAFETY_OPEN_EVENT, type FireSafetyModel } from '../../utils/fireSafety';
import { ApplianceSheet } from '../Appliance';
import { HoldToAct } from './HoldToAct';
import './FireSafety.css';

const ACCENT_CLASS = 'appliance-accent-fire';
const HUSH_LABEL = "It's just cooking — silence 10 min";

interface FireAlarmTakeoverProps {
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

function useNowTicking(active: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

function RehearsalTag() {
  return (
    <span className='fire-rehearsal-tag'>
      <Icon icon='mdi:test-tube' aria-hidden='true' />
      Rehearsal
    </span>
  );
}

function AlarmScreen({ fire, onHush }: { fire: FireSafetyModel; onHush: () => void }) {
  return (
    <div className='fire-takeover' role='alertdialog' aria-modal='true' aria-label='Smoke detected'>
      <div className='fire-takeover-center'>
        {fire.dryRun && <RehearsalTag />}
        <span className='fire-takeover-glyph'>
          <Icon icon='mdi:smoke-detector-variant-alert' aria-hidden='true' />
        </span>
        <h1 className='fire-takeover-headline'>{fire.headline || 'Smoke detected'}</h1>
        {fire.detail && <p className='fire-takeover-detail'>{fire.detail}</p>}
        <p className='fire-takeover-note'>If you see fire or smoke, get everyone out first.</p>
      </div>
      <div className='fire-takeover-actions'>
        <HoldToAct label={HUSH_LABEL} hint='Press and hold' onAct={onHush} />
      </div>
    </div>
  );
}

const HUSH_BAR_CLASS = 'fire-hushed';
const HUSH_BAR_HEIGHT_VAR = '--fire-hush-bar-h';

/** Publishes the bar's measured height on <html> so the page pushes down under it instead of
 * being covered (the status bar's avatar row and the price strip sit exactly where it lands). */
function useHushBarInset(ref: React.RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el) return;
    const apply = () => root.style.setProperty(HUSH_BAR_HEIGHT_VAR, `${el.offsetHeight}px`);
    root.classList.add(HUSH_BAR_CLASS);
    apply();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.classList.remove(HUSH_BAR_CLASS);
      root.style.removeProperty(HUSH_BAR_HEIGHT_VAR);
    };
  }, [ref]);
}

function HushBar({ fire, now, onRearm }: { fire: FireSafetyModel; now: Date; onRearm: () => void }) {
  const who = fire.hushedBy ? `Silenced by ${fire.hushedBy}` : 'Silenced';
  const ref = useRef<HTMLDivElement | null>(null);
  useHushBarInset(ref);
  return (
    <div className='fire-hush-bar' role='status' ref={ref}>
      <Icon icon='mdi:bell-off-outline' aria-hidden='true' />
      <span className='fire-hush-text'>
        {who} — <strong>{formatCountdown(fire.hushedUntil, now)}</strong> left
        <small>Re-arms automatically</small>
      </span>
      {fire.dryRun && <RehearsalTag />}
      <button type='button' className='fire-hush-rearm' onClick={onRearm}>
        Re-arm now
      </button>
    </div>
  );
}

function FireSheet({
  fire,
  now,
  onClose,
  onHush,
  onRearm,
}: {
  fire: FireSafetyModel;
  now: Date;
  onClose: () => void;
  onHush: () => void;
  onRearm: () => void;
}) {
  const fault = faultLabel(fire.fault);
  let headline = fire.headline;
  let detail = fire.detail;
  let note: string | null = null;
  let glyph = 'mdi:smoke-detector-variant';

  if (fire.phase === 'pre_alarm') {
    headline = 'Smoke building in the kitchen';
    glyph = 'mdi:smoke-detector-variant-alert';
    note = 'The alarm has noticed something and may sound soon. If it is cooking, silence it now.';
  } else if (fire.phase === 'hushed') {
    headline = fire.hushedBy ? `Silenced by ${fire.hushedBy}` : 'Silenced';
    detail = `${formatCountdown(fire.hushedUntil, now)} left · re-arms automatically`;
    glyph = 'mdi:bell-off-outline';
  } else if (fire.phase === 'cooldown') {
    headline = 'Kitchen alarm clearing';
    glyph = 'mdi:timer-sand';
    note = 'Smoke is gone. The alarm goes back to normal on its own in a few minutes.';
  } else if (fault) {
    headline = fault;
    glyph = fire.fault === 'battery_low' ? 'mdi:battery-alert-variant-outline' : 'mdi:smoke-detector-variant-off';
    note =
      fire.fault === 'offline'
        ? 'The kitchen smoke alarm has stopped reporting. Mikkel has been told.'
        : fire.fault === 'battery_low'
          ? 'The kitchen smoke alarm needs a fresh battery soon. Mikkel has been told.'
          : 'The kitchen smoke alarm is due for its routine test. Mikkel has been told.';
  }

  return (
    <ApplianceSheet accentClassName={ACCENT_CLASS} glyphIcon={glyph} title='Smoke alarm' historyKey='fire-safety-sheet' onClose={onClose}>
      <div className='fire-sheet-status'>
        <span className='fire-sheet-dot' aria-hidden='true' />
        <div>
          <div className='fire-sheet-headline'>{headline}</div>
          {detail && <div className='fire-sheet-detail'>{detail}</div>}
        </div>
        {fire.dryRun && <RehearsalTag />}
      </div>
      {note && <p className='fire-sheet-note'>{note}</p>}
      <div className='fire-sheet-actions'>
        {(fire.phase === 'pre_alarm' || fire.phase === 'alarm') && (
          <HoldToAct tone='dark' label={HUSH_LABEL} hint='Press and hold' onAct={onHush} />
        )}
        {fire.phase === 'hushed' && (
          <button type='button' className='fire-sheet-text-btn' onClick={onRearm}>
            Re-arm now
          </button>
        )}
      </div>
    </ApplianceSheet>
  );
}

/** Mounted once, outside every page and route. Portals to document.body so the alarm covers
 * room panels, the Energy page and the intercom overlays alike. */
export function FireAlarmTakeover({ entities, callService }: FireAlarmTakeoverProps) {
  const fire = useMemo(() => deriveFireSafety(entities), [entities]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const now = useNowTicking(fire.phase === 'hushed');

  useEffect(() => {
    const open = () => setSheetOpen(true);
    window.addEventListener(FIRE_SAFETY_OPEN_EVENT, open);
    return () => window.removeEventListener(FIRE_SAFETY_OPEN_EVENT, open);
  }, []);

  const press = useCallback(
    (entityId: string) => {
      callService?.({ domain: 'input_button', service: 'press', target: { entity_id: entityId } });
    },
    [callService]
  );
  const hush = useCallback(() => press(FIRE_HUSH_BUTTON), [press]);
  const rearm = useCallback(() => press(FIRE_REARM_BUTTON), [press]);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const showAlarm = fire.present && fire.phase === 'alarm';
  const showHush = fire.present && fire.phase === 'hushed';
  const showSheet = sheetOpen && !showAlarm && fire.present && (fire.phase !== 'clear' || fire.fault !== null);

  if (typeof document === 'undefined') return null;

  return (
    <>
      {showAlarm && createPortal(<AlarmScreen fire={fire} onHush={hush} />, document.body)}
      {showHush && createPortal(<HushBar fire={fire} now={now} onRearm={rearm} />, document.body)}
      {showSheet && <FireSheet fire={fire} now={now} onClose={closeSheet} onHush={hush} onRearm={rearm} />}
    </>
  );
}
