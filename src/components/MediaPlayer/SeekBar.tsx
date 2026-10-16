export interface SeekBarProps {
  /** Where the viewer sees the player, in seconds. */
  position: number;
  /** The length of what plays, in seconds; above zero. */
  duration: number;
  /** The thumb moved to a position, in seconds. */
  onDrag: (seconds: number) => void;
  /** The viewer let go of the thumb. */
  onRelease: () => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function SeekBar({ position, duration, onDrag, onRelease }: SeekBarProps) {
  const percent = Math.max(0, Math.min(100, (position / duration) * 100));
  return (
    <div className='sonos-seek'>
      <div className='sonos-strip sonos-strip--thin'>
        <div className='sonos-strip-fill' style={{ width: `${percent}%` }} />
        <input
          type='range'
          className='sonos-strip-input'
          min={0}
          max={duration}
          step={1}
          value={position}
          onChange={e => onDrag(Number(e.target.value))}
          onMouseUp={onRelease}
          onTouchEnd={onRelease}
          aria-label='Seek position'
        />
      </div>
      <div className='sonos-seek-times'>
        <span>{formatTime(position)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
