import { Fragment } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities } from '../../types';
import { HEAT_RELAY_POWER_SENSOR } from '../../utils/heatEnergy';
import {
  BUILDING_RETURN_TEMP_SENSOR,
  BUILDING_SUPPLY_TEMP_SENSOR,
  HEATING_RETURN_TEMP_SENSOR,
  HEATING_SUPPLY_TEMP_SENSOR,
  heatNum,
} from '../../utils/heating';
import { ApplianceSheet } from '../Appliance';
import { Glyph } from './ZoneGlyph';
import { loopRows } from './zoneMeta';
import './HeatPlant.css';

/** The four pipe probes in the order the water passes them: building supply, floor supply, floor return, building return. */
const PROBES = [
  { entity: BUILDING_SUPPLY_TEMP_SENSOR, icon: 'mdi:home-import-outline', label: 'Building supply' },
  { entity: HEATING_SUPPLY_TEMP_SENSOR, icon: 'mdi:thermometer-chevron-up', label: 'Floor supply' },
  { entity: HEATING_RETURN_TEMP_SENSOR, icon: 'mdi:thermometer-chevron-down', label: 'Floor return' },
  { entity: BUILDING_RETURN_TEMP_SENSOR, icon: 'mdi:home-export-outline', label: 'Building return' },
] as const;

const oneDecimal = (value: number) => value.toFixed(1);
const reading = (tempC: number | null) => (tempC == null ? 'unavailable' : `${oneDecimal(tempC)} °C`);
const wattsText = (watts: number) => (watts < 10 ? watts.toFixed(1) : watts.toFixed(0));
const difference = (from: number | null, to: number | null) => (from == null || to == null ? null : from - to);

function readProbes(entities: HassEntities) {
  return PROBES.map(probe => ({ ...probe, present: entities[probe.entity] !== undefined, tempC: heatNum(entities[probe.entity]?.state) }));
}

/** Whether any loop's zone calls for heat now, which is when the pump moves water. */
const waterFlows = (entities: HassEntities) => loopRows(entities).some(row => row.calling);

/** The plant in one line, opening the plant view: the four probes along the flow and whether water moves.
 * Hidden when the flat has none of the probes. */
export function PlantStrip({ entities, onOpen }: { entities: HassEntities; onOpen: () => void }) {
  const probes = readProbes(entities);
  if (!probes.some(probe => probe.present)) return null;
  const flowing = waterFlows(entities);
  const label = `Plant: ${probes.map(probe => `${probe.label.toLowerCase()} ${reading(probe.tempC)}`).join(', ')}, ${flowing ? 'water flowing' : 'idle'}`;

  return (
    <button type='button' className='heat-card heat-plant-strip' onClick={onOpen} aria-label={label}>
      {probes.map((probe, index) => (
        <Fragment key={probe.entity}>
          {index > 0 && (
            <Icon className='heat-plant-sep' icon={index === 2 ? 'mdi:dots-horizontal' : 'mdi:chevron-right'} aria-hidden='true' />
          )}
          <span className={`heat-plant-probe${probe.tempC == null ? ' is-unavailable' : ''}`} aria-hidden='true'>
            <Icon icon={probe.icon} />
            {probe.tempC == null ? '—' : oneDecimal(probe.tempC)}
          </span>
        </Fragment>
      ))}
      <Icon
        className={`heat-plant-flow${flowing ? ' is-flowing' : ''}`}
        icon={flowing ? 'mdi:waves-arrow-right' : 'mdi:pause'}
        aria-hidden='true'
      />
      <Icon className='heat-plant-more' icon='mdi:chevron-right' aria-hidden='true' />
    </button>
  );
}

function Node({
  label,
  short,
  icon,
  tempC,
  tone,
}: {
  label: string;
  short: string;
  icon: string;
  tempC: number | null;
  tone: 'supply' | 'return';
}) {
  return (
    <div className={`heat-plant-node is-${tone}`} role='img' aria-label={`${label} ${reading(tempC)}`}>
      <span className='heat-plant-node-name'>
        <Icon icon={icon} aria-hidden='true' />
        {short}
      </span>
      <b>{tempC == null ? '—' : oneDecimal(tempC)}</b>
    </div>
  );
}

