/** Who sees which kind of delivery. Pure. */
import { HOUSEHOLD, type HouseholdMember } from '../home/household';

export type DeliveryKind = 'food' | 'groceries' | 'parcel';

/** The household members who see each kind, by key. Nobody else gets a chip or a sheet for it, a housemate
 * included; opening a kind to them is adding their keys to its list. */
export const DELIVERY_AUDIENCE: Readonly<Record<DeliveryKind, readonly HouseholdMember['key'][]>> = {
  food: ['mikkel'],
  groceries: ['mikkel'],
  parcel: ['mikkel'],
};

/** The household member whose HA user display name is `userName`, ignoring case and stray spaces. */
function memberNamed(userName: string | null | undefined): HouseholdMember | undefined {
  const name = userName?.trim().toLowerCase();
  return name ? HOUSEHOLD.find(member => member.name.toLowerCase() === name) : undefined;
}

/** Whether `viewer` sees deliveries of `kind`. A viewer still resolving, a shared tablet and anyone who is not a
 * household member see none. */
export function canViewerSeeDelivery(kind: DeliveryKind, viewer: { name: string | null }): boolean {
  const member = memberNamed(viewer.name);
  return member !== undefined && DELIVERY_AUDIENCE[kind].includes(member.key);
}
