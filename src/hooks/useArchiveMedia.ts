import { useCallback, useEffect, useRef, useState } from 'react';
import { useHass } from '@hakit/core';
import { signArchivePath } from '../utils/haArchive';

/** A signed URL for an archive file: signed afresh on every mount, so every time a viewer opens, and only while `active`.
 * Each path gets one retry, on a media error or on a reconnect before it loaded: an HA restart, like the short signature
 * lifetime, leaves a URL dead. `src` stays undefined until a signature arrives. */
export function useSignedArchiveUrl(path: string | undefined, active = true) {
  const connection = useHass(s => s.connection);
  const [retried, setRetried] = useState<string>();
  const [signed, setSigned] = useState<{ key: string; url: string }>();
  const loaded = useRef(false);
  const key = `${retried === path ? 1 : 0}:${path ?? ''}`;

  useEffect(() => {
    loaded.current = false;
    if (!path || !active) return;
    let gone = false;
    signArchivePath(path, () => gone).then(
      url => {
        if (!gone && url) setSigned({ key, url });
      },
      () => {}
    );
    return () => {
      gone = true;
    };
  }, [key, path, active]);

  const retry = useCallback(() => setRetried(path), [path]);
  useEffect(() => {
    if (!connection) return;
    const onReady = () => {
      if (!loaded.current) retry();
    };
    connection.addEventListener('ready', onReady);
    return () => connection.removeEventListener('ready', onReady);
  }, [connection, retry]);

  const onLoad = useCallback(() => {
    loaded.current = true;
  }, []);
  return { src: signed?.key === key ? signed.url : undefined, onError: retry, onLoad };
}

const seenCallbacks = new Map<Element, () => void>();
let observer: IntersectionObserver | undefined;
let observerType: typeof IntersectionObserver | undefined;

function watchSeen(node: Element, onSeen: () => void): () => void {
  if (observerType !== IntersectionObserver) {
    observerType = IntersectionObserver;
    observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          seenCallbacks.get(entry.target)?.();
          seenCallbacks.delete(entry.target);
          observer?.unobserve(entry.target);
        }
      },
      { rootMargin: '200px' }
    );
  }
  seenCallbacks.set(node, onSeen);
  observer?.observe(node);
  return () => {
    seenCallbacks.delete(node);
    observer?.unobserve(node);
  };
}

/** A ref callback and whether its element has come near the viewport yet, which then stays true. One observer serves
 * every element, so a 2,000-tile gallery signs only what scrolls into view. */
export function useSeen<T extends Element>(): [(node: T | null) => (() => void) | undefined, boolean] {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  const ref = useCallback(
    (node: T | null) => (node && typeof IntersectionObserver !== 'undefined' ? watchSeen(node, () => setSeen(true)) : undefined),
    []
  );
  return [ref, seen];
}
