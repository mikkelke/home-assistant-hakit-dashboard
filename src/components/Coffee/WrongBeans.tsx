import { useState, type CSSProperties } from 'react';
import { Icon } from '@iconify/react';
import { sendCoffeeCommand } from '../../coffee/command';
import type { BrewRecord, CoffeeBeans } from '../../coffee/model';
import { retagChoices } from '../../coffee/view';

/** The way back from a brew made with the wrong beans, while two or more bags are open and the brew is a day old at most:
 * the beans it is booked under, and a tap offers the other bags in the colours of the bean picker. */
export function WrongBeans({
  brew,
  beans,
  nowMs,
  big = false,
  label,
}: {
  brew: Pick<BrewRecord, 'id' | 'atMs' | 'beanName'> | null;
  beans: Pick<CoffeeBeans, 'bags'> | null;
  nowMs: number;
  big?: boolean;
  /** Names the brew the chip is about, where no other part of the screen does. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const choices = brew ? retagChoices(beans, brew, nowMs) : [];
  if (!brew || choices.length === 0) return null;
  const retag = (beanId: string) => {
    void sendCoffeeCommand('beans_retag', { brew_id: brew.id, bean_id: beanId }).catch(() => {});
    setOpen(false);
  };
  return (
    <div className={`coffee-wrong ${big ? 'is-big' : ''}`}>
      {label && <span className='coffee-lab coffee-wrong-lab'>{label}</span>}
      <button
        type='button'
        className={`coffee-chip coffee-wrong-chip ${big ? 'is-big' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <Icon icon='mdi:swap-horizontal' aria-hidden='true' />
        {brew.beanName ? `${brew.beanName} · Wrong beans?` : 'Wrong beans?'}
      </button>
      {open && (
        <div className='coffee-wrong-pick' role='group' aria-label='Brewed with'>
          {choices.map(({ bag, color }) => (
            <button
              key={bag.beanId}
              type='button'
              className='coffee-wrong-opt'
              style={{ '--bean': color } as CSSProperties}
              onClick={() => retag(bag.beanId)}
            >
              {bag.beanName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
