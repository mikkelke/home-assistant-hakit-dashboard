import type { ReactNode } from 'react';
import { DiscardSuggestion } from './DiscardSuggestion';

interface SuggestionCardProps {
  /** What kind of suggestion it is, and what it is about. */
  tag?: string;
  title?: ReactNode;
  reason: string;
  detail?: ReactNode;
  warn?: string;
  onAccept: () => void;
  onDiscard: () => void;
  /** Given only for a suggestion that has a place on the plan. */
  onShow?: () => void;
  /** Whatever belongs under the buttons. */
  children?: ReactNode;
}

/** One suggestion: why it is made, and what to do with it. Discarding asks first. */
export function SuggestionCard({ tag, title, reason, detail, warn, onAccept, onDiscard, onShow, children }: SuggestionCardProps) {
  return (
    <div className='sm-suggest sm-suggest-card'>
      {(tag || title) && (
        <p className='sm-suggest-head'>
          {tag && <span className='sm-tag'>{tag}</span>}
          {title}
        </p>
      )}
      <p>{reason}</p>
      {detail && <p className='sm-muted'>{detail}</p>}
      {warn && <p className='sm-warn'>{warn}</p>}
      <div className='sm-row wrap'>
        <button type='button' className='sm-chip on' onClick={onAccept}>
          Accept
        </button>
        {onShow && (
          <button type='button' className='sm-chip' onClick={onShow}>
            Show on map
          </button>
        )}
        <DiscardSuggestion onDiscard={onDiscard} />
      </div>
      {children}
    </div>
  );
}
