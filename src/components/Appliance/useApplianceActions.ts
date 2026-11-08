import { useEffect, useRef, useState } from 'react';
import type { CallServiceFunction, HassEntities } from '../../types';

/** A flag that reads true for `ms` after each call of the returned trigger. */
export function useTimedFlag(ms: number): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
  const trigger = () => {
    setOn(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOn(false), ms);
  };
  return [on, trigger];
}

export interface AnnounceToggle {
  /** The helper exists in Home Assistant; the bell shows only then. */
  exists: boolean;
  on: boolean;
  toggle: () => void;
}

/** The `input_boolean` that makes AppDaemon announce the finish of a run. */
export function useAnnounceToggle(
  entities: HassEntities | undefined,
  callService: CallServiceFunction | undefined,
  entityId: string
): AnnounceToggle {
  const entity = entities?.[entityId];
  const on = entity?.state === 'on';
  return {
    exists: !!entity,
    on,
    toggle: () => {
      if (!callService || !entity) return;
      callService({
        domain: 'input_boolean',
        service: on ? 'turn_off' : 'turn_on',
        target: { entity_id: entityId },
      });
    },
  };
}

export interface EmptiedAction {
  /** Pressed a moment ago. The entity flipping to Emptied hides the card; this only acknowledges the tap. */
  pressed: boolean;
  /** False without a service connection, so the buttons stay away. */
  available: boolean;
  press: () => void;
}

const PRESSED_FEEDBACK_MS = 5000;

/** The `input_button` that marks a finished run as emptied. */
export function useEmptiedAction(callService: CallServiceFunction | undefined, buttonId: string): EmptiedAction {
  const [pressed, flagPressed] = useTimedFlag(PRESSED_FEEDBACK_MS);
  return {
    pressed,
    available: !!callService,
    press: () => {
      if (!callService) return;
      flagPressed();
      callService({
        domain: 'input_button',
        service: 'press',
        target: { entity_id: buttonId },
      });
    },
  };
}
