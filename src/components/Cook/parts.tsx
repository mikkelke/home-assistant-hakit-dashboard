import type { ReactNode } from 'react';
import { Icon } from '@iconify/react';
import { isProbeLost, type CookLive, type CookState } from '../../cook/model';
import { cookMoments, cookProgress, type CookMoment } from '../../cook/moments';
import { formatHomeClock } from '../../energy/homeTime';
import { centred, cookCue, degrees, type CookTone } from './view';

export function CookChip({ icon, tone, children }: { icon?: string; tone?: CookTone; children: ReactNode }) {
  return (
    <span className={`cook-chip ${tone ? `is-${tone}` : ''}`}>
      {icon && <Icon icon={icon} aria-hidden='true' />}
      {children}
    </span>
  );
}

export function CookHero({ state, live, nowMs }: { state: CookState; live: CookLive | null; nowMs: number }) {
  const cue = cookCue(state, nowMs);
  const progress = cookProgress(state, live, nowMs);
  return (
    <div className={`cook-hero is-${cue.tone}`} aria-live='polite'>
      <span className='cook-label'>{cue.label}</span>
      <div className='cook-cue'>{cue.value}</div>
      <p>{cue.detail}</p>
      {progress != null && (
        <div className='cook-progress' aria-hidden='true'>
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

export function ProbeChips({ state }: { state: CookState }) {
  const { probe } = state;
  if (probe.phase === 'off') return null;
  return (
    <div className='cook-chips'>
      <CookChip icon='mdi:thermometer' tone='heat'>
        {degrees(probe.core)}
      </CookChip>
      <CookChip icon='mdi:stove'>Oven air {degrees(probe.ambient)}</CookChip>
      {probe.inMeat && (
        <CookChip icon='mdi:check' tone='ok'>
          in meat
        </CookChip>
      )}
      {centred(state) && (
        <CookChip icon='mdi:check' tone='ok'>
          centred
        </CookChip>
      )}
      {probe.staleSinceMs != null && <CookChip icon='mdi:bluetooth-off'>Reading stalled</CookChip>}
    </div>
  );
}

export function BathLane({ state, nowMs }: { state: CookState; nowMs: number }) {
  const { bath } = state;
  if (bath.phase === 'off' && !bath.lowWater) return null;
  const label = bath.lowWater
    ? 'Low water'
    : bath.phase === 'cooking' || bath.phase === 'done'
      ? `${bath.phase === 'done' ? 'Holding' : 'Done'} ${bath.phase === 'done' ? degrees(bath.target) : bath.doneAtMs == null ? '—' : formatHomeClock(bath.doneAtMs)}`
      : bath.phase === 'chilling'
        ? `Fridge ${bath.chillUntilMs == null ? '—' : formatHomeClock(bath.chillUntilMs)}`
        : bath.phase === 'chilled'
          ? 'Into the fridge'
          : bath.phase === 'ready'
            ? 'Bag in'
            : bath.phase === 'too_hot'
              ? 'Add cold water'
              : bath.phase === 'interrupted'
                ? `Stopped ${bath.stoppedAtMs == null ? '—' : formatHomeClock(bath.stoppedAtMs)}`
                : `Ready ${bath.readyAtMs == null ? '—' : `≈ ${formatHomeClock(bath.readyAtMs)}`}`;
  const progress =
    bath.inAtMs != null && bath.doneAtMs != null && bath.doneAtMs > bath.inAtMs
      ? Math.max(0, Math.min(1, (nowMs - bath.inAtMs) / (bath.doneAtMs - bath.inAtMs)))
      : null;
  return (
    <div className={`cook-bath-lane ${bath.lowWater || bath.phase === 'interrupted' ? 'is-alarm' : ''}`}>
      <Icon icon={bath.lowWater ? 'mdi:water-alert-outline' : 'mdi:pot-steam-outline'} aria-hidden='true' />
      <strong>{degrees(bath.temp)}</strong>
      {progress != null && (
        <div className='cook-progress' aria-hidden='true'>
          <i style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      <span>{label}</span>
    </div>
  );
}

function momentIcon(moment: CookMoment): string {
  switch (moment.kind) {
    case 'bath_ready':
      return 'mdi:fire';
    case 'bag_in':
      return 'mdi:food-steak';
    case 'bath_done':
      return 'mdi:check-circle-outline';
    case 'chill_done':
      return 'mdi:fridge-outline';
    case 'pull':
      return 'mdi:tray-arrow-up';
    case 'carve':
      return 'mdi:knife';
    case 'low_water':
      return 'mdi:water-alert-outline';
    case 'lost':
      return 'mdi:bluetooth-off';
  }
}

function CookingSteps({ state, nowMs }: { state: CookState; nowMs: number }) {
  const bathSteps = [
    ['Heating', 'mdi:fire'],
    ['Bag in', 'mdi:food-steak'],
    ['Cooking', 'mdi:timer-sand'],
    ['Done', 'mdi:check-circle-outline'],
    ['Chill', 'mdi:snowflake'],
    ['Fridge', 'mdi:fridge-outline'],
  ];
  const probeSteps = [
    ['Tracking', 'mdi:thermometer'],
    ['Pull', 'mdi:tray-arrow-up'],
    ['Resting', 'mdi:timer-sand-complete'],
    ['Carve', 'mdi:knife'],
  ];
  const bathIndex = ['heating', 'ready', 'cooking', 'done', 'chilling', 'chilled'].indexOf(
    state.bath.phase === 'too_hot' ? 'heating' : state.bath.phase === 'interrupted' ? 'cooking' : state.bath.phase
  );
  const probeIndex = ['tracking', 'pull', 'resting', 'carve'].indexOf(state.probe.phase === 'near' ? 'tracking' : state.probe.phase);
  const steps = [
    ...(state.bath.phase === 'off'
      ? []
      : bathSteps.slice(0, state.bath.phase === 'interrupted' ? 3 : bathIndex >= 4 ? 6 : 4).map(([label, icon], index) => ({
          label: state.bath.phase === 'interrupted' && index === 2 ? 'Stopped' : label,
          icon,
          status: index < bathIndex ? 'done' : index === bathIndex ? 'current' : 'upcoming',
          urgent:
            (index === 1 && state.bath.phase === 'ready') ||
            (index === 3 && state.bath.phase === 'done') ||
            (index === 5 && state.bath.phase === 'chilled'),
        }))),
    ...(state.probe.phase === 'off'
      ? []
      : probeSteps.map(([label, icon], index) => ({
          label,
          icon,
          status: index < probeIndex ? 'done' : index === probeIndex ? 'current' : 'upcoming',
          urgent: (index === 1 && state.probe.phase === 'pull') || (index === 3 && state.probe.phase === 'carve'),
        }))),
  ];
  if (state.nextKind === 'lost' || isProbeLost(state, nowMs))
    steps.unshift({ label: 'Probe lost', icon: 'mdi:bluetooth-off', status: 'alarm', urgent: true });
  if (state.bath.lowWater || state.nextKind === 'low_water')
    steps.unshift({ label: 'Low water', icon: 'mdi:water-alert-outline', status: 'alarm', urgent: true });
  return (
    <ol className='cook-steps' aria-label='Cooking steps'>
      {steps.map(step => (
        <li
          key={step.label}
          className={`${step.status === 'current' ? 'is-current' : ''} ${step.status === 'done' ? 'is-done' : ''} ${step.status === 'alarm' || step.label === 'Stopped' ? 'is-alarm' : step.urgent ? 'is-act' : ''}`}
          aria-current={step.status === 'current' || step.status === 'alarm' ? 'step' : undefined}
        >
          <Icon icon={step.icon} aria-hidden='true' />
          <span>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function MomentsRail({ state, nowMs, steps = false }: { state: CookState; nowMs: number; steps?: boolean }) {
  if (steps) return <CookingSteps state={state} nowMs={nowMs} />;
  const moments = cookMoments(state, nowMs);
  return (
    <ol className='cook-moments' aria-label='Next cooking moments'>
      {moments.map((moment, index) => (
        <li
          key={`${moment.kind}-${index}`}
          className={`${moment.status === 'current' ? 'is-current' : ''} ${moment.status === 'done' ? 'is-done' : ''} ${moment.alarm ? 'is-alarm' : moment.urgent ? 'is-act' : ''}`}
          aria-current={moment.status === 'current' ? 'step' : undefined}
        >
          <Icon icon={momentIcon(moment)} aria-hidden='true' />
          <span>{moment.label}</span>
          <b>
            {moment.label === 'Stopped' && moment.atMs != null
              ? formatHomeClock(moment.atMs)
              : moment.urgent
                ? 'Now'
                : moment.atMs == null
                  ? '—'
                  : `${moment.approximate ? '≈ ' : ''}${formatHomeClock(moment.atMs)}`}
          </b>
        </li>
      ))}
    </ol>
  );
}
