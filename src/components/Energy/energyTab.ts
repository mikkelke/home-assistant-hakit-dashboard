/** Energy page tabs and their `#energy=<tab>` hash form. Pure, and imported by type only outside
 * the lazily loaded Energy chunk. */
export const ENERGY_TABS = ['live', 'plan', 'usage', 'rooms', 'bill', 'utilities'] as const;
export type EnergyTab = (typeof ENERGY_TABS)[number];

/** Hashes from before the Plan/Rooms rename keep opening the tab that replaced them. */
const RENAMED_TABS: Record<string, EnergyTab> = { price: 'plan', devices: 'rooms' };

/** The tab named by an `#energy=<tab>` hash; anything else (bare `#energy`, unknown tab) is Live. */
export function energyTabFromHash(hash: string): EnergyTab {
  const name = hash.startsWith('#energy=') ? hash.slice('#energy='.length) : '';
  if ((ENERGY_TABS as readonly string[]).includes(name)) return name as EnergyTab;
  return RENAMED_TABS[name] ?? 'live';
}

export function energyHash(tab: EnergyTab): string {
  return tab === 'live' ? '#energy' : `#energy=${tab}`;
}
