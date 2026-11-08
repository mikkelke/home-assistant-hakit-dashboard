import { Icon } from '@iconify/react';
import type { AnnounceToggle } from './useApplianceActions';

export interface ApplianceChipProps {
  label: string;
  /** False when the state has no editable settings right now: the chip is a muted label. */
  isInteractive: boolean;
  onClick: () => void;
  /** Marks a toggle setting as on without opening a picker. */
  tinted?: boolean;
}

/** A setting's current value as a tappable pill. */
export function ApplianceChip({ label, isInteractive, onClick, tinted = false }: ApplianceChipProps) {
  if (!isInteractive) return <span className='appliance-chip muted'>{label}</span>;
  return (
    <button type='button' className={tinted ? 'appliance-chip on' : 'appliance-chip'} onClick={onClick}>
      {label}
    </button>
  );
}

export interface ApplianceToggleChipProps {
  icon: string;
  /** Classes added to `appliance-chip` for the icon-only layout. */
  className: string;
  on: boolean;
  isInteractive: boolean;
  onClick: () => void;
  /** What the toggle switches, as the sentence "Turn on ___" names it. */
  option: string;
  /** Names the chip while it is not interactive; without it the chip is hidden from assistive tech. */
  staticLabel?: string;
}

/** An icon-only pill that switches one option on or off directly. */
export function ApplianceToggleChip({ icon, className, on, isInteractive, onClick, option, staticLabel }: ApplianceToggleChipProps) {
  const classes = `appliance-chip ${className}`;
  const tint = on ? 'on' : '';
  if (!isInteractive) {
    return (
      <span className={`${classes} muted ${tint}`} aria-label={staticLabel} aria-hidden={staticLabel === undefined ? 'true' : undefined}>
        <Icon icon={icon} aria-hidden='true' />
      </span>
    );
  }
  return (
    <button
      type='button'
      className={`${classes} ${tint}`}
      onClick={onClick}
      aria-pressed={on}
      aria-label={`Turn ${on ? 'off' : 'on'} ${option}`}
    >
      <Icon icon={icon} aria-hidden='true' />
    </button>
  );
}

const announceLabel = (on: boolean) => (on ? 'Turn off announce when finished' : 'Turn on announce when finished');

/** The announce-when-finished bell: a round button in the collapsed header, or a plain icon in the
 * expanded footer. */
export function AnnounceBell({ announce, variant }: { announce: AnnounceToggle; variant: 'quick' | 'footer' }) {
  if (variant === 'quick') {
    return (
      <button
        type='button'
        className={`appliance-quick-btn ${announce.on ? 'on' : ''}`}
        onClick={announce.toggle}
        aria-pressed={announce.on}
        aria-label={announceLabel(announce.on)}
        title='Announce when finished'
      >
        <Icon icon='mdi:bell' aria-hidden='true' />
      </button>
    );
  }
  return (
    <button
      type='button'
      className={`appliance-footer-icon-btn ${announce.on ? 'on' : ''}`}
      onClick={announce.toggle}
      aria-pressed={announce.on}
      aria-label={announceLabel(announce.on)}
    >
      <Icon icon='mdi:bell' aria-hidden='true' />
    </button>
  );
}
