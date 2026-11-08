import { useId, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import { sendCookCommand, type CookCommands, type CookOp } from '../../cook/command';
import { COOK_PRESETS, type CookState, type PresetKey } from '../../cook/model';
import { useAnovaReachable } from '../../cook/useAnovaReachable';
import { HoldButton } from '../Coffee/HoldButton';
import { duration } from './view';

const PRESET_ICONS: Record<PresetKey, string> = {
  beef: 'mdi:cow',
  lamb: 'mdi:sheep',
  pork: 'mdi:pig',
  chicken: 'mdi:food-drumstick',
  duck: 'mdi:duck',
  fish: 'mdi:fish',
  custom: 'mdi:plus-minus',
};

function useCookCommand() {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <Op extends CookOp>(op: Op, data: CookCommands[Op]) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await sendCookCommand(op, data);
    } catch {
      setError('Command did not send. Check the connection and try again.');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  return { run, pending, error };
}

function Stepper({
  label,
  value,
  onChange,
  step = 1,
  min = 1,
  max = 100,
  suffix = '°',
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <div className='cook-stepper' role='group' aria-label={label}>
      <button
        type='button'
        aria-label={`Decrease ${label.toLowerCase()}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
      >
        <Icon icon='mdi:minus' />
      </button>
      <output aria-live='polite'>{suffix === 'min' ? duration(value) : `${value}${suffix}`}</output>
      <button
        type='button'
        aria-label={`Increase ${label.toLowerCase()}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
      >
        <Icon icon='mdi:plus' />
      </button>
    </div>
  );
}

export function ProbeControls({ state }: { state: CookState }) {
  const { probe } = state;
  const { run, pending, error } = useCookCommand();
  const presetsId = useId();
  const [expanded, setExpanded] = useState(false);
  const [custom, setCustom] = useState(false);
  const [serve, setServe] = useState(probe.serve ?? 54);
  if (probe.phase === 'off') return null;
  const selecting = probe.phase === 'tracking' || probe.phase === 'near';
  const presets = state.presets.length ? state.presets : COOK_PRESETS;
  const selected = probe.preset ?? 'beef';
  const selectedServe = probe.serve ?? presets.find(preset => preset.key === selected)?.serve ?? 54;
  return (
    <div className='cook-probe-controls'>
      {selecting && (
        <>
          <button
            type='button'
            className='cook-chip cook-preset-toggle is-selected'
            aria-label={`Change serve temperature preset, ${selected} ${selectedServe} degrees`}
            aria-expanded={expanded}
            aria-controls={presetsId}
            disabled={pending}
            onClick={() => setExpanded(value => !value)}
          >
            <Icon icon={PRESET_ICONS[selected]} aria-hidden='true' />
            {selectedServe}°
            <Icon icon={expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} aria-hidden='true' />
          </button>
          {expanded && (
            <div id={presetsId} className='cook-presets' role='group' aria-label='Serve temperature preset'>
              {presets
                .filter(preset => preset.key !== 'custom')
                .map(preset => (
                  <button
                    type='button'
                    key={preset.key}
                    disabled={pending}
                    aria-label={`${preset.key}, serve ${preset.serve} degrees, pull at ${preset.pull}`}
                    aria-pressed={probe.preset === preset.key}
                    className={`cook-chip ${probe.preset === preset.key ? 'is-selected' : ''}`}
                    onClick={() => {
                      setCustom(false);
                      setExpanded(false);
                      void run('probe_preset', { key: preset.key as Exclude<PresetKey, 'custom'> });
                    }}
                  >
                    <Icon icon={PRESET_ICONS[preset.key]} aria-hidden='true' />
                    {preset.serve}°
                  </button>
                ))}
              <button
                type='button'
                className={`cook-chip ${probe.preset === 'custom' ? 'is-selected' : ''}`}
                aria-label='Custom serve temperature'
                aria-expanded={custom}
                onClick={() => setCustom(value => !value)}
              >
                <Icon icon='mdi:plus-minus' />
              </button>
            </div>
          )}
          {expanded && custom && (
            <div className='cook-custom'>
              <span className='cook-label'>Serve · pull at {serve - 3}°</span>
              <Stepper label='Serve temperature' value={serve} onChange={setServe} min={10} />
              <button
                className='cook-button'
                type='button'
                disabled={pending}
                onClick={() => {
                  setExpanded(false);
                  void run('probe_preset', { key: 'custom', serve });
                }}
              >
                Use {serve}°
              </button>
            </div>
          )}
        </>
      )}
      {(selecting || probe.phase === 'pull') && (
        <button
          type='button'
          className={`cook-button ${probe.phase === 'pull' ? 'is-act' : ''}`}
          disabled={pending}
          onClick={() => void run('probe_pulled', {})}
        >
          <Icon icon='mdi:tray-arrow-up' aria-hidden='true' />
          Pulled
        </button>
      )}
      {probe.phase === 'resting' && <p className='cook-hint'>Resting · keep the needle in the meat</p>}
      {probe.phase === 'carve' && (
        <button type='button' className='cook-button is-act' disabled={pending} onClick={() => void run('probe_done', {})}>
          <Icon icon='mdi:silverware-fork-knife' aria-hidden='true' />
          Carved
        </button>
      )}
      {error && (
        <p className='cook-error' role='alert'>
          {error}
        </p>
      )}
    </div>
  );
}

export function BathControls({ state }: { state: CookState }) {
  const { bath } = state;
  const anovaReachable = useAnovaReachable();
  const { run, pending, error } = useCookCommand();
  const [target, setTarget] = useState(bath.lastTarget ?? 58);
  const [minutes, setMinutes] = useState(bath.lastMinutes ?? 150);
  const [customDuration, setCustomDuration] = useState(false);
  const beforeBag = bath.phase === 'heating' || bath.phase === 'too_hot' || bath.phase === 'ready';
  const stop = beforeBag || bath.phase === 'cooking' || bath.phase === 'done' || bath.phase === 'interrupted';
  return (
    <div className='cook-bath-controls'>
      {bath.phase === 'off' && state.probe.phase === 'off' && anovaReachable && (
        <>
          <div className='cook-bath-start'>
            <span className='cook-label'>Bath target</span>
            <Stepper label='Bath target' value={target} onChange={setTarget} step={0.5} />
            <HoldButton
              kind='resume'
              label='Hold to start bath'
              icon='mdi:pot-steam-outline'
              pending={pending}
              disabled={bath.lowWater}
              onConfirm={() => void run('bath_start', { target })}
            />
          </div>
        </>
      )}
      {beforeBag && (
        <>
          <div className='cook-durations' role='group' aria-label='Time in the bath'>
            {[60, 120, 150, 180].map(value => (
              <button
                key={value}
                className={`cook-chip ${minutes === value ? 'is-selected' : ''}`}
                type='button'
                aria-pressed={minutes === value}
                onClick={() => setMinutes(value)}
              >
                {duration(value)}
              </button>
            ))}
            <button
              type='button'
              className='cook-chip'
              aria-label='Adjust bath duration'
              aria-expanded={customDuration}
              onClick={() => setCustomDuration(value => !value)}
            >
              <Icon icon='mdi:plus-minus' />
            </button>
          </div>
          {customDuration && (
            <Stepper label='Bath duration' value={minutes} onChange={setMinutes} step={15} min={15} max={1440} suffix='min' />
          )}
          <button
            type='button'
            className={`cook-button ${bath.phase === 'ready' ? 'is-act' : 'is-sky'}`}
            disabled={pending || bath.lowWater}
            onClick={() => void run('bag_in', { minutes })}
          >
            <Icon icon='mdi:bag-personal-outline' aria-hidden='true' />
            Bag in · {duration(minutes)}
          </button>
        </>
      )}
      <div className='cook-actions'>
        {(bath.phase === 'cooking' || bath.phase === 'done') && (
          <button type='button' className='cook-button' disabled={pending} onClick={() => void run('bath_extend', { minutes: 30 })}>
            <Icon icon='mdi:timer-plus-outline' aria-hidden='true' />
            +30 min
          </button>
        )}
        {bath.phase === 'done' && (
          <button type='button' className='cook-button is-sky' disabled={pending} onClick={() => void run('chill', {})}>
            <Icon icon='mdi:snowflake' aria-hidden='true' />
            Ice water
          </button>
        )}
        {(bath.phase === 'chilling' || bath.phase === 'chilled' || bath.phase === 'interrupted') && (
          <button type='button' className='cook-button' disabled={pending} onClick={() => void run('bath_clear', {})}>
            <Icon icon='mdi:check' aria-hidden='true' />
            Done
          </button>
        )}
        {bath.lowWater && (
          <button type='button' className='cook-button is-alarm' disabled={pending} onClick={() => void run('silence', {})}>
            <Icon icon='mdi:volume-off' aria-hidden='true' />
            Silence
          </button>
        )}
      </div>
      {stop && (
        <HoldButton
          kind='wide-stop'
          label='Hold to stop bath'
          pending={pending}
          pendingLabel='Sending…'
          onConfirm={() => void run('bath_stop', {})}
        />
      )}
      {error && (
        <p className='cook-error' role='alert'>
          {error}
        </p>
      )}
    </div>
  );
}
