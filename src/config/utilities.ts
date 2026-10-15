// Energy page "Utilities" tab: water and district heating from the flat's ista meters (custom
// integration `ista_dk`). Electricity lives on the other tabs.

export type UtilityKind = 'cold_water' | 'hot_water' | 'heat';

export interface UtilityMeter {
  kind: UtilityKind;
  name: string;
  icon: string;
  /** Unit of the meter's statistic; its cost statistic is in kr. */
  unit: 'm³' | 'kWh';
  /** The meter reading; its `reading_date` attribute (YYYY-MM-DD) is the newest day ista has delivered. */
  entityId: string;
  /** kr per unit; its `source` attribute is `settled` (a statement price) or `estimate`. */
  priceEntityId: string;
}

export const UTILITY_METERS: readonly UtilityMeter[] = [
  {
    kind: 'cold_water',
    name: 'Cold water',
    icon: 'mdi:water-outline',
    unit: 'm³',
    entityId: 'sensor.ista_cold_water',
    priceEntityId: 'sensor.ista_cold_water_price',
  },
  {
    kind: 'hot_water',
    name: 'Hot water',
    icon: 'mdi:water-thermometer-outline',
    unit: 'm³',
    entityId: 'sensor.ista_hot_water',
    priceEntityId: 'sensor.ista_hot_water_price',
  },
  {
    kind: 'heat',
    name: 'Heat',
    icon: 'mdi:radiator',
    unit: 'kWh',
    entityId: 'sensor.ista_heat',
    priceEntityId: 'sensor.ista_heat_price',
  },
];

/** Source of the meters' external statistics, `<source>:<account>_<kind>` and `<source>:<account>_<kind>_cost`.
 * The ids are looked up at runtime so the account number stays out of this public repo. */
export const UTILITY_STATS_SOURCE = 'ista_dk';

/** ista's accounting year runs from 1 December to 30 November; the Year view follows it. */
export const UTILITY_YEAR_START_MONTH = 12;
