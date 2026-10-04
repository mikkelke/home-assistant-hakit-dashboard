import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

const TOUCH_SLOP_PX = 8;
const MOUSE_SLOP_PX = 4;

interface Gesture {
  id: number;
  x0: number;
  y0: number;
  lastX: number;
  width: number;
  slop: number;
  start: number;
  raw: number;
  engaged: boolean;
}

interface VolumeStripProps {
  value: number;
  onCommit: (next: number) => void;
  label: string;
  mini?: boolean;
  muted?: boolean;
}

/** HA's frontend turns window `haptic` events into native haptics in the companion app. Only reachable
 *  when this page is embedded same-origin; anywhere else fall back to the Vibration API. */
function hapticTick() {
  try {
    const top = window.top as (Window & typeof globalThis) | null;
    if (top && top !== window) {
      top.dispatchEvent(new top.CustomEvent('haptic', { detail: 'selection' }));
      return;
    }
  } catch {
    // cross-origin parent
  }
  navigator.vibrate?.(5);
}

/** Relative-drag volume strip. A tap does nothing; a horizontal drag moves the level by the finger's travel
 *  (one strip width = 100 points) and commits once on release. Vertical swipes are left to the page.
 *  The range input exists only for keyboard and assistive tech. */
export function VolumeStrip({ value, onCommit, label, mini = false, muted = false }: VolumeStripProps) {
  const [drag, setDrag] = useState<number | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const shown = drag ?? Math.max(0, Math.min(100, Math.round(value)));

  const finish = (e: ReactPointerEvent<HTMLDivElement>, commit: boolean) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    if (!g.engaged) return;
    setDrag(null);
    const next = Math.round(g.raw);
    if (commit && next !== g.start) onCommit(next);
  };

  return (
    <>
      <div
        className={`sonos-strip sonos-strip--drag${mini ? ' sonos-strip--mini' : ''}${drag != null ? ' is-dragging' : ''}${muted ? ' is-muted' : ''}`}
        data-interactive='true'
        onPointerDown={e => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          if (gesture.current?.engaged) return;
          gesture.current = {
            id: e.pointerId,
            x0: e.clientX,
            y0: e.clientY,
            lastX: e.clientX,
            width: Math.max(1, e.currentTarget.getBoundingClientRect().width),
            slop: e.pointerType === 'mouse' ? MOUSE_SLOP_PX : TOUCH_SLOP_PX,
            start: shown,
            raw: shown,
            engaged: false,
          };
        }}
        onPointerMove={e => {
          const g = gesture.current;
          if (!g || g.id !== e.pointerId) return;
          if (e.pointerType === 'mouse' && e.buttons === 0) {
            finish(e, false);
            return;
          }
          if (!g.engaged) {
            const dx = Math.abs(e.clientX - g.x0);
            const dy = Math.abs(e.clientY - g.y0);
            if (dy > g.slop && dy >= dx) {
              gesture.current = null;
              return;
            }
            if (dx <= g.slop) return;
            g.engaged = true;
            g.lastX = e.clientX;
            e.currentTarget.setPointerCapture(e.pointerId);
            hapticTick();
            setDrag(g.start);
            return;
          }
          g.raw = Math.max(0, Math.min(100, g.raw + ((e.clientX - g.lastX) / g.width) * 100));
          g.lastX = e.clientX;
          setDrag(Math.round(g.raw));
        }}
        onPointerUp={e => finish(e, true)}
        onPointerCancel={e => finish(e, false)}
        onLostPointerCapture={e => finish(e, false)}
      >
        <div className='sonos-strip-fill' style={{ width: `${shown}%` }} />
        <input
          type='range'
          className='sonos-strip-input'
          min={0}
          max={100}
          step={1}
          value={shown}
          onChange={e => onCommit(Number(e.currentTarget.value))}
          aria-label={label}
        />
      </div>
      <span className={`sonos-volume-value${drag != null ? ' is-live' : ''}`}>{shown}%</span>
    </>
  );
}
