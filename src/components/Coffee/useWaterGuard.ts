import { useState } from 'react';
import { sendCoffeeCommand } from '../../coffee/command';
import type { CoffeeState, Recipe } from '../../coffee/model';
import { waterShort } from '../../coffee/view';

/** Tells the coffee app the tank is full; a failure leaves the level as it was. */
export const registerFill = () => sendCoffeeCommand('water_filled', {}).catch(() => {});

/** Holds a start back behind the "Fill the water tank" prompt while the tank cannot finish a cup of `recipe`. Every
 * handler takes the start itself, so it runs with what the screen shows when it is tapped, not when it was held. */
export function useWaterGuard(state: Pick<CoffeeState, 'tankLeftMl'> | null, recipe: Pick<Recipe, 'totalMl'> | null) {
  const short = waterShort(state, recipe);
  const [held, setHeld] = useState<{ leftMl: number; busy: boolean } | null>(null);
  // A fill from anywhere moves the level, which lets go of the hold.
  const hold = short != null && held != null && held.leftMl === short.leftMl ? held : null;
  return {
    /** What the prompt says; null while no start is held back. */
    short: hold ? short : null,
    busy: hold?.busy ?? false,
    /** Starts now, or holds the start when the tank cannot finish the cup. */
    guard(go: () => void) {
      if (short) setHeld({ leftMl: short.leftMl, busy: false });
      else go();
    },
    startAnyway(go: () => void) {
      if (!hold || hold.busy) return;
      setHeld(null);
      go();
    },
    /** Registers the fill, then starts, so the coffee app counts the cup from a full tank. */
    filled(go: () => void) {
      if (!hold || hold.busy) return;
      setHeld({ ...hold, busy: true });
      void registerFill().then(() => {
        setHeld(null);
        go();
      });
    },
  };
}
