import type { RoomFeelModel } from './roomFeel';
import type { AirBand } from './airQuality';
import { airBandInfo } from './airQuality';

// Composes the Climate card's one-line story ("22.4 °C · comfortable — heating idle"), the one
// thing a person could do, and the status chips - from the backend's published pieces. The
// backend keeps the physics (comfort word, airing_helps, mould_risk, the sleep plan); this file
// only chooses which ONE clause leads and words it, so the hero and the advice never say the
// same thing twice. Pure: no Date, no entities, no side effects.

export type ChipTone = 'heat' | 'cool' | 'neutral' | 'fresh' | 'good' | 'warn' | 'alert';

export interface ClimateChip {
  id: string;
  icon: string;
  label: string;
  tone: ChipTone;
}

export interface HeatingInput {
  /** The room has a thermostat entity at all. */
  present: boolean;
  /** hvac_mode is not off/unavailable/unknown. */
  zoneOn: boolean;
  /** climate hvac_action: heating | idle | off | ... */
  action: string;
}

export interface AcInput {
  deployed: boolean;
  /** SmartCooling status says the compressor is actually engaged (cooling/burping). */
  cooling: boolean;
  armed: boolean;
  /** Next planned pre-cool start as "HH:MM", when the planner has one. */
  nextStart: string | null;
  /** sensor.sleep_plan state: windows | hybrid | ac | nothing | ... */
  rec: string;
  verdictText: string;
}

export interface ClimateStoryInput {
  feel: RoomFeelModel;
  outdoorTempC: number | null;
  heating: HeatingInput;
  /** Bedroom only; null everywhere else. */
  ac: AcInput | null;
  /** Kitchen only: the smoke alarm's fused air band and whether someone is cooking. */
  air: { band: AirBand; cooking: boolean } | null;
}

export interface ClimateStory {
  /** The full clause, shown in the climate sheet. Null means there is nothing to say. */
  clause: string | null;
  /** An explicitly authored short form of `clause` for the collapsed header's one line. Null
   * whenever `clause` is null; otherwise always set - never derived by truncating `clause`. */
  shortClause: string | null;
  /** The one thing a person could do, or null for calm silence (never "Nothing to do"). */
  advice: string | null;
  chips: ClimateChip[];
}

const WARM_WORDS = new Set(['warm', 'hot', 'muggy', 'stuffy']);
const COOL_WORDS = new Set(['cool', 'cold', 'chilly']);

function outsideText(outdoorTempC: number | null): string | null {
  if (outdoorTempC == null) return null;
  return `${Math.round(outdoorTempC)} °C outside`;
}

/** "window" / "rooftop door" / "window + rooftop door" - the backend's labels when it has them. */
export function openingLabel(feel: RoomFeelModel): string {
  return feel.openLabels.length > 0 ? feel.openLabels.join(' + ') : 'window';
}

function lowerFirst(text: string): string {
  return text.length > 0 ? text[0].toLowerCase() + text.slice(1) : text;
}

function upperFirst(text: string): string {
  return text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text;
}

