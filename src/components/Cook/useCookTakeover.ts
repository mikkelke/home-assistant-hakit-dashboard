import { useEffect, useRef, useState } from 'react';
import { isCookActive } from '../../cook/model';
import { NO_TAKEOVER, armFromLink, returnDueAtMs, stepTakeover, takeoverMoment, type TakeoverAction } from '../../cook/takeover';
import { useCookState } from '../../cook/useCook';

interface TakeoverOptions {
  enabled: boolean;
  onStage: boolean;
  coffeeBrewing: boolean;
  link: { cookId: string; atMs: number } | null;
  open: () => void;
  preferCoffee: () => void;
  goBack: (to: Exclude<TakeoverAction, 'none' | 'open'>) => void;
}

export function useCookTakeover({ enabled, onStage, coffeeBrewing, link, open, goBack, preferCoffee }: TakeoverOptions): boolean {
  const state = useCookState();
  const memo = useRef(NO_TAKEOVER);
  const handledLinkAt = useRef<number | null>(null);
  const [mountedAt] = useState(Date.now);
  const lastPointer = useRef(mountedAt);
  const actions = useRef({ open, goBack, preferCoffee });
  const [wake, setWake] = useState(0);
  const [takenOver, setTakenOver] = useState(false);
  useEffect(() => {
    actions.current = { open, goBack, preferCoffee };
  }, [open, goBack, preferCoffee]);

  useEffect(() => {
    if (!enabled) return;
    const touched = () => {
      lastPointer.current = Date.now();
      setWake(count => count + 1);
    };
    window.addEventListener('pointerdown', touched, { capture: true, passive: true });
    window.addEventListener('keydown', touched, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', touched, { capture: true });
      window.removeEventListener('keydown', touched, { capture: true });
    };
  }, [enabled]);

  const linkAt = link?.atMs ?? null;
  const linkCook = link?.cookId ?? null;
  useEffect(() => {
    if (!enabled || !linkCook || linkAt == null || handledLinkAt.current === linkAt) return;
    handledLinkAt.current = linkAt;
    if (coffeeBrewing) actions.current.preferCoffee();
    else memo.current = armFromLink(memo.current, linkCook, linkAt);
  }, [enabled, coffeeBrewing, linkCook, linkAt]);

  useEffect(() => {
    if (!enabled || !state) return;
    if (memo.current.active && coffeeBrewing && onStage) actions.current.preferCoffee();
    const step = stepTakeover(memo.current, {
      nextKind: takeoverMoment(state),
      active: isCookActive(state),
      coffeeBrewing,
      onStage,
      lastPointerMs: lastPointer.current,
      nowMs: Date.now(),
    });
    memo.current = step.memo;
    if (step.action === 'open') actions.current.open();
    else if (step.action !== 'none') actions.current.goBack(step.action);
    const active = step.memo.active != null;
    const publish = setTimeout(() => setTakenOver(active), 0);
    const due = returnDueAtMs(step.memo);
    const timer = due == null ? null : setTimeout(() => setWake(count => count + 1), Math.max(0, due - Date.now()) + 50);
    return () => {
      clearTimeout(publish);
      if (timer != null) clearTimeout(timer);
    };
  }, [enabled, state, coffeeBrewing, onStage, linkAt, linkCook, wake]);
  return enabled && takenOver;
}
