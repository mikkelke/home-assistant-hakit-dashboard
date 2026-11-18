import { useState } from 'react';
import { adjusted, cupAdjustSent, cupAdjustUnsent, useCupAdjust } from '../../coffee/adjust';
import { sendCoffeeCommand, type CoffeeCommands } from '../../coffee/command';
import type { CoffeeAdvice, CoffeeState, Recipe } from '../../coffee/model';
import type { BagBrew } from '../../coffee/view';
import { useWaterGuard } from './useWaterGuard';

/** The brew pending since a hold, until the coffee app answers or 50 s pass. */
const START_WAIT_MS = 50_000;

/** What starts the next cup: the selected recipe as the held adjustment makes it, the queued trial, the water check and
 * the start itself. Each screen that offers a start calls it once, so the card and the stage start a cup alike. With two or
 * more open `bags` the beans are picked first: nothing is picked by default, and a start forgets the pick. Beans whose
 * recipe is not the usual brew it as it is, without the held adjustment or the queued trial. */
export function useBrewStart(state: CoffeeState, usual: Recipe | null, advice: CoffeeAdvice | null, nowMs: number, bags: BagBrew[] = []) {
  const adjust = useCupAdjust(usual);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const pick = bags.find(item => item.bag.beanId === pickedId) ?? null;
  const apart = pick != null && !pick.usual;
  const cup = usual && adjust ? adjusted(usual, adjust) : usual;
  const water = useWaterGuard(state, apart ? pick.recipe : cup);
  const trial = advice?.status === 'trial_queued' ? advice : null;
  const [base, setBase] = useState(false);
  const [sent, setSent] = useState<{ atMs: number; phase: string } | null>(null);
  const pending = state.phase === 'starting' || (sent != null && sent.phase === state.phase && nowMs - sent.atMs < START_WAIT_MS);
  const needsPick = bags.length > 0 && pick == null;
  const label = needsPick
    ? 'Pick beans first'
    : apart
      ? 'Hold 1 s to brew'
      : adjust
        ? 'Hold 1 s · adjusted'
        : trial
          ? base
            ? `Hold 1 s · grind ${trial.from ?? usual?.grind ?? ''}`
            : 'Hold 1 s · trial'
          : 'Hold 1 s to brew';
  const begin = () => {
    const tweak = apart ? null : adjust;
    const data: CoffeeCommands['start'] = apart
      ? { variant: 'usual' }
      : tweak
        ? { variant: 'tweak', ...tweak }
        : { variant: trial && base ? 'base' : 'usual' };
    setSent({ atMs: Date.now(), phase: state.phase });
    setPickedId(null);
    if (tweak) cupAdjustSent(state.brewId);
    void sendCoffeeCommand('start', pick ? { ...data, bean_id: pick.bag.beanId } : data).catch(() => {
      setSent(null);
      if (tweak) cupAdjustUnsent();
    });
  };
  return { state, usual, cup, adjust, trial, base, setBase, water, pending, label, begin, bags, pick, needsPick, setPick: setPickedId };
}

export type BrewStart = ReturnType<typeof useBrewStart>;
