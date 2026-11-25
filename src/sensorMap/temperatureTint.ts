/** The room temperature the house aims for, °C: no tint within `NEUTRAL_C` of it, full tint `FULL_C` away. */
export const TEMP_AIM_C = 21.5;
const NEUTRAL_C = 0.3;
const FULL_C = 2.5;
const MAX_OPACITY = 0.5;

/** The seated thermometer of a zone: the reading the climate apps steer by. */
export const seatedThermometerOf = (zoneId: string) => `sensor.${zoneId}_seated_thermometer_temperature`;

/** How a temperature tints its room: cool or warm, and how strongly. */
export function temperatureTint(celsius: number): { tone: 'cool' | 'warm'; opacity: number } {
  const off = celsius - TEMP_AIM_C;
  const share = Math.min(1, Math.max(0, (Math.abs(off) - NEUTRAL_C) / (FULL_C - NEUTRAL_C)));
  return { tone: off < 0 ? 'cool' : 'warm', opacity: Number((share * MAX_OPACITY).toFixed(3)) };
}
