import { useState } from 'react';
import { Icon } from '@iconify/react';
import { isCookActive, type CookLive, type CookState } from '../../cook/model';
import { cookProgress } from '../../cook/moments';
import { useCookLive, useCookState } from '../../cook/useCook';
import { useAnovaReachable } from '../../cook/useAnovaReachable';
import { useNowMs } from '../../hooks/useNowMs';
import { useViewer } from '../../hooks/useViewer';
import { ApplianceCard } from '../Appliance';
import { CookChart } from './CookChart';
import { BathControls, ProbeControls } from './controls';
import { Needle } from './Needle';
import { BathLane, CookHero, ProbeChips } from './parts';
import { cookCue } from './view';
import '../Coffee/Coffee.css';
import './Cook.css';

export function CookCard({ onOpenStage }: { onOpenStage?: () => void }) {
  const state = useCookState();
  const live = useCookLive();
  const nowMs = useNowMs();
  const viewer = useViewer();
  const anovaReachable = useAnovaReachable();
  if (!state || (!isCookActive(state) && !anovaReachable)) return null;
  return (
    <ActiveCookCard
      key={isCookActive(state) ? 'active' : 'idle'}
      state={state}
      live={live}
      nowMs={nowMs}
      tablet={viewer.name === 'Rooftop'}
      onOpenStage={onOpenStage}
    />
  );
}

function ActiveCookCard({
  state,
  live,
  nowMs,
  tablet,
  onOpenStage,
}: {
  state: CookState;
  live: CookLive | null;
  nowMs: number;
  tablet: boolean;
  onOpenStage?: () => void;
}) {
  const idle = !isCookActive(state);
  const [closed, setClosed] = useState(idle);
  const opener = tablet && !idle ? onOpenStage : undefined;
  const collapsed = !!opener || closed;
  const cue = cookCue(state, nowMs);
  const progress = cookProgress(state, live, nowMs);
  return (
    <div className={`cook-card ${cue.tone === 'alarm' ? 'is-alarm' : ''}`}>
      <ApplianceCard
        accentClassName={`appliance-accent-cook ${state.probe.phase === 'off' ? 'is-bath' : ''}`}
        glyphIcon={state.probe.phase === 'off' ? 'mdi:pot-steam-outline' : 'mdi:thermometer'}
        title={idle ? 'Sous vide' : 'Cook'}
        collapsed={collapsed}
        onToggleCollapsed={() => (opener ? opener() : setClosed(value => !value))}
        opensScreen={!!opener}
        stateWord={idle ? '' : `${cue.label} ${cue.value}`}
        stateWordClass={cue.tone === 'alarm' || cue.tone === 'act' ? 'alert' : 'tint'}
        showCollapsedStrip={progress != null}
        progressPct={(progress ?? 0) * 100}
      >
        <div className='cook-card-body'>
          {!idle && <CookHero state={state} live={live} nowMs={nowMs} />}
          {!idle && <CookChart state={state} live={live} nowMs={nowMs} mini />}
          <ProbeChips state={state} />
          {state.probe.phase !== 'off' && (
            <>
              <Needle state={state} />
              <ProbeControls state={state} />
            </>
          )}
          <BathLane state={state} nowMs={nowMs} />
          <BathControls key={`${state.bath.lastTarget}-${state.bath.lastMinutes}`} state={state} />
          {onOpenStage && !idle && (
            <button type='button' className='cook-open-stage' onClick={onOpenStage}>
              <Icon icon='mdi:arrow-expand' aria-hidden='true' />
              Cooking screen
            </button>
          )}
        </div>
      </ApplianceCard>
    </div>
  );
}