function Delta({ icon, label, value }: { icon: string; label: string; value: number | null }) {
  if (value == null) return null;
  return (
    <span className='heat-plant-chip' role='img' aria-label={`${label} ${oneDecimal(value)} °C`}>
      <Icon icon={icon} aria-hidden='true' />Δ {oneDecimal(value)}
    </span>
  );
}

/** The plant view: the supply and return pairs of the building and of the floor circuit with the drop across each,
 * and one table row per floor loop. A loop's power shows only while its zone calls, since an idle loop's return just
 * reads the manifold. */
export function PlantSheet({ entities, onClose }: { entities: HassEntities; onClose: () => void }) {
  const [buildingSupply, floorSupply, floorReturn, buildingReturn] = readProbes(entities).map(probe => probe.tempC);
  const relayW = heatNum(entities[HEAT_RELAY_POWER_SENSOR]?.state);
  const flowing = waterFlows(entities);
  const loops = loopRows(entities);

  return (
    <ApplianceSheet
      accentClassName='climate-sheet heat-plant-sheet'
      glyphIcon='mdi:pipe'
      title='Plant'
      historyKey='heating-plant'
      onClose={onClose}
    >
      <div className='climate-scroll' tabIndex={0} role='region' aria-label='Plant details'>
        <section className='heat-plant-chain' aria-label='Supply and return'>
          <Node label='Building supply' short='Building' icon='mdi:home-import-outline' tempC={buildingSupply} tone='supply' />
          <Icon className='heat-plant-link' icon='mdi:valve' aria-hidden='true' />
          <Node label='Floor supply' short='Floor' icon='mdi:thermometer-chevron-up' tempC={floorSupply} tone='supply' />
          <Node label='Building return' short='Building' icon='mdi:home-export-outline' tempC={buildingReturn} tone='return' />
          <Icon className='heat-plant-link' icon='mdi:arrow-left' aria-hidden='true' />
          <Node label='Floor return' short='Floor' icon='mdi:thermometer-chevron-down' tempC={floorReturn} tone='return' />
          <div className='heat-plant-deltas'>
            <Delta icon='mdi:home-outline' label='Building supply to return' value={difference(buildingSupply, buildingReturn)} />
            <Delta icon='mdi:valve' label='Building supply to floor supply' value={difference(buildingSupply, floorSupply)} />
            <Delta icon='mdi:swap-vertical' label='Floor supply to return' value={difference(floorSupply, floorReturn)} />
            {relayW != null && (
              <span
                className={`heat-plant-chip${flowing ? ' is-flowing' : ''}`}
                role='img'
                aria-label={`Pump ${wattsText(relayW)} watts, ${flowing ? 'water flowing' : 'idle'}`}
              >
                <Icon icon={flowing ? 'mdi:waves-arrow-right' : 'mdi:pause'} aria-hidden='true' />
                {wattsText(relayW)} W
              </span>
            )}
          </div>
        </section>

        <div className='heat-plant-table'>
          <table className='heat-plant-loops' aria-label='Floor loops'>
            <thead>
              <tr>
                <th scope='col'>#</th>
                <th scope='col' aria-label='Room' />
                <th scope='col'>L/min</th>
                <th scope='col'>Return</th>
                <th scope='col'>ΔT</th>
                <th scope='col'>W</th>
              </tr>
            </thead>
            <tbody>
              {loops.map(row => (
                <tr key={row.loop} className={row.calling ? 'is-calling' : 'is-idle'}>
                  <th scope='row' aria-label={`Loop ${row.loop}, ${row.name}${row.calling ? ', calling' : ''}`}>
                    {row.loop}
                  </th>
                  <td>
                    <Glyph icon={row.icon} letter={row.letter} className={`is-tiny${row.calling ? ' is-calling' : ''}`} />
                  </td>
                  <td>{oneDecimal(row.flowLpm)}</td>
                  <td>{row.returnC == null ? '—' : oneDecimal(row.returnC)}</td>
                  <td>{row.dropC == null ? '—' : oneDecimal(row.dropC)}</td>
                  <td className='heat-plant-watts'>{row.watts == null ? '—' : Math.round(row.watts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </ApplianceSheet>
  );
}
