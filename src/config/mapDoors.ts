import { APARTMENT_DOOR_OPEN_ENTITY } from './entities';

/** The contact sensor of each door on the sensor map, by the door's name in the plan. A door missing here has none. */
export const MAP_DOOR_CONTACTS: Readonly<Record<string, string>> = {
  "Claudia's room door": 'binary_sensor.claudias_room_door_contact',
  "Kristine's room door": 'binary_sensor.kristines_room_door_contact',
  'Front door': APARTMENT_DOOR_OPEN_ENTITY,
  'Guest bathroom door': 'binary_sensor.guest_bathroom_door_contact',
  'Bedroom door': 'binary_sensor.bedroom_door_contact',
  'Bathroom door': 'binary_sensor.bathroom_door_contact',
  "Terrace door, Claudia's room": 'binary_sensor.rooftop_door_2_contact',
  'Terrace door, living room': 'binary_sensor.rooftop_door_1_contact',
};
