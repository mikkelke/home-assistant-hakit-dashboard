import { useState } from 'react';
import { Icon } from '@iconify/react';
import { ADVISOR_REPLY_MAX, sendCoffeeCommand } from '../../coffee/command';
import { BEANS_TOP_UP_G } from '../../coffee/entities';
import {
  adviceFieldWord,
  formatMinSec,
  numberOf,
  type BrewRecord,
  type CoffeeAdvice,
  type CoffeeBaseline,
  type CoffeeBeans,
  type CoffeeState,
  type Recipe,
} from '../../coffee/model';
import { useCoffeeRecent } from '../../coffee/useCoffee';
import { canStart, formatDayMonth, recipeLine } from '../../coffee/view';
import { formatHomeClock } from '../../energy/homeTime';
import { LOOK_PLAN } from './looks';
import { chartInputs, planOf, series } from './chart';
import { ChartBox } from './ChartBox';
import { Glyph } from './Glyph';
import { HoldButton } from './HoldButton';
import { Chip, CoffeeSheet, PersonFace } from './parts';
import { Spark } from './Spark';
import { TasteDot } from './taste';
import { useWaterGuard } from './useWaterGuard';
import { WaterPrompt } from './WaterTank';

const ratioNumber = (ratio: string | null) => numberOf(ratio?.split(':')[1] ?? ratio) ?? 16;
const isXPod = (recipe: Recipe | null) => recipe?.cup?.toLowerCase().replace(/[^a-z]/g, '') === 'xpod';

