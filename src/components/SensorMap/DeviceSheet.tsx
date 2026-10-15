import { useMemo } from 'react';
import { Icon } from '@iconify/react';
import { liveOf } from '../../sensorMap/live';
import { FACING_STEP_DEG, isRadar, normalizeDeg, type Facing, type MapDevice, type MapDoc, type SuggestItem } from '../../sensorMap/mapDoc';
import { decodeRange } from '../../sensorMap/radarRange';
import { NumberField } from './fields';
import { glyphOf, typeClass } from './glyphs';
import { Sheet } from './Sheet';
import type { DeviceActions } from './types';
import { statesById, useEntityStates } from './useEntityStates';

const CERT_TEXT = { confirmed: 'confirmed', room: 'room known', guess: 'guess' } as const;

interface DeviceSheetProps {
  id: string;
  device: MapDevice;
  doc: MapDoc;
  edit: boolean;
  collapsed: boolean;
  snap: boolean;
  pending: SuggestItem[];
  onToggle: () => void;
  onSnap: (on: boolean) => void;
  onClose: () => void;
  actions: DeviceActions;
}

function EntityRows({ device }: { device: MapDevice }) {
  const bound = useMemo(() => Object.entries(device.ha.bindings), [device.ha.bindings]);
  const ids = useMemo(() => bound.map(([, entity]) => entity), [bound]);
  const states = useEntityStates(ids);
  const byId = statesById(ids, states);
  const live = liveOf(device.ha.bindings, byId);
  if (bound.length === 0) return <p className='sm-muted'>No Home Assistant entities are bound to this device.</p>;
  return (
    <dl className='sm-entities'>
      {bound.map(([role, entity]) => {
        const state = byId[entity];
        const unit = typeof state?.attributes?.unit_of_measurement === 'string' ? ` ${state.attributes.unit_of_measurement}` : '';
        const range = role === 'range' ? decodeRange(state?.state, state?.attributes?.unit_of_measurement as string | undefined) : null;
        return (
          <div key={role} className='sm-entity-row'>
            <dt>{role.replace('_', ' ')}</dt>
            <dd>
              <span className={`sm-state${state?.state === 'on' ? ' on' : ''}`}>
                {range ? `${range.r0} to ${range.r1} m` : state ? `${state.state}${unit}` : 'not found'}
              </span>
              <code>{entity}</code>
            </dd>
          </div>
        );
      })}
      {live.unavailable && <p className='sm-muted'>Every bound entity is unavailable.</p>}
    </dl>
  );
}

function describeFacing(facing: Facing, fov: number | null): string {
  if (facing.state === 'known') return `${facing.deg} degrees${fov ? `, ${fov} degree field` : ''} (0 is +x, counterclockwise)`;
  if (facing.state === 'omni') return 'all round (owner stated)';
  return 'not known';
}

