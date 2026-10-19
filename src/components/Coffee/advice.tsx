import { useState } from 'react';
import { Icon } from '@iconify/react';
import { sendCoffeeCommand } from '../../coffee/command';
import { adviceFieldWord, type BrewRecord, type CoffeeAdvice, type CoffeeBrews } from '../../coffee/model';
import { WhySheet } from './sheets';

type AdviceOp = 'trial_accept' | 'trial_undo' | 'trial_keep' | 'trial_revert' | 'advice_dismiss';

/** "sour 2 of 4": the taste the advice answers, among the rated brews of these beans. */
function tasteLine(brews: CoffeeBrews | null): string | null {
  const taste = brews?.taste;
  const rated = brews?.ratedCurrentBeans ?? (taste ? taste.sour + taste.balanced + taste.bitter : null);
  if (!taste || !rated) return null;
  const off = taste.sour >= taste.bitter ? 'sour' : 'bitter';
  return taste[off] > 0 ? `${off} ${taste[off]} of ${rated}` : null;
}

/** The advisor's one suggestion, the queued trial, or the question after it. Nothing changes the usual until someone
 * answers. */
export function AdviceCard({
  advice,
  brews,
  beanName,
  forBrewId = null,
  size = 'lg',
}: {
  advice: CoffeeAdvice;
  brews: CoffeeBrews | null;
  beanName: string | null;
  /** The brew the question after a trial belongs to. */
  forBrewId?: string | null;
  size?: 'lg' | 'sm';
}) {
  const [why, setWhy] = useState(false);
  const [answered, setAnswered] = useState<string | null>(null);
  const field = adviceFieldWord(advice.field);
  const id = advice.adviceId;
  if (!id || answered === `${id}:${advice.status}`) return null;
  const act = (op: AdviceOp) => {
    setAnswered(`${id}:${advice.status}`);
    void sendCoffeeCommand(op, { advice_id: id }).catch(() => setAnswered(null));
  };
  const rated = brews?.ratedCurrentBeans;
  const ledger: BrewRecord[] = brews?.brews ?? [];

  if (advice.status === 'suggested' && advice.to) {
    return (
      <div className={`coffee-advice is-${size}`}>
        <div className='coffee-advice-h'>
          <Icon icon='mdi:creation' aria-hidden='true' />
          <span>{[beanName, rated ? `${rated} rated` : null].filter(Boolean).join(' · ') || 'Advisor'}</span>
          <span className='coffee-advice-sp' />
          {tasteLine(brews) && <small>{tasteLine(brews)}</small>}
        </div>
        <div className='coffee-advice-tip'>
          Try {field} {advice.to} once
        </div>
        <div className='coffee-advice-acts'>
          <button type='button' className='coffee-btn is-purple is-grow' onClick={() => act('trial_accept')}>
            <Icon icon='mdi:check' aria-hidden='true' />
            Try once
          </button>
          <button type='button' className='coffee-btn is-ghost' onClick={() => setWhy(true)}>
            <Icon icon='mdi:chat-outline' aria-hidden='true' />
            Why
          </button>
          <button type='button' className='coffee-btn is-ghost is-icon' onClick={() => act('advice_dismiss')} aria-label='Not now'>
            <Icon icon='mdi:close' />
          </button>
        </div>
        {why && <WhySheet advice={advice} brews={ledger} beanName={beanName} onClose={() => setWhy(false)} />}
      </div>
    );
  }

  if (advice.status === 'trial_queued' && advice.to) {
    return (
      <div className={`coffee-advice is-${size} is-banner`}>
        <div className='coffee-advice-body'>
          <div className='coffee-advice-h'>
            <Icon icon='mdi:creation' aria-hidden='true' />
            Trial
          </div>
          <div className='coffee-advice-tip'>
            {field.charAt(0).toUpperCase() + field.slice(1)} {advice.to} · once
          </div>
          <div className='coffee-advice-why'>instead of {advice.from ?? 'the usual'} · then you decide</div>
        </div>
        <button type='button' className='coffee-btn is-ghost' onClick={() => act('trial_undo')}>
          <Icon icon='mdi:undo' aria-hidden='true' />
          Undo
        </button>
      </div>
    );
  }

  if (advice.status === 'trial_brewed' && advice.to && (forBrewId == null || advice.trialBrewId === forBrewId)) {
    return (
      <div className={`coffee-advice is-${size} is-question`}>
        <div className='coffee-advice-q'>
          Keep {advice.to} or go back to {advice.from ?? 'the usual'}?
        </div>
        <div className='coffee-advice-acts'>
          <button type='button' className='coffee-btn is-purple is-grow' onClick={() => act('trial_keep')}>
            Keep {advice.to}
          </button>
          <button type='button' className='coffee-btn is-ghost is-grow' onClick={() => act('trial_revert')}>
            Back to {advice.from ?? 'the usual'}
          </button>
        </div>
      </div>
    );
  }

  if (advice.status === 'thinking') {
    return (
      <div className={`coffee-advice is-${size} is-quiet`}>
        <div className='coffee-advice-h'>
          <Icon icon='mdi:creation' aria-hidden='true' />
          The advisor is looking at your ratings
        </div>
      </div>
    );
  }
  return null;
}
