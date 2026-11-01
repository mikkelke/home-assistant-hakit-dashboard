import { useState } from 'react';
import { Icon } from '@iconify/react';
import { ADVISOR_REPLY_MAX, sendCoffeeCommand } from '../../coffee/command';
import { BEANS_TOP_UP_G } from '../../coffee/entities';
import {
  adviceFieldWord,
  formatMinSec,
  type BrewRecord,
  type CoffeeAdvice,
  type CoffeeBaseline,
  type CoffeeBeans,
  type Recipe,
} from '../../coffee/model';
import { useCoffeeRecent } from '../../coffee/useCoffee';
import { formatDayMonth, recipeLine } from '../../coffee/view';
import { formatHomeClock } from '../../energy/homeTime';
import { series } from './chart';
import { Glyph } from './Glyph';
import { Chip, CoffeeSheet, PersonFace } from './parts';
import { Spark } from './Spark';
import { TasteDot } from './taste';

function Stepper({
  label,
  value,
  unit,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  unit?: string;
  step: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const set = (next: number) => onChange(Math.min(max, Math.max(min, Math.round(next / step) * step)));
  return (
    <div className='coffee-stepper'>
      <span className='coffee-stepper-label'>{label}</span>
      <button type='button' onClick={() => set(value - step)} disabled={value <= min} aria-label={`${label} down`}>
        <Icon icon='mdi:minus' />
      </button>
      <b>
        {value}
        {unit && <small>{unit}</small>}
      </b>
      <button type='button' onClick={() => set(value + step)} disabled={value >= max} aria-label={`${label} up`}>
        <Icon icon='mdi:plus' />
      </button>
    </div>
  );
}

/** Grind and temperature of the recipe the button brews, saved into it. Temperature moves every pour by the same amount,
 * so a cooler last pour stays cooler. */
export function AdjustSheet({ recipe, onClose }: { recipe: Recipe | null; onClose: () => void }) {
  const base = { grind: recipe?.grind ?? 46, temp: Math.round(recipe?.pours[0]?.tempC ?? 93) };
  const [grind, setGrind] = useState(base.grind);
  const [temp, setTemp] = useState(base.temp);
  const changed = grind !== base.grind || temp !== base.temp;
  const save = () => {
    void sendCoffeeCommand('adjust', {
      ...(grind !== base.grind ? { grind_size: grind } : {}),
      ...(temp !== base.temp ? { temperature: temp } : {}),
    }).catch(() => {});
    onClose();
  };
  return (
    <CoffeeSheet
      icon='mdi:tune-variant'
      title='Grind & temperature'
      subtitle={recipe?.name ?? undefined}
      historyKey='coffee-adjust'
      onClose={onClose}
    >
      <div className='coffee-sheet-stack'>
        <Stepper label='Grind' value={grind} step={1} min={1} max={80} onChange={setGrind} />
        <Stepper label='Temp' value={temp} unit='°' step={1} min={80} max={96} onChange={setTemp} />
        <p className='coffee-sheet-note'>Lower grind is finer. Saved into {recipe?.name ?? 'the recipe'} for every brew from now on.</p>
        <button type='button' className='coffee-btn is-copper' disabled={!recipe || !changed} onClick={save}>
          <Icon icon='mdi:check' aria-hidden='true' />
          Save
        </button>
      </div>
    </CoffeeSheet>
  );
}

const POUR_TONES = ['sky', 'purple', 'green', 'copper', 'amber'];

export function RecipeRow({
  recipe,
  index,
  selected = false,
  onOpen,
}: {
  recipe: Recipe;
  index: number;
  selected?: boolean;
  onOpen: () => void;
}) {
  return (
    <button type='button' className={`coffee-rrow ${selected ? 'is-selected' : ''}`} aria-pressed={selected} onClick={onOpen}>
      <span className={`coffee-rrow-num is-${POUR_TONES[index % POUR_TONES.length]}`}>{recipe.pours.length || '·'}</span>
      <span className='coffee-rrow-tx'>
        <b>{recipe.name}</b>
        <small>{recipeLine(recipe)}</small>
      </span>
      {selected && <Icon icon='mdi:check' className='coffee-rrow-chev' aria-hidden='true' />}
    </button>
  );
}

/** Every recipe in the library. Picking one makes it the recipe the big button brews. */
export function RecipesSheet({ recipes, usualId, onClose }: { recipes: Recipe[]; usualId: string | null; onClose: () => void }) {
  const pick = (recipe: Recipe) => {
    if (recipe.id !== usualId) void sendCoffeeCommand('select', { recipe_id: recipe.id }).catch(() => {});
    onClose();
  };
  return (
    <CoffeeSheet icon='mdi:book-open-variant' title='Recipes' historyKey='coffee-recipes' onClose={onClose}>
      {recipes.length === 0 ? (
        <p className='coffee-sheet-note'>No recipes in Home Assistant's xBloom library.</p>
      ) : (
        <div className='coffee-sheet-list'>
          {recipes.map((recipe, index) => (
            <RecipeRow key={recipe.id} recipe={recipe} index={index} selected={recipe.id === usualId} onOpen={() => pick(recipe)} />
          ))}
        </div>
      )}
    </CoffeeSheet>
  );
}

const TOP_UPS = [100, BEANS_TOP_UP_G, 500, 1000];

/** Beans went into the container: how much, and which. The household nearly always refills with new beans, so naming
 * them is the default. Other beans switch the container; what was left counts into the new beans. */
export function BeansSheet({ beans, onClose }: { beans: CoffeeBeans | null; onClose: () => void }) {
  const [grams, setGrams] = useState(BEANS_TOP_UP_G);
  const [beanId, setBeanId] = useState<string | null>('new');
  const [newName, setNewName] = useState('');
  const naming = beanId === 'new';
  const name = naming ? newName.trim() : (beans?.knownBeans.find(bean => bean.id === beanId)?.name ?? beans?.beanName ?? null);
  const add = () => {
    void sendCoffeeCommand(
      'beans_add',
      naming && newName.trim()
        ? { grams, new_name: newName.trim().slice(0, 40) }
        : beanId && beanId !== 'new'
          ? { grams, bean_id: beanId }
          : { grams }
    ).catch(() => {});
    onClose();
  };
  const amount = grams >= 1000 ? `${grams / 1000} kg` : `${grams} g`;
  return (
    <CoffeeSheet icon='mdi:plus' title='Added beans' historyKey='coffee-beans' onClose={onClose}>
      <div className='coffee-sheet-stack'>
        {beans?.remainingG != null && (
          <p className='coffee-sheet-note'>
            Now ≈{Math.round(beans.remainingG)} g {beans.beanName ?? ''}
            {beans.addedAtMs != null ? `, added ${formatDayMonth(beans.addedAtMs)}` : ''}
          </p>
        )}
        <div className='coffee-seg' role='radiogroup' aria-label='How much'>
          {TOP_UPS.map(value => (
            <button
              key={value}
              type='button'
              role='radio'
              aria-checked={grams === value}
              className={grams === value ? 'is-on' : ''}
              onClick={() => setGrams(value)}
            >
              {value >= 1000 ? `${value / 1000} kg` : `${value} g`}
            </button>
          ))}
        </div>
        <div className='coffee-sheet-list' role='radiogroup' aria-label='Which beans'>
          <button type='button' role='radio' aria-checked={naming} className='coffee-pick-row' onClick={() => setBeanId('new')}>
            <span className='coffee-face coffee-face--md is-bean'>
              <Icon icon='mdi:plus' aria-hidden='true' />
            </span>
            {naming ? (
              <input
                className='coffee-input'
                autoFocus
                value={newName}
                maxLength={40}
                placeholder='Name of the new beans'
                onChange={event => setNewName(event.target.value)}
                onClick={event => event.stopPropagation()}
              />
            ) : (
              <span>New beans…</span>
            )}
          </button>
          {(beans?.knownBeans ?? []).map(bean => (
            <button
              key={bean.id}
              type='button'
              role='radio'
              aria-checked={beanId === bean.id}
              className='coffee-pick-row'
              onClick={() => setBeanId(bean.id)}
            >
              <span className='coffee-face coffee-face--md is-bean'>
                <Glyph name='bean' />
              </span>
              <span>{bean.name}</span>
              {beanId === bean.id && <Icon icon='mdi:check' className='coffee-pick-check' aria-hidden='true' />}
            </button>
          ))}
        </div>
        <button type='button' className='coffee-btn is-copper' onClick={add} disabled={naming && !newName.trim()}>
          <Icon icon='mdi:plus' aria-hidden='true' />
          Added {amount}
          {name && name !== beans?.beanName ? ` · ${name}` : ''}
        </button>
      </div>
    </CoffeeSheet>
  );
}

const CONFIDENCE: Record<string, string> = {
  low: 'Low confidence, so it suggests one trial, not a new usual.',
  medium: 'Medium confidence. Still one trial first; you decide after.',
  high: 'High confidence. Still one trial first; you decide after.',
};

/** Why the advisor suggests what it does: the brews it used, how sure it is, and room to answer in words. */
export function WhySheet({
  advice,
  brews,
  beanName,
  onClose,
}: {
  advice: CoffeeAdvice;
  brews: BrewRecord[];
  beanName: string | null;
  onClose: () => void;
}) {
  const { data: recent } = useCoffeeRecent(true, brews[0]?.id ?? null);
  const [reply, setReply] = useState('');
  const [sent, setSent] = useState(false);
  const field = adviceFieldWord(advice.field);
  const evidence = advice.brewIds.map(id => brews.find(brew => brew.id === id)).filter((brew): brew is BrewRecord => brew != null);
  const unknownBrewers = evidence.some(brew => brew.who == null);
  const id = advice.adviceId;
  const act = (op: 'trial_accept' | 'advice_dismiss') => {
    if (id) void sendCoffeeCommand(op, { advice_id: id }).catch(() => {});
    onClose();
  };
  const send = () => {
    const text = reply.trim().slice(0, ADVISOR_REPLY_MAX);
    if (!text || !id) return;
    void sendCoffeeCommand('advisor_reply', { advice_id: id, text }).catch(() => {});
    setReply('');
    setSent(true);
  };
  return (
    <CoffeeSheet
      icon='mdi:creation'
      tone='advisor'
      title={advice.to ? `Why ${field} ${advice.to}?` : 'Why'}
      subtitle={beanName ?? undefined}
      historyKey='coffee-why'
      onClose={onClose}
    >
      <div className='coffee-sheet-stack'>
        {advice.why && <p className='coffee-why-text'>{advice.why}</p>}
        {evidence.length > 0 && (
          <>
            <span className='coffee-lab'>Based on</span>
            <div className='coffee-hlist'>
              {evidence.map(brew => {
                const curve = recent?.curves[brew.id];
                return (
                  <div key={brew.id} className='coffee-hrow'>
                    <span className='coffee-hrow-w'>
                      {brew.atMs != null ? formatDayMonth(brew.atMs) : '—'}
                      <small>{brew.atMs != null ? formatHomeClock(brew.atMs) : ''}</small>
                    </span>
                    <Spark cup={curve ? series(curve.cup, curve.stepS) : null} width={56} height={22} />
                    <span className='coffee-hrow-nm'>
                      {brew.grind != null ? `Grind ${brew.grind}` : (brew.recipeName ?? 'The usual')}
                      <small>{brew.drawdownS != null ? `drawdown ${formatMinSec(brew.drawdownS)}` : ''}</small>
                    </span>
                    <TasteDot taste={brew.rating} />
                    <PersonFace person={brew.who} size='xs' />
                  </div>
                );
              })}
            </div>
          </>
        )}
        <p className='coffee-sheet-note'>
          {evidence.length} rating{evidence.length === 1 ? '' : 's'}
          {unknownBrewers ? ', partly from unknown brewers' : ''}. {CONFIDENCE[advice.confidence ?? 'low']}
        </p>
        {advice.thread.length > 0 && (
          <div className='coffee-thread'>
            {advice.thread.map((message, index) => (
              <p key={`${message.atMs}-${index}`} className={`coffee-msg is-${message.role}`}>
                {message.text}
              </p>
            ))}
          </div>
        )}
        {advice.status === 'suggested' && advice.to && (
          <div className='coffee-row'>
            <button type='button' className='coffee-btn is-purple is-grow' onClick={() => act('trial_accept')}>
              <Icon icon='mdi:check' aria-hidden='true' />
              Try {field} {advice.to} once
            </button>
            <button type='button' className='coffee-btn is-ghost' onClick={() => act('advice_dismiss')}>
              Not now
            </button>
          </div>
        )}
        <form
          className='coffee-reply'
          onSubmit={event => {
            event.preventDefault();
            send();
          }}
        >
          <Icon icon='mdi:chat-outline' aria-hidden='true' />
          <input
            className='coffee-input'
            value={reply}
            maxLength={ADVISOR_REPLY_MAX}
            placeholder={sent ? 'Sent. The advisor thinks again' : 'Tell the advisor something…'}
            onChange={event => setReply(event.target.value)}
            aria-label='Tell the advisor something'
          />
          {reply.trim() && (
            <button type='submit' className='coffee-reply-send' aria-label='Send'>
              <Icon icon='mdi:send' />
            </button>
          )}
        </form>
      </div>
    </CoffeeSheet>
  );
}

/** The baseline's spread in words: "3:23 ±8 s". */
export function SpreadChips({ baseline }: { baseline: CoffeeBaseline | null }) {
  if (!baseline || baseline.status !== 'ready') return null;
  return (
    <div className='coffee-row is-tight'>
      {baseline.totalSMedian != null && (
        <Chip icon='mdi:clock-outline' className='is-grow'>
          {formatMinSec(baseline.totalSMedian)} <span className='coffee-mute'>±{Math.round(baseline.totalSPm ?? 0)} s</span>
        </Chip>
      )}
      {baseline.cupGMedian != null && (
        <Chip icon='mdi:cup-outline' className='is-grow'>
          {Math.round(baseline.cupGMedian)} g <span className='coffee-mute'>±{Math.round(baseline.cupGPm ?? 0)}</span>
        </Chip>
      )}
      {baseline.drawdownSMedian != null && (
        <Chip className='is-grow'>
          dd {formatMinSec(baseline.drawdownSMedian)} <span className='coffee-mute'>±{Math.round(baseline.drawdownSPm ?? 0)} s</span>
        </Chip>
      )}
    </div>
  );
}
