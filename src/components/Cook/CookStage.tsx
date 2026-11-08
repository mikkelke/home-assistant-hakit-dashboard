import { Icon } from '@iconify/react';
import { isCookActive, isProbeLost } from '../../cook/model';
import { useCookLive, useCookState } from '../../cook/useCook';
import { formatHomeClock } from '../../energy/homeTime';
import { useClock } from '../Coffee/useClock';
import { CookChart } from './CookChart';
import { BathControls, ProbeControls } from './controls';
import { Needle } from './Needle';
import { BathLane, CookChip, CookHero, MomentsRail } from './parts';
import { centred, degrees } from './view';
import '../Coffee/Coffee.css';
import './Cook.css';

export default function CookStage({ onClose }: { onClose: () => void }) {
  const state = useCookState();
  const live = useCookLive();
  const nowMs = useClock(1000);
  const probe = state?.probe;
  const active = state != null && isCookActive(state);
  return (
    <section className='cook-stage' aria-label='Cooking screen'>
      <header className='cook-stage-header'>
        <button type='button' className='cook-back' onClick={onClose} aria-label='Back to the Kitchen'>
          <Icon icon='mdi:chevron-left' aria-hidden='true' />
          <span>Kitchen</span>
        </button>
        <div className='cook-stage-title'>
          <b>Cook</b>
          <span>{probe?.phase !== 'off' && probe?.preset ? probe.preset : 'Sous vide'}</span>
        </div>
        {state && active && <MomentsRail state={state} nowMs={nowMs} steps />}
        <time>{formatHomeClock(nowMs)}</time>
      </header>
      {!state ? (
        <div className='cook-stage-empty' role='status'>
          <Icon icon='mdi:connection' />
          <h1>Cooking state unavailable</h1>
          <p>Waiting for the cooking assistant</p>
        </div>
      ) : (
        <>
          <div className='cook-stage-body'>
            <div className='cook-chart-card'>
              <div className='cook-chips'>
                {probe && probe.phase !== 'off' && (
                  <>
                    <CookChip icon='mdi:thermometer' tone='heat'>
                      Core {degrees(probe.core)}
                    </CookChip>
                    <CookChip icon='mdi:flag-outline' tone='act'>
                      Pull {degrees(probe.pull)}
                    </CookChip>
                    <CookChip icon='mdi:silverware-fork-knife' tone='ok'>
                      Serve {degrees(probe.serve)}
                    </CookChip>
                  </>
                )}
                {state.bath.phase !== 'off' && (
                  <CookChip icon='mdi:pot-steam-outline' tone='sky'>
                    Bath {degrees(state.bath.temp)}
                  </CookChip>
                )}
              </div>
              <CookChart state={state} live={live} nowMs={nowMs} />
              <MomentsRail state={state} nowMs={nowMs} />
            </div>
            <aside className='cook-stage-side'>
              <CookHero state={state} live={live} nowMs={nowMs} />
              {probe && probe.phase !== 'off' && (
                <>
                  <div className='cook-pair'>
                    <div className='cook-tile'>
                      <span className='cook-label'>{probe.phase === 'resting' || probe.phase === 'carve' ? 'Out at' : 'Core'}</span>
                      <strong className='cook-heat'>
                        {degrees(probe.phase === 'resting' || probe.phase === 'carve' ? probe.pulledCore : probe.core)}
                      </strong>
                    </div>
                    <div className='cook-tile'>
                      <span className='cook-label'>{probe.phase === 'resting' || probe.phase === 'carve' ? 'Peak' : 'Oven air'}</span>
                      <strong>{degrees(probe.phase === 'resting' || probe.phase === 'carve' ? probe.peak : probe.ambient)}</strong>
                    </div>
                  </div>
                  <div className='cook-tile'>
                    <div className='cook-needle-heading'>
                      <span className='cook-label'>Needle</span>
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
                    </div>
                    <Needle state={state} />
                    {probe.staleSinceMs != null && (
                      <p className={isProbeLost(state, nowMs) ? 'cook-error' : 'cook-hint'}>
                        No reading since {formatHomeClock(probe.staleSinceMs)}
                      </p>
                    )}
                  </div>
                  <ProbeControls state={state} />
                </>
              )}
              <BathControls key={`${state.bath.lastTarget}-${state.bath.lastMinutes}`} state={state} />
            </aside>
          </div>
          <BathLane state={state} nowMs={nowMs} />
        </>
      )}
    </section>
  );
}
