// One place that turns a Rober2 room value into a room name - the card, the day strip's
// span labels and the per-room request rows must all name the same room the same way.

/** Map numeric/string room IDs to display names (customize for your setup). */
const ROOM_ID_TO_NAME: Record<string, string> = {
  '17': 'Hallway',
  '22': 'Kitchen cook side',
  '25': 'Kitchen dining side',
  '18': 'Living room',
  '21': 'Dining room',
  '23': 'Claudias Room',
  '16': 'Kristines room',
  '20': 'Bedroom',
  '24': 'Bathroom',
  '19': 'Guest bathroom',
};

/** Map string room names from map entries to display names. */
const ROOM_NAME_MAP: Record<string, string> = {
  kitchen: 'Kitchen cook side',
  kitchen_1: 'Kitchen cook side',
  kitchen_2: 'Kitchen dining side',
};

export function formatRoberRoomName(room: string | undefined): string | undefined {
  if (!room) return undefined;
  // First check string name mapping (for map entries)
  const lowerRoom = room.toLowerCase();
  if (ROOM_NAME_MAP[lowerRoom]) return ROOM_NAME_MAP[lowerRoom];
  // Then check numeric ID mapping (for sensor values)
  return ROOM_ID_TO_NAME[room] || ROOM_ID_TO_NAME[lowerRoom] || room[0]?.toUpperCase() + room.slice(1).replace('_', ' ');
}
