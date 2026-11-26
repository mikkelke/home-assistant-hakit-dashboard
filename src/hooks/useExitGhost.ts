import { useLayoutEffect, type RefObject } from 'react';

const MAX_EXIT_MS = 600;

/** Copies each scrolled element's offset onto its twin in the copy, which starts at the top. */
function copyScroll(from: Element, to: Element) {
  const sources = [from, ...from.querySelectorAll('*')];
  const targets = [to, ...to.querySelectorAll('*')];
  sources.forEach((source, i) => {
    if (source.scrollTop || source.scrollLeft) {
      targets[i].scrollTop = source.scrollTop;
      targets[i].scrollLeft = source.scrollLeft;
    }
  });
}

/**
 * Lets an element leave with an animation although React removes it at once. As it unmounts, an inert copy with
 * `is-leaving` added takes its place until its exit animations, the CSS animations whose keyframes end in `-out`,
 * have finished. With no such animation for `is-leaving` the copy goes in the same frame.
 */
export function useExitGhost(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const node = ref.current;
    return () => {
      if (!node?.isConnected || typeof node.getAnimations !== 'function') return;
      const ghost = node.cloneNode(true) as HTMLElement;
      ghost.classList.add('is-leaving');
      ghost.inert = true;
      ghost.setAttribute('aria-hidden', 'true');
      ghost.querySelectorAll('video, iframe').forEach(media => media.remove());
      node.after(ghost);
      const exits = ghost
        .getAnimations({ subtree: true })
        .filter(animation => animation instanceof CSSAnimation && animation.animationName.endsWith('-out'));
      if (exits.length === 0) {
        ghost.remove();
        return;
      }
      copyScroll(node, ghost);
      const remove = () => ghost.remove();
      const fallback = window.setTimeout(remove, MAX_EXIT_MS);
      void Promise.all(exits.map(animation => animation.finished))
        .catch(() => undefined)
        .then(() => {
          window.clearTimeout(fallback);
          remove();
        });
    };
  }, [ref]);
}
