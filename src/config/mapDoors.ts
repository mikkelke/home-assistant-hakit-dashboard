import type { DoorLink } from '../sensorMap/doorState';
import { APARTMENT_DOOR_OPEN_ENTITY } from './entities';

/** How the map knows each door's state, by the door's name in the plan: its contact sensor, or `{ closed: true }` for
 * a door that is kept shut. A door missing here has neither and is drawn open with a question mark. */
export const MAP_DOOR_CONTACTS: Readonly<Record<string, DoorLink>> = {
  "Claudia's room door": 'binary_sensor.claudias_room_door_contact',
  "Kristine's room door": 'binary_sensor.kristines_room_door_contact',
  'Front door': APARTMENT_DOOR_OPEN_ENTITY,
  'Guest bathroom door': 'binary_sensor.guest_bathroom_door_contact',
  'Technical room door': { closed: true },
  'Bedroom door': 'binary_sensor.bedroom_door_contact',
  'Bathroom door': 'binary_sensor.bathroom_door_contact',
  "Terrace door, Claudia's room": 'binary_sensor.rooftop_door_2_contact',
  'Terrace door, living room': 'binary_sensor.rooftop_door_1_contact',
};
