import type { HouseBuilder } from './builder';
import { iso } from './time';

/** The coffee app, idle. Its entities come from the app's own preview (`?coffee_demo=idle`), so the Kitchen shows its Coffee card
 * the way it does on an ordinary day. */
export function addCoffee(h: HouseBuilder): void {
  h.query.coffee_demo = 'idle';
  h.services['shell_command.coffee_recent'] = () => ({
    stdout: JSON.stringify({ v: 1, generated_at: iso(h.now), step_s: 2, brews: [], bands: {} }),
    stderr: '',
    returncode: 0,
  });
}
