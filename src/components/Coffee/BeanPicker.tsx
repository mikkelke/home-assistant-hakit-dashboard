import type { CSSProperties } from 'react';
import { Icon } from '@iconify/react';
import type { CoffeeBag } from '../../coffee/model';
import type { BrewStart } from './useBrewStart';

const accent = (color: string) => ({ '--bean': color }) as CSSProperties;

/** What is left of a bag, in the units the household counts in: cups, else grams. */
function leftOf(bag: CoffeeBag): string | null {
  if (bag.brewsLeft != null) return `≈${bag.brewsLeft} cup${bag.brewsLeft === 1 ? '' : 's'} left`;
  return bag.remainingG != null ? `≈${Math.round(bag.remainingG)} g left` : null;
}

/** Which beans the next cup is made from, asked before the hold while two or more bags are open: a card per bag, none
 * picked to begin with, and under them the recipe the pick brews, in the bag's colour. */
export function BeanPicker({ brew, size, className = '' }: { brew: BrewStart; size: 'md' | 'xl'; className?: string }) {
  const { pick } = brew;
  return (
    <div className={`coffee-picker is-${size} ${className}`}>
      <div className='coffee-picker-cards' role='radiogroup' aria-label='Beans'>
        {brew.bags.map(item => {
          const left = leftOf(item.bag);
          const on = pick?.bag.beanId === item.bag.beanId;
          return (
            <button
              key={item.bag.beanId}
              type='button'
              role='radio'
              aria-checked={on}
              className={`coffee-bean ${on ? 'is-on' : ''} ${item.bag.low ? 'is-low' : ''}`}
              style={accent(item.color)}
              disabled={brew.pending}
              onClick={() => brew.setPick(item.bag.beanId)}
            >
              <span className='coffee-bean-tx'>
                <b>{item.bag.beanName}</b>
                {left && <small>{left}</small>}
              </span>
              {on && <Icon icon='mdi:check-circle' className='coffee-bean-check' aria-hidden='true' />}
            </button>
          );
        })}
      </div>
      <div className='coffee-picker-recipe' style={pick ? accent(pick.color) : undefined} aria-live='polite'>
        {pick ? (pick.recipe?.name ?? pick.bag.beanName) : ''}
      </div>
    </div>
  );
}
