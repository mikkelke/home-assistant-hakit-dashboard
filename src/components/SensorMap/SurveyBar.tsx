import type { SurveyProgress } from '../../sensorMap/survey';
import type { WifiReady } from '../../sensorMap/wifi';
import { READY_TEXT } from './wifiText';

interface SurveyBarProps {
  progress: SurveyProgress;
  wifi: WifiReady;
  /** The text of the chip that opens the suggested setup, or null when none waits. */
  setup: string | null;
  /** What the last capture caught, or what went wrong with it. */
  result: { text: string; ok: boolean } | null;
  busy: boolean;
  onNext: () => void;
  onSetup: () => void;
}

/** The survey's controls under the layer chips: how far along it is, the next point, and whether Wi-Fi is ready. */
export function SurveyBar({ progress, wifi, setup, result, busy, onNext, onSetup }: SurveyBarProps) {
  const left = progress.total - progress.done - progress.skipped;
  return (
    <div className='sm-subbar' role='group' aria-label='Survey'>
      <div className='sm-subbar-row'>
        <span className='sm-chip small static on' role='status'>
          {progress.done} of {progress.total}
        </span>
        {progress.skipped > 0 && <span className='sm-count'>{progress.skipped} skipped</span>}
        {progress.noWifi > 0 && <span className='sm-chip small static warn'>{progress.noWifi} without Wi-Fi</span>}
        <button type='button' className='sm-chip small' disabled={busy || left === 0} onClick={onNext}>
          Next point
        </button>
        {setup ? (
          <button type='button' className='sm-chip small warn' onClick={onSetup}>
            {setup}
          </button>
        ) : (
          <span className={`sm-chip small static${wifi === 'ready' ? '' : ' warn'}`}>{READY_TEXT[wifi]}</span>
        )}
      </div>
      <p className={`sm-subbar-note${result && !result.ok ? ' warn' : ''}`} role='status'>
        {result ? result.text : 'Keep the screen on for 10 s at each point.'}
      </p>
    </div>
  );
}
