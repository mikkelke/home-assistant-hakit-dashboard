import { useEffect, useRef, useState } from 'react';
import { NO_TAKEOVER, armFromLink, returnDueAtMs, stepTakeover, type TakeoverAction } from '../../coffee/takeover';
import { useCoffeeState } from '../../coffee/useCoffeeState';

interface TakeoverOptions {
  /** Only the wine-fridge tablet takes over. */
  enabled: boolean;
  onStage: boolean;
  /** The brew a `#coffee&takeover=` link arrived for, with when it arrived; each arrival arms once. */
  link: { brewId: string; atMs: number } | null;
  open: () => void;
  goBack: (to: Exclude<TakeoverAction, 'none' | 'open'>) => void;
}

/** Runs the takeover rules (see coffee/takeover.ts) against the live brew and the tablet's last touch. */
export function useCoffeeTakeover({ enabled, onStage, link, open, goBack }: TakeoverOptions) {
  const state = useCoffeeState();
  const memo = useRef(NO_TAKEOVER);
  const lastPointer = useRef(0);
  const actions = useRef({ open, goBack });
  const [wake, setWake] = useState(0);
  useEffect(() => {
    actions.current = { open, goBack };
  }, [open, goBack]);

  useEffect(() => {
    if (!enabled) return;
    const touched = () => {
      lastPointer.current = Date.now();
    };
    window.addEventListener('pointerdown', touched, { capture: true, passive: true });
    return () => window.removeEventListener('pointerdown', touched, { capture: true });
  }, [enabled]);

  const linkAt = link?.atMs ?? null;
  const linkBrew = link?.brewId ?? null;
  useEffect(() => {
    if (enabled && linkBrew && linkAt != null) memo.current = armFromLink(memo.current, linkBrew, linkAt);
  }, [enabled, linkBrew, linkAt]);

  const brewId = state?.brewId ?? null;
  const source = state?.source ?? null;
  const phase = state?.phase ?? null;
  const pickedUpAtMs = state?.pickedUpAtMs ?? null;
  const stoppedAtMs = state?.stoppedAtMs ?? null;
  useEffect(() => {
    if (!enabled) return;
    const step = stepTakeover(memo.current, {
      brewId,
      source,
      phase,
      pickedUpAtMs,
      stoppedAtMs,
      onStage,
      lastPointerMs: lastPointer.current,
      nowMs: Date.now(),
    });
    memo.current = step.memo;
    if (step.action === 'open') actions.current.open();
    else if (step.action !== 'none') actions.current.goBack(step.action);
    const due = returnDueAtMs(memo.current);
    if (due == null) return;
    const timer = setTimeout(() => setWake(count => count + 1), Math.max(0, due - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [enabled, brewId, source, phase, pickedUpAtMs, stoppedAtMs, onStage, wake]);
}