export function composeClimateStory(input: ClimateStoryInput): ClimateStory {
  const { feel, outdoorTempC, heating, ac, air } = input;
  const outside = outsideText(outdoorTempC);
  const opening = openingLabel(feel);
  const word = feel.comfortWord;
  const heatingNow = heating.zoneOn && heating.action === 'heating';

  let clause: string | null = null;
  let shortClause: string | null = null;
  let advice: string | null = null;

  // Priority: current adverse conditions outrank future plans. A/C cooling right now stays on
  // top - it explains what the room is doing this instant - then a mould alert, an open opening,
  // heating actually catching up, watch-level damp, airing, kitchen air, the A/C's own plans, sun,
  // and idle heating, in that order; the backend's own detail is the last-resort fallback. Only
  // what a backend value confirms is claimed - "window open, 14 °C outside" is fine, "heating
  // waits" is not, since an open window plus an enabled zone doesn't prove the zone is waiting.
  if (ac && ac.cooling) {
    clause = 'A/C cooling';
    shortClause = 'A/C cooling';
  } else if (feel.mouldRisk === 'high') {
    clause = 'damp, air it out';
    shortClause = 'Damp, air it out';
    advice = 'Open the window after showers';
  } else if (feel.windowOpen) {
    shortClause = `${upperFirst(opening)} open`;
    if (heating.zoneOn) {
      clause = outside ? `${opening} open, ${outside}` : `${opening} open`;
      if (feel.airingHelps) advice = 'Leave it open a while';
      else if (outdoorTempC != null && outdoorTempC < 15) advice = `Close the ${opening} while the heating is on`;
    } else if (outside && WARM_WORDS.has(word) && outdoorTempC != null && feel.tempC != null && outdoorTempC <= feel.tempC - 2) {
      clause = `${opening} open, ${outside} so it will cool`;
    } else if (outside && COOL_WORDS.has(word)) {
      clause = `${opening} open, ${outside}`;
      if (!feel.airingHelps) advice = `Close the ${opening} if it gets too cold`;
    } else {
      clause = `${opening} open`;
    }
  } else if (heatingNow) {
    if (feel.floorSpreadC != null && feel.floorSpreadC > 0.3) {
      clause = `floor heating catching up (floor ${feel.floorSpreadC.toFixed(1)} °C cooler)`;
      shortClause = 'Floor heating catching up';
    } else {
      clause = 'heating';
      shortClause = 'Heating';
    }
  } else if (feel.mouldRisk === 'watch') {
    clause = 'getting damp';
    shortClause = 'Getting damp';
    advice = 'Air it out after showers';
  } else if (feel.airingHelps) {
    clause = outside ? `airing would help, it's ${outside}` : 'airing would help';
    shortClause = 'Airing would help';
  } else if (air && (air.band === 'stuffy' || air.band === 'poor')) {
    clause = air.cooking ? `cooking, air is ${air.band}` : `air is ${air.band}`;
    shortClause = `Air ${air.band}`;
    advice = airBandInfo(air.band).advice;
  } else if (ac && ac.deployed && ac.armed) {
    clause = ac.nextStart ? `pre-cool planned ${ac.nextStart}` : 'A/C armed for tonight';
    shortClause = ac.nextStart ? `Pre-cool planned ${ac.nextStart}` : 'A/C armed for tonight';
  } else if (ac && !ac.deployed && (ac.rec === 'ac' || ac.rec === 'hybrid')) {
    clause = ac.nextStart ? `pre-cool planned ${ac.nextStart}, deploy the A/C` : 'deploy the A/C';
    shortClause = ac.nextStart ? `Pre-cool planned ${ac.nextStart}` : 'Deploy the A/C';
    advice = ac.verdictText || null;
  } else if (feel.sunHit) {
    clause = 'sun on the window';
    shortClause = 'Sun on the window';
  } else if (heating.zoneOn) {
    clause = 'heating idle';
    shortClause = 'Heating idle';
  } else if (feel.detail && feel.detail.toLowerCase() !== 'nothing to do') {
    clause = lowerFirst(feel.detail);
    shortClause = feel.detail;
  }

  const chips: ClimateChip[] = [];
  if (heatingNow) chips.push({ id: 'heating', icon: 'mdi:fire', label: 'Heating', tone: 'heat' });
  if (ac) {
    if (ac.cooling) chips.push({ id: 'ac', icon: 'mdi:snowflake', label: 'A/C cooling', tone: 'cool' });
    else if (ac.deployed && ac.armed) chips.push({ id: 'ac', icon: 'mdi:snowflake', label: 'Cool night armed', tone: 'cool' });
    else if (ac.deployed) chips.push({ id: 'ac', icon: 'mdi:snowflake', label: 'A/C ready', tone: 'neutral' });
  }
  if (feel.windowOpen) {
    const isDoor = /door/i.test(opening);
    chips.push({ id: 'open', icon: isDoor ? 'mdi:door-open' : 'mdi:window-open-variant', label: `${opening} open`, tone: 'neutral' });
  }
  if (feel.sunHit) chips.push({ id: 'sun', icon: 'mdi:white-balance-sunny', label: 'Sun on the window', tone: 'warn' });
  if (feel.airingHelps) chips.push({ id: 'airing', icon: 'mdi:weather-windy', label: 'Airing helps', tone: 'good' });
  if (feel.mouldRisk === 'watch') chips.push({ id: 'mould', icon: 'mdi:water-alert', label: 'Mould watch', tone: 'warn' });
  if (feel.mouldRisk === 'high') chips.push({ id: 'mould', icon: 'mdi:water-alert', label: 'Mould risk high', tone: 'alert' });
  if (air && air.band !== 'unknown') {
    const tone: ChipTone = air.band === 'fresh' ? 'fresh' : air.band === 'good' ? 'good' : air.band === 'stuffy' ? 'warn' : 'alert';
    chips.push({ id: 'air', icon: 'mdi:air-filter', label: `Air ${air.band}`, tone });
  }

  return { clause, shortClause, advice, chips };
}

/** Colour family for the comfort word next to the big temperature. */
export function comfortTone(word: string): 'fresh' | 'warn' | 'alert' | 'good' | 'neutral' {
  if (word === 'comfortable') return 'fresh';
  if (word === 'hot') return 'alert';
  if (WARM_WORDS.has(word)) return 'warn';
  if (COOL_WORDS.has(word)) return 'good';
  return 'neutral';
}
