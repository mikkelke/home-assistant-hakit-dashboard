import type { Draft, SaveQueue } from '../../sensorMap/saveQueue';
import { browserDrafts } from './drafts';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

interface DraftPromptProps {
  queue: SaveQueue;
  drafts: readonly (Draft & { current: boolean })[];
  onDone: () => void;
}

/** Offers back what a page never got acknowledged: the unsaved changes of an earlier visit, or of this one after another
 * writer changed the document. Against a document Home Assistant has since replaced, both choices stay open. */
export function DraftPrompt({ queue, drafts, onDone }: DraftPromptProps) {
  const elsewhere = drafts.filter(draft => !draft.current);
  const [use, drop] = elsewhere.length > 0 ? ['Overwrite', 'Reload'] : ['Restore', 'Discard'];
  const choose = (restore: boolean) => {
    if (restore) queue.restore(drafts);
    else drafts.forEach(draft => browserDrafts.clear(draft.key));
    onDone();
  };
  return (
    <>
      <p>
        {elsewhere.length > 0
          ? `Changed elsewhere: Home Assistant holds a newer ${elsewhere.map(draft => draft.key).join(' and ')}, from ${when(queue.getSnapshot().docs[elsewhere[0].key].updated_at)}.`
          : 'Unsaved changes were kept on this device.'}
      </p>
      <p className='sm-muted'>
        Your changes are from {when(drafts[0].savedAt)}. {use} puts them in place of what is stored; {drop} keeps what is stored and drops
        them.
      </p>
      <div className='sm-row'>
        <button type='button' className='sm-chip on' onClick={() => choose(true)}>
          {use}
        </button>
        <button type='button' className='sm-chip' onClick={() => choose(false)}>
          {drop}
        </button>
      </div>
    </>
  );
}
