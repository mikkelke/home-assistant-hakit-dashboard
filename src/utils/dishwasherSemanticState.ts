import type { HassEntity } from '../types';

/** Matches DishwasherCard: how `sensor.dishwasher_state` maps from HA `on`/`off` + attributes */
export type DishwasherSemanticState = 'Off' | 'Running' | 'Paused' | 'Unemptied' | 'Emptied';

/**
 * AppDaemon owns `sensor.dishwasher_state` (state + attributes). It mirrors the state string to
 * `input_select.dishwasher_state` for persistence / Lovelace. We treat the sensor as authoritative;
 * the helper is a fallback when the sensor is missing or unavailable. Progress/ETA stay on the sensor attributes.
 * If sensor and helper disagree, fix AppDaemon sync or manual helper edits — do not assume the helper wins.
 */
const CANONICAL_DISHWASHER_STATES = ['Off', 'Running', 'Paused', 'Unemptied', 'Emptied'] as const;

/** Dedupe dev console: log once per distinct mismatch until sensor and helper agree again. */
let lastDevMismatchWarnKey: string | null = null;

function isCanonicalDishwasherState(s: string | undefined): s is DishwasherSemanticState {
  return s != null && (CANONICAL_DISHWASHER_STATES as readonly string[]).includes(s);
}

/** Semantic state from AppDaemon sensor: explicit enum, or infer from `on`/`off` + attributes. */
function semanticFromSensor(sensor: HassEntity | undefined | null): DishwasherSemanticState | null {
  if (!sensor) return null;
  const s = sensor.state?.trim() ?? '';
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower === 'unknown' || lower === 'unavailable') return null;
  if (isCanonicalDishwasherState(s)) return s;
  return inferDishwasherSemanticState(sensor);
}

/**
 * Prefer `sensor.dishwasher_state` (AppDaemon). Fall back to `input_select.dishwasher_state` when the sensor
 * has no usable state. In dev, logs once per distinct disagreement (states() vs states()) until they match again.
 */
export function resolveDishwasherSemanticState(
  sensor: HassEntity | undefined | null,
  inputSelectDishwasherState: HassEntity | undefined | null
): DishwasherSemanticState {
  const fromSensor = semanticFromSensor(sensor);
  const fromHelperRaw = inputSelectDishwasherState?.state?.trim();
  const fromHelper = isCanonicalDishwasherState(fromHelperRaw) ? fromHelperRaw : null;

  if (fromSensor != null) {
    if (fromHelper != null && fromHelper === fromSensor) {
      lastDevMismatchWarnKey = null;
    } else if (import.meta.env.DEV && fromHelper != null && fromHelper !== fromSensor) {
      const key = `${fromSensor}|${fromHelper}`;
      if (key !== lastDevMismatchWarnKey) {
        lastDevMismatchWarnKey = key;
        console.warn('[Dishwasher] sensor vs input_select disagree — using sensor; fix AppDaemon sync or manual helper edits:', {
          sensor: fromSensor,
          input_select: fromHelper,
        });
      }
    }
    return fromSensor;
  }
  if (fromHelper != null) return fromHelper;
  return inferDishwasherSemanticState(sensor);
}

export function inferDishwasherSemanticState(entity: HassEntity | undefined | null): DishwasherSemanticState {
  if (!entity) return 'Off';
  const rawState = (entity.state?.trim() || 'Off').toLowerCase();
  const attrs = entity.attributes || {};
  let state = (entity.state?.trim() || 'Off') as DishwasherSemanticState;
  if (rawState === 'on') {
    const hasRunningAttrs =
      attrs.estimated_remaining_min != null ||
      attrs.programme_duration_min != null ||
      (attrs.progress_pct != null && attrs.progress_pct !== '');
    const hasUnemptiedAttrs = attrs.run_time_minutes != null || attrs.energy_used != null;
    if (hasUnemptiedAttrs) state = 'Unemptied';
    else if (hasRunningAttrs || attrs.programme_label || attrs.detected_programme) state = 'Running';
  } else if (rawState === 'off') {
    state = 'Off';
  }
  return state;
}
