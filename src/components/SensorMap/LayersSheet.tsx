import type { ReactNode } from 'react';
import type { TypeDef } from '../../sensorMap/mapDoc';
import { glyphOf, typeClass } from './glyphs';
import { Sheet } from './Sheet';
import { SWITCHES, hiddenTypeCount, type Layers, type Switch } from './types';

const SWITCH_LABEL: Record<Switch, string> = {
  names: 'Names',
  grid: 'Grid',
  footprints: 'Footprints',
  phones: 'Phones',
  fingerprints: 'Fingerprints',
  coverage: 'Coverage',
  suggestions: 'Suggestions',
  light: 'Light theme',
};

interface LayersSheetProps {
  layers: Layers;
  types: readonly TypeDef[];
  /** How many devices each type, or role, covers. */
  counts: Readonly<Record<string, number>>;
  /** The fingerprints held, and how many of those are weak. */
  fingerprints: number;
  weak: number;
  weakOnly: boolean;
  /** The suggestions that wait for a decision. */
  suggestions: number;
  onType: (key: string) => void;
  onAllTypes: (visible: boolean) => void;
  onSwitch: (name: Switch) => void;
  onWeakOnly: () => void;
  onClose: () => void;
}

interface RowProps {
  role: 'checkbox' | 'switch';
  checked: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}

/** A whole row is the tap target. */
function Row({ role, checked, onClick, className = '', children }: RowProps) {
  return (
    <button type='button' role={role} aria-checked={checked} className={`sm-lay-row ${className}`} onClick={onClick}>
      {children}
    </button>
  );
}

function SwitchRow({
  label,
  count,
  checked,
  nested,
  onClick,
}: {
  label: string;
  count?: number;
  checked: boolean;
  nested?: boolean;
  onClick: () => void;
}) {
  return (
    <Row role='switch' checked={checked} onClick={onClick} className={nested ? 'nested' : ''}>
      <span className='sm-lay-label'>{label}</span>
      {count !== undefined && count > 0 && <span className='sm-count'>{count}</span>}
      <span className='sm-switch' aria-hidden='true' />
    </Row>
  );
}

/** What the plan shows: each device type, and the display layers. Every row is a whole-row tap target. */
export function LayersSheet({
  layers,
  types,
  counts,
  fingerprints,
  weak,
  weakOnly,
  suggestions,
  onType,
  onAllTypes,
  onSwitch,
  onWeakOnly,
  onClose,
}: LayersSheetProps) {
  const hidden = hiddenTypeCount(layers, types);
  const counted: Partial<Record<Switch, number>> = { fingerprints, suggestions };
  return (
    <Sheet title='Layers' subtitle={hidden > 0 ? `${hidden} hidden` : undefined} onClose={onClose} className='tall'>
      <div role='group' aria-label='Display'>
        <h2 className='sm-h'>Display</h2>
        {SWITCHES.map(name => (
          <div key={name}>
            <SwitchRow label={SWITCH_LABEL[name]} count={counted[name]} checked={layers[name]} onClick={() => onSwitch(name)} />
            {name === 'fingerprints' && layers.fingerprints && weak > 0 && (
              <SwitchRow label='Weak only' count={weak} checked={weakOnly} nested onClick={onWeakOnly} />
            )}
          </div>
        ))}
      </div>
      <div role='group' aria-label='Device types'>
        <div className='sm-lay-head'>
          <h2 className='sm-h'>Device types</h2>
          <span className='sm-row'>
            <button type='button' className='sm-chip' onClick={() => onAllTypes(true)}>
              All
            </button>
            <button type='button' className='sm-chip' onClick={() => onAllTypes(false)}>
              None
            </button>
          </span>
        </div>
        {types.map(type => (
          <Row
            key={type.key}
            role='checkbox'
            checked={!layers.hiddenTypes.includes(type.key)}
            onClick={() => onType(type.key)}
            className={typeClass(type.key)}
          >
            <span className='sm-tick' aria-hidden='true' />
            <svg className='sm-chip-glyph' viewBox='0 0 24 24' aria-hidden='true'>
              <path d={glyphOf(type.key)} />
            </svg>
            <span className='sm-lay-label'>{type.label}</span>
            <span className='sm-count'>{counts[type.key] ?? 0}</span>
          </Row>
        ))}
      </div>
    </Sheet>
  );
}
