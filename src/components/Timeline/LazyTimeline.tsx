import { lazy } from 'react';
import { Icon } from '@iconify/react';
import { LazyBoundary } from '../Lazy/LazyBoundary';
import type { TimelineProps } from './Timeline';
import './Timeline.css';

const Timeline = lazy(() => import('./Timeline').then(module => ({ default: module.Timeline })));

/** The entity history timeline, loaded on first use: it only ever shows inside a modal. */
export function LazyTimeline(props: TimelineProps) {
  return (
    <LazyBoundary
      fallback={
        <div className='timeline-loading'>
          <Icon icon='mdi:loading' className='timeline-spinner' />
          <span>Loading timeline...</span>
        </div>
      }
      error={
        <div className='timeline-error'>
          <Icon icon='mdi:alert-circle' />
          <span>Could not load the timeline</span>
        </div>
      }
    >
      <Timeline {...props} />
    </LazyBoundary>
  );
}
