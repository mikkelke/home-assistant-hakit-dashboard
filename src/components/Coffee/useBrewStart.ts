import { useState } from 'react';
import { adjusted, cupAdjustSent, cupAdjustUnsent, useCupAdjust } from '../../coffee/adjust';
import { sendCoffeeCommand } from '../../coffee/command';
import type { CoffeeAdvice, CoffeeState, Recipe } from '../../coffee/model';
import { useWaterGuard } from './useWaterGuard';

/** The brew pending since a hold, until the coffee app answers or 50 s pass. */
const START_WAIT_MS = 50_000;

/** What starts the next cup: the selected recipe as the held adjustment makes it, the queued trial, the water check and
 * the start itself. Each screen that offers a start calls it once, so the card and the stage start a cup alike. */
export function useBrewStart(state: CoffeeState, usual: Recipe | null, advice: CoffeeAdvice | null, nowMs: number) {
  const adjust = useCupAdjust(usual);
  const cup = usual && adjust ? adjusted(usual, adjust) : usual;
  const water = useWaterGuard(state, cup);
  const trial = advice?.status === 'trial_queued' ? advice : null;
  const [base, setBase] = useState(false);
  const [sent, setSent] = useState<{ atMs: number; phase: string } | null>(null);
  const pending = state.phase === 'starting' || (sent != null && sent.phase === state.phase && nowMs - sent.atMs < START_WAIT_MS);
  const label = adjust
    ? 'Hold 1 s · adjusted'
    : trial
      ? base
        ? `Hold 1 s · grind ${trial.from ?? usual?.grind ?? ''}`
        : 'Hold 1 s · trial'
      : 'Hold 1 s to brew';
  const begin = () => {
    setSent({ atMs: Date.now(), phase: state.phase });
    if (adjust) cupAdjustSent(state.brewId);
    void sendCoffeeCommand('start', adjust ? { variant: 'tweak', ...adjust } : { variant: trial && base ? 'base' : 'usual' }).catch(() => {
      setSent(null);
      if (adjust) cupAdjustUnsent();
    });
  };
  return { state, usual, cup, adjust, trial, base, setBase, water, pending, label, begin };
}

export type BrewStart = ReturnType<typeof useBrewStart>;