function Stepper({
  label,
  value,
  unit,
  step,
  min,
  max,
  locked,
  format = v => String(v),
  onChange,
}: {
  label: string;
  value: number;
  unit?: string;
  step: number;
  min: number;
  max: number;
  locked?: string | null;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const set = (next: number) => onChange(Math.min(max, Math.max(min, Math.round(next / step) * step)));
  return (
    <div className={`coffee-stepper ${locked ? 'is-locked' : ''}`}>
      <span className='coffee-stepper-label'>{label}</span>
      <button type='button' onClick={() => set(value - step)} disabled={!!locked || value <= min} aria-label={`${label} down`}>
        <Icon icon='mdi:minus' />
      </button>
      <b>
        {format(value)}
        {unit && <small>{unit}</small>}
      </b>
      <button type='button' onClick={() => set(value + step)} disabled={!!locked || value >= max} aria-label={`${label} up`}>
        <Icon icon='mdi:plus' />
      </button>
      {locked && <span className='coffee-stepper-note'>{locked}</span>}
    </div>
  );
}

/** Dose, ratio and grind changed for one brew only; the usual stays as it is. */
export function TweakSheet({ recipe, state, onClose }: { recipe: Recipe | null; state: CoffeeState; onClose: () => void }) {
  const base = { dose: recipe?.doseG ?? 15, ratio: ratioNumber(recipe?.ratio ?? null), grind: recipe?.grind ?? 46 };
  const [dose, setDose] = useState(base.dose);
  const [ratio, setRatio] = useState(base.ratio);
  const [grind, setGrind] = useState(base.grind);
  const locked = isXPod(recipe) ? 'xPod cups keep their dose' : null;
  const changed = dose !== base.dose || ratio !== base.ratio || grind !== base.grind;
  const water = useWaterGuard(state, { totalMl: Math.round(dose * ratio) });
  const start = () => {
    void sendCoffeeCommand('start', {
      variant: 'tweak',
      ...(dose !== base.dose ? { dose } : {}),
      ...(ratio !== base.ratio ? { ratio } : {}),
      ...(grind !== base.grind ? { grind_size: grind } : {}),
    }).catch(() => {});
    onClose();
  };
  return (
    <CoffeeSheet
      icon='mdi:tune-variant'
      title='Tweak once'
      subtitle={recipe?.name ?? undefined}
      historyKey='coffee-tweak'
      onClose={onClose}
    >
      <div className='coffee-sheet-stack'>
        <Stepper label='Dose' value={dose} unit='g' step={0.5} min={8} max={30} locked={locked} onChange={setDose} />
        <Stepper label='Ratio' value={ratio} step={0.5} min={10} max={20} format={v => `1:${v}`} onChange={setRatio} />
        <Stepper label='Grind' value={grind} step={1} min={1} max={80} onChange={setGrind} />
        <p className='coffee-sheet-note'>{Math.round(dose * ratio)} ml of water. The usual stays as it is.</p>
        {water.short ? (
          <WaterPrompt
            short={water.short}
            size='md'
            busy={water.busy}
            onFilled={() => water.filled(start)}
            onAnyway={() => water.startAnyway(start)}
          />
        ) : (
          <HoldButton
            kind='brew'
            label={changed ? 'Hold 1 s · tweaked' : 'Hold 1 s to brew'}
            disabled={!canStart(state)}
            onConfirm={() => water.guard(start)}
          />
        )}
      </div>
    </CoffeeSheet>
  );
}

const POUR_TONES = ['sky', 'purple', 'green', 'copper', 'amber'];

/** One recipe: its plan on the brew axis, its numbers, and starting it once or making it the usual. */
export function RecipeDetail({
  recipe,
  isUsual,
  state,
  onDone,
}: {
  recipe: Recipe;
  isUsual: boolean;
  state: CoffeeState | null;
  onDone?: () => void;
}) {
  const inputs = chartInputs({ plan: planOf(null, null, recipe), baseline: null });
  const water = useWaterGuard(state, recipe);
  const start = () => {
    void sendCoffeeCommand('start', isUsual ? { variant: 'usual' } : { variant: 'other', recipe_id: recipe.id }).catch(() => {});
    onDone?.();
  };
  return (
    <div className='coffee-recipe'>
      <ChartBox look={LOOK_PLAN} mode='plan' height={118} label={`${recipe.name}, its pours over time`} {...inputs} />
      <div className='coffee-chips'>
        {recipe.doseG != null && <Chip glyph={<Glyph name='bean' />}>{recipe.doseG} g</Chip>}
        {recipe.ratio && <Chip>{recipe.ratio}</Chip>}
        {recipe.totalMl != null && <Chip icon='mdi:water-outline'>{Math.round(recipe.totalMl)} ml</Chip>}
        {recipe.grind != null && <Chip>Grind {recipe.grind}</Chip>}
        {recipe.pours[0]?.tempC != null && <Chip icon='mdi:thermometer'>{Math.round(recipe.pours[0].tempC)}°</Chip>}
      </div>
      {state && (
        <div className='coffee-recipe-acts'>
          {water.short ? (
            <WaterPrompt
              short={water.short}
              size='md'
              busy={water.busy}
              onFilled={() => water.filled(start)}
              onAnyway={() => water.startAnyway(start)}
            />
          ) : (
            <HoldButton
              kind='brew'
              label={isUsual ? 'Hold 1 s to brew' : 'Hold 1 s · once'}
              disabled={!canStart(state)}
              onConfirm={() => water.guard(start)}
            />
          )}
          {!isUsual && (
            <button
              type='button'
              className='coffee-btn is-ghost'
              onClick={() => {
                void sendCoffeeCommand('set_usual', { recipe_id: recipe.id }).catch(() => {});
                onDone?.();
              }}
            >
              <Icon icon='mdi:check' aria-hidden='true' />
              Make usual
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function RecipeRow({ recipe, index, onOpen }: { recipe: Recipe; index: number; onOpen: () => void }) {
  return (
    <button type='button' className='coffee-rrow' onClick={onOpen}>
      <span className={`coffee-rrow-num is-${POUR_TONES[index % POUR_TONES.length]}`}>{recipe.pours.length || '·'}</span>
      <span className='coffee-rrow-tx'>
        <b>{recipe.name}</b>
        <small>{recipeLine(recipe)}</small>
      </span>
      <Icon icon='mdi:chevron-right' className='coffee-rrow-chev' aria-hidden='true' />
    </button>
  );
}

/** The other recipes, one level below the usual. */
export function RecipesSheet({
  recipes,
  usualId,
  state,
  onClose,
}: {
  recipes: Recipe[];
  usualId: string | null;
  state: CoffeeState;
  onClose: () => void;
}) {
  const others = recipes.filter(recipe => recipe.id !== usualId);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = others.find(recipe => recipe.id === openId) ?? null;
  return (
    <CoffeeSheet icon='mdi:book-open-variant' title={open ? open.name : 'Other recipe'} historyKey='coffee-recipes' onClose={onClose}>
      {open ? (
        <div className='coffee-sheet-stack'>
          <button type='button' className='coffee-btn is-ghost is-small' onClick={() => setOpenId(null)}>
            <Icon icon='mdi:chevron-left' aria-hidden='true' />
            All recipes
          </button>
          <RecipeDetail recipe={open} isUsual={false} state={state} onDone={onClose} />
        </div>
      ) : others.length === 0 ? (
        <p className='coffee-sheet-note'>Only the usual is in Home Assistant's xBloom library.</p>
      ) : (
        <div className='coffee-sheet-list'>
          {others.map((recipe, index) => (
            <RecipeRow key={recipe.id} recipe={recipe} index={index} onOpen={() => setOpenId(recipe.id)} />
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
