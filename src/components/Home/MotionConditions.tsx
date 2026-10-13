import { useEffect, useState } from 'react';
import { useHass } from '@hakit/core';
import { HOUSEHOLD, isNightHour } from '../../home/household';
import { setMotionConditions, type MotionScope } from '../../home/motionBudget';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useNowMs } from '../../hooks/useNowMs';

function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return hidden;
}

/** Whether a modal has locked the page (`body.modal-open`, set by the modal hooks). */
function useBodyModalOpen(): boolean {
  const [open, setOpen] = useState(() => document.body.classList.contains('modal-open'));
  useEffect(() => {
    const observer = new MutationObserver(() => setOpen(document.body.classList.contains('modal-open')));
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return open;
}

/** Feeds the motion budget what the screen shows: the scope on top (none while a sheet, a modal or
 * Energy covers it), night, reduced motion and a hidden page. Renders nothing. */
export function MotionConditions({ scope }: { scope: MotionScope | null }) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const hidden = useDocumentHidden();
  const modalOpen = useBodyModalOpen();
  const anyoneAsleep = useHass(s => HOUSEHOLD.some(member => s.entities[member.sleepModeEntityId]?.state === 'on'));
  const nowMs = useNowMs();
  const night = anyoneAsleep || isNightHour(nowMs);
  const shownScope = modalOpen ? null : scope;
  useEffect(() => {
    setMotionConditions({ reducedMotion, hidden, night, scope: shownScope });
  }, [reducedMotion, hidden, night, shownScope]);
  return null;
}
