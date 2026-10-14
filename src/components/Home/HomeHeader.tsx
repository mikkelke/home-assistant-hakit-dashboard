import { useEffect, useRef, useState } from 'react';
import type { HassEntities } from '../../types';
import type { OpenNow } from '../../utils/navigation';
import { HouseTicker } from './HouseTicker';
import { LivingSky, SkyStrip } from './LivingSky';

/** Height of the strip plus its gap, in px: the sky counts as gone once it hides behind the strip. */
const STRIP_COVER_PX = 56;

interface HomeHeaderProps {
  entities: HassEntities;
  hassUrl: string | null;
  onMenu: () => void;
  onOpenNow: OpenNow;
}

/** The sky with the house's newest events on its ground, and the strip that takes its place at the
 * top once the grid scrolls it away. Both must sit directly in the scroll container, which the strip
 * sticks to. */
export function HomeHeader({ entities, hassUrl, onMenu, onOpenNow }: HomeHeaderProps) {
  const skyRef = useRef<HTMLElement>(null);
  const [skyGone, setSkyGone] = useState(false);
  useEffect(() => {
    const sky = skyRef.current;
    if (!sky || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setSkyGone(!entry.isIntersecting), {
      rootMargin: `-${STRIP_COVER_PX}px 0px 0px 0px`,
    });
    observer.observe(sky);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <SkyStrip entities={entities} hassUrl={hassUrl} onMenu={onMenu} className={`sky-strip--sticky ${skyGone ? 'is-shown' : ''}`} />
      <LivingSky ref={skyRef} entities={entities} hassUrl={hassUrl} onMenu={onMenu}>
        <HouseTicker onOpenNow={onOpenNow} />
      </LivingSky>
    </>
  );
}