export function DeviceSheet({ id, device, doc, edit, collapsed, snap, pending, onToggle, onSnap, onClose, actions }: DeviceSheetProps) {
  const { placement } = device;
  const pos = placement.pos;
  const radar = isRadar(device);
  const zone = doc.plan.zones.find(candidate => candidate.zone_id === device.zone_id);
  const canUndo = device.history.length > 0;
  const known = placement.facing.state === 'known' ? placement.facing.deg : 0;
  const questionIds = [...doc.questions.filter(question => question.refs.includes(id)).map(question => question.id), ...device.measure_ids];
  const typeLabel = doc.types.find(type => type.key === device.type)?.label ?? device.type;
  const setFacing = (facing: Facing) => actions.facing(id, facing);

  return (
    <Sheet
      title={
        <>
          <svg className={`sm-chip-glyph ${typeClass(device.type)}`} viewBox='0 0 24 24' aria-hidden='true'>
            <path d={glyphOf(device.type)} />
          </svg>
          {device.name}
        </>
      }
      subtitle={
        <>
          <span className={`sm-tag ${placement.cert}`}>{CERT_TEXT[placement.cert]}</span>
          {pos ? ` x ${pos.x.toFixed(2)}  y ${pos.y.toFixed(2)}` : ' not on the plan'}
        </>
      }
      collapsed={collapsed}
      onToggle={onToggle}
      onClose={onClose}
    >
      <p className='sm-muted'>
        {typeLabel}. {device.model}
        {zone ? `. ${zone.name}` : ''}
      </p>

      {pos && (
        <div className='sm-block'>
          <div className='sm-row'>
            <NumberField
              label='x'
              unit='m'
              value={pos.x}
              disabled={!edit}
              onCommit={value => value !== null && actions.move(id, value, pos.y)}
            />
            <NumberField
              label='y'
              unit='m'
              value={pos.y}
              disabled={!edit}
              onCommit={value => value !== null && actions.move(id, pos.x, value)}
            />
            <NumberField
              label='height'
              unit='cm'
              value={pos.h === null ? null : Math.round(pos.h * 100)}
              disabled={!edit}
              onCommit={value => actions.height(id, value === null ? null : value / 100)}
            />
          </div>
          {edit && (
            <div className='sm-row wrap'>
              <button type='button' className='sm-chip small' onClick={() => actions.height(id, 0.03)}>
                Floor
              </button>
              <button type='button' className='sm-chip small' onClick={() => actions.height(id, 1.5)}>
                150
              </button>
              <button type='button' className='sm-chip small' onClick={() => actions.height(id, 2.2)}>
                220
              </button>
              <button
                type='button'
                className='sm-chip small'
                disabled={!zone || zone.ceiling_m === null}
                onClick={() => zone?.ceiling_m != null && actions.height(id, zone.ceiling_m)}
              >
                Ceiling
              </button>
              <label className='sm-check'>
                <input type='checkbox' checked={snap} onChange={event => onSnap(event.target.checked)} />
                Snap to walls
              </label>
            </div>
          )}
          {!edit && pos.h === null && <p className='sm-muted'>Height not known.</p>}
        </div>
      )}

      {radar && pos && (
        <div className='sm-block'>
          <div className='sm-row'>
            <label className='sm-field'>
              <span className='sm-field-label'>facing</span>
              <select
                className='sm-input'
                value={placement.facing.state}
                disabled={!edit}
                onChange={event => {
                  const state = event.target.value;
                  setFacing(
                    state === 'known' ? { state: 'known', deg: known } : state === 'omni' ? { state: 'omni' } : { state: 'unknown' }
                  );
                }}
              >
                <option value='known'>known</option>
                <option value='unknown'>unknown</option>
                <option value='omni'>all round</option>
              </select>
            </label>
            {placement.facing.state === 'known' && (
              <>
                <NumberField
                  label='deg'
                  value={placement.facing.deg}
                  disabled={!edit}
                  onCommit={value => value !== null && setFacing({ state: 'known', deg: normalizeDeg(value) })}
                />
                {edit && (
                  <>
                    <button
                      type='button'
                      className='sm-chip small'
                      onClick={() => setFacing({ state: 'known', deg: normalizeDeg(known - FACING_STEP_DEG) })}
                    >
                      -{FACING_STEP_DEG}
                    </button>
                    <button
                      type='button'
                      className='sm-chip small'
                      onClick={() => setFacing({ state: 'known', deg: normalizeDeg(known + FACING_STEP_DEG) })}
                    >
                      +{FACING_STEP_DEG}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
          <p className='sm-muted'>
            Facing: {describeFacing(placement.facing, placement.fov_deg)}. Footprints are drawn flat; height only shortens the reach along
            the floor.
          </p>
        </div>
      )}

      {edit && (
        <div className='sm-block'>
          {placement.cert === 'confirmed' && <p className='sm-warn'>Moving this marker clears its confirmation.</p>}
          <div className='sm-row wrap'>
            <button
              type='button'
              className={`sm-chip${placement.cert === 'confirmed' ? ' on' : ''}`}
              disabled={!pos}
              onClick={() => actions.confirm(id, placement.cert !== 'confirmed')}
            >
              <Icon icon='mdi:check-decagram' /> {placement.cert === 'confirmed' ? 'Confirmed' : 'Confirm'}
            </button>
            <button type='button' className='sm-chip' disabled={!canUndo} onClick={() => actions.undo(id)}>
              <Icon icon='mdi:undo' /> Undo
            </button>
            <button type='button' className='sm-chip' disabled={!pos} onClick={() => actions.unplace(id)}>
              <Icon icon='mdi:map-marker-off' /> Unplace
            </button>
            <label className='sm-field'>
              <span className='sm-field-label'>type</span>
              <select className='sm-input' value={device.type} onChange={event => actions.setType(id, event.target.value)}>
                {doc.types.map(type => (
                  <option key={type.key} value={type.key}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {placement.confirmed_at && <p className='sm-muted'>Confirmed {placement.confirmed_at.slice(0, 16).replace('T', ' ')} UTC.</p>}
        </div>
      )}

      {pending.length > 0 && (
        <div className='sm-block'>
          {pending.map(item => (
            <div key={item.id} className='sm-suggest'>
              <span>Suggested: {item.reason}</span>
              <span className='sm-row'>
                <button type='button' className='sm-chip small on' onClick={() => actions.accept(item)}>
                  Accept
                </button>
                <button type='button' className='sm-chip small' onClick={() => actions.reject(item.id)}>
                  Reject
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <EntityRows device={device} />

      {device.basis && <p className='sm-basis'>{device.basis}</p>}
      {device.notes && <p className='sm-muted'>{device.notes}</p>}
      {questionIds.length > 0 && (
        <div className='sm-row wrap'>
          {questionIds.map(ref => (
            <button key={ref} type='button' className='sm-chip small' onClick={() => actions.openRef(ref)}>
              {ref}
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
