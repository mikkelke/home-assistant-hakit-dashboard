type Timed = { attributes?: Record<string, unknown>; last_changed?: string } | undefined;

/** When the entity entered its current state. The appliance monitors publish `state_since`
 * because HA erases their entities on restart and the republish resets `last_changed`. */
export function stateSinceIso(entity: Timed): string | undefined {
  const since = entity?.attributes?.state_since;
  return typeof since === 'string' && since ? since : entity?.last_changed;
}
