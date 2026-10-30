import { expect } from '@playwright/test';
import type { Flow } from '../flow';
import { ROOMS } from '../fixtures/rooms';
import type { Shots } from '../shots';

const slug = (id: string) => id.replace(/_/g, '-');

async function assertPhoneCloseClearance(shots: Shots): Promise<void> {
  if (shots.viewport !== 'phone') return;

  await shots.settle();
  const content = shots.page.locator('.room-detail-content');
  await content.evaluate(node => node.scrollTo({ top: node.scrollHeight, behavior: 'instant' }));
  const remaining = await content.evaluate(node => Math.max(0, node.scrollHeight - node.clientHeight) - node.scrollTop);
  expect(Math.abs(remaining), 'The room panel must be at its true scroll end').toBeLessThanOrEqual(1);

  const controls = content.locator(
    'button:visible, a[href]:visible, input:visible, select:visible, textarea:visible, [tabindex]:not([tabindex="-1"]):visible'
  );
  const lastControl = controls.last();
  await expect(lastControl, 'The room panel must contain an interactive control').toBeVisible();
  const controlBox = await lastControl.boundingBox();
  const closeBox = await shots.page.locator('.room-detail-floating-close').boundingBox();
  if (!controlBox || !closeBox) throw new Error('The last room control and floating close must have visible bounding boxes');
  expect(controlBox.y + controlBox.height + 8, 'The last room control must end at least 8px above the floating close').toBeLessThanOrEqual(
    closeBox.y
  );
  await content.evaluate(node => node.scrollTo({ top: 0, behavior: 'instant' }));
}

export const roomFlows: Flow[] = ROOMS.flatMap((room): Flow[] => [
  {
    name: `room ${room.id}`,
    open: { hash: `#room=${room.id}` },
    ready: '.room-detail',
    run: async shots => {
      await shots.scrolling('.room-detail-content', `room-${slug(room.id)}`);
      await assertPhoneCloseClearance(shots);
    },
  },
  {
    name: `room ${room.id} with every card open`,
    open: { hash: `#room=${room.id}`, expanded: true },
    ready: '.room-detail',
    run: async shots => {
      await shots.scrolling('.room-detail-content', `room-${slug(room.id)}-open`);
      await assertPhoneCloseClearance(shots);
    },
  },
]);
