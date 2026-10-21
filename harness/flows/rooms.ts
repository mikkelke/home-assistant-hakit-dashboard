import type { Flow } from '../flow';
import { ROOMS } from '../fixtures/rooms';

const slug = (id: string) => id.replace(/_/g, '-');

export const roomFlows: Flow[] = ROOMS.flatMap((room): Flow[] => [
  {
    name: `room ${room.id}`,
    open: { hash: `#room=${room.id}` },
    ready: '.room-detail',
    run: async shots => {
      await shots.scrolling('.room-detail-content', `room-${slug(room.id)}`);
    },
  },
  {
    name: `room ${room.id} with every card open`,
    open: { hash: `#room=${room.id}`, expanded: true },
    ready: '.room-detail',
    run: async shots => {
      await shots.scrolling('.room-detail-content', `room-${slug(room.id)}-open`);
    },
  },
]);
