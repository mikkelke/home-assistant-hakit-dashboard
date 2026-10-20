import { useState, type ReactNode } from 'react';
import { useHass } from '@hakit/core';
import { Icon } from '@iconify/react';
import { sendCoffeeCommand } from '../../coffee/command';
import { personName, type CoffeeState, type PersonKey } from '../../coffee/model';
import { linkView, notifyPerson, type Tone, type VerdictView } from '../../coffee/view';
import { HOUSEHOLD } from '../../home/household';
import { ApplianceSheet } from '../Appliance';
import { Glyph } from './Glyph';

const FACE_COLOURS: Record<PersonKey, string> = { mikkel: '#5b6b7d', kristine: '#9a7a5c', claudia: '#7d8aa0' };

/** A housemate's face: their HA photo, else their initial; "?" for nobody known. */
export function PersonFace({ person, size = 'sm' }: { person: PersonKey | null; size?: 'xs' | 'sm' | 'md' }) {
  const member = HOUSEHOLD.find(item => item.key === person);
  const picture = useHass(s => (member ? s.entities[member.personEntityId]?.attributes?.entity_picture : undefined));
  const hassUrl = useHass(s => s.hassUrl);
  const url = typeof picture === 'string' ? (picture.startsWith('http') ? picture : `${hassUrl ?? ''}${picture}`) : null;
  return (
    <span
      className={`coffee-face coffee-face--${size} ${member ? '' : 'is-unknown'}`}
      style={member ? { background: FACE_COLOURS[member.key] } : undefined}
      role='img'
      aria-label={member?.name ?? 'Nobody known'}
    >
      {url ? <img src={url} alt='' /> : (member?.name.charAt(0) ?? '?')}
    </span>
  );
}

export function Chip({
  icon,
  glyph,
  tone,
  className = '',
  children,
}: {
  icon?: string;
  glyph?: ReactNode;
  tone?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`coffee-chip ${tone ? `is-${tone}` : ''} ${className}`}>
      {glyph}
      {icon && <Icon icon={icon} aria-hidden='true' />}
      {children}
    </span>
  );
}

export function VerdictPill({ verdict, className = '' }: { verdict: VerdictView | null; className?: string }) {
  if (!verdict) return null;
  return (
    <span className={`coffee-story is-${verdict.tone} ${className}`}>
      <Icon icon={verdict.icon} aria-hidden='true' />
      {verdict.text}
    </span>
  );
}

export function StoryPill({ tone, icon, children, className = '' }: { tone: Tone; icon: string; children: ReactNode; className?: string }) {
  return (
    <span className={`coffee-story is-${tone} ${className}`}>
      <Icon icon={icon} aria-hidden='true' />
      {children}
    </span>
  );
}

/** What the scale shows while the machine is awake to see it: lit once a cup is on, so a cup put on before the machine
 * woke (which it cannot see) shows as not lit. */
export function CupChip({ state, big = false }: { state: Pick<CoffeeState, 'cup' | 'machine'>; big?: boolean }) {
  if (state.machine !== 'awake' && state.machine !== 'working') return null;
  const on = state.cup === 'present';
  return (
    <span className={`coffee-chip coffee-cupchip ${on ? 'is-cof' : 'is-mute'} ${big ? 'is-big' : ''}`}>
      <Glyph name='cup' />
      {on ? 'Cup on' : state.cup === 'absent' ? 'No cup' : 'Cup'}
    </span>
  );
}

export function LinkChip({ state, big = false }: { state: Pick<CoffeeState, 'link' | 'machine'>; big?: boolean }) {
  const view = linkView(state);
  return (
    <span className={`coffee-chip coffee-link is-${view.tone} ${big ? 'is-big' : ''}`}>
      <i className='coffee-livedot' aria-hidden='true' />
      {view.text}
    </span>
  );
}

export interface LegendItem {
  kind: 'cup' | 'water' | 'plan' | 'band';
  label: string;
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <>
      {items.map(item => (
        <span key={item.label} className='coffee-leg'>
          <i className={`coffee-leg-key is-${item.kind}`} aria-hidden='true' />
          {item.label}
        </span>
      ))}
    </>
  );
}

/** The coffee sheets: the shared appliance sheet, held to the bottom on a phone, in the coffee accent. */
export function CoffeeSheet({
  icon,
  title,
  subtitle,
  historyKey,
  tone = 'coffee',
  onClose,
  children,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  historyKey: string;
  tone?: 'coffee' | 'advisor';
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <ApplianceSheet
      accentClassName={`coffee-sheet coffee-sheet--${tone} appliance-accent-coffee`}
      glyphIcon={icon}
      title={title}
      subtitle={subtitle}
      historyKey={historyKey}
      onClose={onClose}
    >
      {children}
    </ApplianceSheet>
  );
}

/** Who gets the ready push: a chip that opens the picker. Once the push went out it says so instead. */
export function NotifyChip({ state, variant = 'chip' }: { state: CoffeeState; variant?: 'head' | 'chip' | 'small' }) {
  const [open, setOpen] = useState(false);
  const person = notifyPerson(state);
  const name = personName(person);
  if (state.push === 'sent' && (state.phase === 'ready' || state.phase === 'picked_up')) {
    return (
      <span className={`coffee-who coffee-who--${variant} is-sent`}>
        <PersonFace person={person} size={variant === 'head' ? 'md' : 'sm'} />
        Push sent{name ? ` · ${name}` : ''}
      </span>
    );
  }
  const settled = state.phase === 'ready' || state.phase === 'picked_up' || state.phase === 'stopped';
  return (
    <>
      <button
        type='button'
        className={`coffee-who coffee-who--${variant} ${person ? '' : 'is-nobody'}`}
        onClick={() => setOpen(true)}
        disabled={settled}
        aria-label={name ? `Notify ${name}, change` : 'No push, pick who gets it'}
      >
        {person ? (
          <PersonFace person={person} size={variant === 'head' ? 'md' : variant === 'small' ? 'xs' : 'sm'} />
        ) : (
          <Icon icon='mdi:bell-off-outline' aria-hidden='true' />
        )}
        {name ? `Notify ${name}` : 'No push'}
        {!settled && <Icon icon='mdi:chevron-down' className='coffee-who-chev' aria-hidden='true' />}
      </button>
      {open && <NotifySheet current={person} onClose={() => setOpen(false)} />}
    </>
  );
}

export function NotifySheet({ current, onClose }: { current: PersonKey | null; onClose: () => void }) {
  const pick = (person: PersonKey | 'none') => {
    void sendCoffeeCommand('notify', { person }).catch(() => {});
    onClose();
  };
  return (
    <CoffeeSheet icon='mdi:bell-outline' title='Who gets the ready push' historyKey='coffee-notify' onClose={onClose}>
      <div className='coffee-pick'>
        {HOUSEHOLD.map(member => (
          <button key={member.key} type='button' className='coffee-pick-row' onClick={() => pick(member.key)}>
            <PersonFace person={member.key} size='md' />
            <span>{member.name}</span>
            {current === member.key && <Icon icon='mdi:check' className='coffee-pick-check' aria-label='Picked' />}
          </button>
        ))}
        <button type='button' className='coffee-pick-row' onClick={() => pick('none')}>
          <span className='coffee-face coffee-face--md is-unknown'>
            <Icon icon='mdi:bell-off-outline' aria-hidden='true' />
          </span>
          <span>Nobody</span>
          {current == null && <Icon icon='mdi:check' className='coffee-pick-check' aria-label='Picked' />}
        </button>
      </div>
    </CoffeeSheet>
  );
}
