import { Icon } from '@iconify/react';
import type { CoffeeState, Recipe } from '../../coffee/model';
import { brewWhen, waterCups, waterLine, type WaterShort } from '../../coffee/view';
import { CoffeeSheet } from './parts';
import { registerFill } from './useWaterGuard';

type Tank = Pick<CoffeeState, 'tankMl' | 'tankLeftMl'>;
type Volume = Pick<Recipe, 'totalMl'>;

/** A start held back for water, in the cup prompt's shape: Filled registers the fill and starts, Start anyway starts. */
export function WaterPrompt({
  short,
  size,
  busy,
  onFilled,
  onAnyway,
}: {
  short: WaterShort;
  size: 'xl' | 'md';
  busy: boolean;
  onFilled: () => void;
  onAnyway: () => void;
}) {
  return (
    <div className={`coffee-cupwait is-water is-${size}`} role='status'>
      <div className='coffee-cupwait-main'>
        <span className='coffee-cupwait-disc'>
          <Icon icon='mdi:water-alert' aria-hidden='true' />
        </span>
        <span className='coffee-cupwait-tx'>
          <b>Fill the water tank</b>
          <small>
            About {Math.round(short.leftMl)} ml left · this cup needs {short.needMl} ml
          </small>
        </span>
      </div>
      <div className='coffee-cupwait-btns'>
        <button type='button' disabled={busy} onClick={onAnyway}>
          <Icon icon='mdi:play' aria-hidden='true' />
          Start anyway
        </button>
        <button type='button' className='is-sky' disabled={busy} onClick={onFilled}>
          <Icon icon='mdi:water-plus' aria-hidden='true' />
          Filled
        </button>
      </div>
    </div>
  );
}

/** The tank beside the link and cup chips: cups of the usual left, amber once the usual no longer fits. It opens the
 * water sheet, where Filled lives. */
export function WaterChip({ state, usual, big = false, onOpen }: { state: Tank; usual: Volume | null; big?: boolean; onOpen: () => void }) {
  const line = waterLine(state, usual);
  const unknown = state.tankLeftMl == null;
  return (
    <button
      type='button'
      className={`coffee-chip coffee-waterchip ${line.low ? 'is-warn' : unknown ? '' : 'is-sky'} ${big ? 'is-big' : ''}`}
      onClick={onOpen}
      aria-label={`Water tank, ${unknown ? 'level not known' : line.text}`}
    >
      <Icon icon={line.low ? 'mdi:water-alert' : unknown ? 'mdi:water-outline' : 'mdi:water'} aria-hidden='true' />
      {unknown ? 'Water unknown' : line.text}
    </button>
  );
}

/** What the coffee app counts in the tank, and Filled for when it was filled. Before the first fill is registered the
 * level is unknown, and Filled starts the count. */
export function WaterSheet({
  state,
  usual,
  nowMs,
  onClose,
}: {
  state: Pick<CoffeeState, 'tankMl' | 'tankLeftMl' | 'tankFilledAtMs'>;
  usual: Volume | null;
  nowMs: number;
  onClose: () => void;
}) {
  const line = waterLine(state, usual);
  const note =
    state.tankLeftMl == null
      ? 'The level is not counted yet. Fill the tank, then tap Filled to start the count.'
      : [
          `About ${Math.round(state.tankLeftMl)} ml left`,
          waterCups(state, usual) != null ? `${line.text} of the usual` : null,
          state.tankFilledAtMs != null ? `filled ${brewWhen(state.tankFilledAtMs, nowMs)}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
  return (
    <CoffeeSheet icon='mdi:water' title='Water tank' historyKey='coffee-water' onClose={onClose}>
      <div className='coffee-sheet-stack'>
        <p className='coffee-sheet-note'>{note}</p>
        <button
          type='button'
          className='coffee-btn is-sky'
          onClick={() => {
            void registerFill();
            onClose();
          }}
        >
          <Icon icon='mdi:water-plus' aria-hidden='true' />
          Filled
        </button>
      </div>
    </CoffeeSheet>
  );
}

/** The tank on the card's idle view, below the beans: Filled registers a fill at once. */
export function WaterRow({ state, usual, hint }: { state: Tank; usual: Volume | null; hint: string | null }) {
  const line = waterLine(state, usual);
  return (
    <div className={`cc-beans cc-water ${line.low ? 'is-low' : ''}`}>
      <span className='cc-disc'>
        <Icon icon={line.low ? 'mdi:water-alert' : 'mdi:water'} aria-hidden='true' />
      </span>
      <span className='cc-beans-tx'>
        <b>Water · {line.text}</b>
        {hint && <small>{hint}</small>}
      </span>
      <button
        type='button'
        className='coffee-chip is-sky coffee-water-fill'
        onClick={() => void registerFill()}
        aria-label='Water tank, filled'
      >
        <Icon icon='mdi:water-plus' aria-hidden='true' />
        Filled
      </button>
    </div>
  );
}
