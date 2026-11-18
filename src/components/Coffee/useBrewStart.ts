import { useState } from 'react';
import { adjusted, cupAdjustSent, cupAdjustUnsent, useCupAdjust } from '../../coffee/adjust';
import { sendCoffeeCommand, type CoffeeCommands } from '../../coffee/command';
import type { CoffeeAdvice, CoffeeBeans, CoffeeRecipes, CoffeeState, Recipe } from '../../coffee/model';
import { bagBrews, brewBasis, type BagBrew } from '../../coffee/view';
import { useWaterGuard } from './useWaterGuard';

/** The brew pending since a hold, until the coffee app answers or 50 s pass. */
const START_WAIT_MS = 50_000;

/** The beans to choose between before a cup, and the one picked. */
export interface BeanChoice {
  /** A bag with a recipe of its name each, once two or more have one; none otherwise. */
  bags: BagBrew[];
  pick: BagBrew | null;
  setPick: (beanId: string) => void;
}

/** One bag, or none with a recipe: nothing to choose. */
export const NO_BEAN_CHOICE: BeanChoice = { bags: [], pick: null, setPick: () => {} };

/** The beans picked for the next cup on a screen. Nothing is picked to begin with, and the pick is forgotten as soon as
 * `active` is false: when the screen is closed or left for a brew under way. */
export function useBeanChoice(
  beans: Pick<CoffeeBeans, 'bags'> | null,
  recipes: Pick<CoffeeRecipes, 'recipes' | 'usualId'> | null,
  active: boolean
): BeanChoice {
  const bags = bagBrews(beans, recipes);
  const [pickedId, setPickedId] = useState<string | null>(null);
  if (!active && pickedId != null) setPickedId(null);
  const pick = active ? (bags.find(item => item.bag.beanId === pickedId) ?? null) : null;
  return { bags, pick, setPick: setPickedId };
}

/** What starts the next cup: the selected recipe as the held adjustment makes it, the queued trial, the water check and
 * the start itself. Each screen that offers a start calls it once, so the card and the stage start a cup alike. With a
 * bean `choice` the cup is the picked bag's recipe, and nothing starts before one is picked. The usual's held adjustment
 * and queued trial belong to the usual's own beans only. */
export function useBrewStart(
  state: CoffeeState,
  usual: Recipe | null,
  advice: CoffeeAdvice | null,
  nowMs: number,
  choice: BeanChoice = NO_BEAN_CHOICE
) {
  const { bags, pick } = choice;
  const { recipe, onUsual, asking } = brewBasis(usual, bags, pick);
  const held = useCupAdjust(usual);
  const adjust = onUsual ? held : null;
  const cup = recipe && adjust ? adjusted(recipe, adjust) : recipe;
  const water = useWaterGuard(state, cup);
  const trial = onUsual && advice?.status === 'trial_queued' ? advice : null;
  const [base, setBase] = useState(false);
  const [sent, setSent] = useState<{ atMs: number; phase: string } | null>(null);
  const pending = state.phase === 'starting' || (sent != null && sent.phase === state.phase && nowMs - sent.atMs < START_WAIT_MS);
  const label = asking
    ? 'Pick beans first'
    : adjust
      ? 'Hold 1 s · adjusted'
      : trial
        ? base
          ? `Hold 1 s · grind ${trial.from ?? usual?.grind ?? ''}`
          : 'Hold 1 s · trial'
        : 'Hold 1 s to brew';
  const begin = () => {
    const data: CoffeeCommands['start'] = adjust ? { variant: 'tweak', ...adjust } : { variant: trial && base ? 'base' : 'usual' };
    setSent({ atMs: Date.now(), phase: state.phase });
    if (adjust) cupAdjustSent(state.brewId);
    void sendCoffeeCommand('start', pick ? { ...data, bean_id: pick.bag.beanId } : data).catch(() => {
      setSent(null);
      if (adjust) cupAdjustUnsent();
    });
  };
  return {
    state,
    usual,
    recipe,
    cup,
    adjust,
    trial,
    base,
    setBase,
    water,
    pending,
    label,
    begin,
    bags,
    pick,
    needsPick: asking,
    onUsual,
    setPick: choice.setPick,
  };
}

export type BrewStart = ReturnType<typeof useBrewStart>;
