import { useEffect, useRef, useState } from 'react';
import type { MapDoc, Measurement, Question, SuggestItem } from '../../sensorMap/mapDoc';
import { TextField } from './fields';
import { Sheet } from './Sheet';

type Entry = (Question | Measurement) & { prio?: string; applied?: boolean };

interface QuestionsSheetProps {
  doc: MapDoc;
  proposals: Extract<SuggestItem, { kind: 'answer' }>[];
  focusId: string | null;
  onAnswer: (id: string, answer: string | null) => void;
  onAccept: (item: SuggestItem) => void;
  onReject: (id: string) => void;
  onJump: (deviceKey: string) => void;
  onClose: () => void;
}

function Row({
  entry,
  doc,
  proposal,
  focused,
  onAnswer,
  onAccept,
  onReject,
  onJump,
}: {
  entry: Entry;
  doc: MapDoc;
  proposal: Extract<SuggestItem, { kind: 'answer' }> | undefined;
  focused: boolean;
  onAnswer: QuestionsSheetProps['onAnswer'];
  onAccept: QuestionsSheetProps['onAccept'];
  onReject: QuestionsSheetProps['onReject'];
  onJump: QuestionsSheetProps['onJump'];
}) {
  const ref = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [focused]);
  return (
    <li ref={ref} className={`sm-qa${entry.answer ? ' answered' : ''}${focused ? ' focus' : ''}`} id={`sm-q-${entry.id}`}>
      <div className='sm-qa-text'>
        <span className='sm-qa-id'>{entry.id}</span>
        {entry.prio && <span className='sm-tag'>{entry.prio}</span>}
        {entry.applied && <span className='sm-tag confirmed'>applied</span>}
        {entry.text}
      </div>
      {entry.refs.length > 0 && (
        <div className='sm-row wrap'>
          {entry.refs.map(ref => (
            <button key={ref} type='button' className='sm-chip small' onClick={() => onJump(ref)}>
              {doc.devices[ref]?.name ?? ref}
            </button>
          ))}
        </div>
      )}
      <TextField
        label={`Answer ${entry.id}`}
        value={entry.answer}
        placeholder='Your answer'
        onCommit={value => onAnswer(entry.id, value)}
      />
      {proposal && (
        <div className='sm-suggest'>
          <span>Proposed: {proposal.answer}</span>
          <span className='sm-row'>
            <button type='button' className='sm-chip small on' onClick={() => onAccept(proposal)}>
              Accept
            </button>
            <button type='button' className='sm-chip small' onClick={() => onReject(proposal.id)}>
              Reject
            </button>
          </span>
        </div>
      )}
    </li>
  );
}

/** The questions and the tape measure jobs, each with its answer. An answer typed here is saved to the map. */
export function QuestionsSheet({ doc, proposals, focusId, onAnswer, onAccept, onReject, onJump, onClose }: QuestionsSheetProps) {
  const focusIsMeasure = focusId !== null && doc.measurements.some(item => item.id === focusId);
  const [tab, setTab] = useState<'questions' | 'measurements'>(focusIsMeasure ? 'measurements' : 'questions');
  const [openOnly, setOpenOnly] = useState(false);
  const entries: Entry[] = tab === 'questions' ? doc.questions : doc.measurements;
  const shown = openOnly ? entries.filter(entry => !entry.answer) : entries;
  const open = (list: Entry[]) => list.filter(entry => !entry.answer).length;
  return (
    <Sheet
      title='Questions'
      subtitle={`${open(doc.questions)} open, ${open(doc.measurements)} to measure`}
      onClose={onClose}
      className='tall'
    >
      <div className='sm-row wrap'>
        <button type='button' className={`sm-chip small${tab === 'questions' ? ' on' : ''}`} onClick={() => setTab('questions')}>
          Questions {doc.questions.length}
        </button>
        <button type='button' className={`sm-chip small${tab === 'measurements' ? ' on' : ''}`} onClick={() => setTab('measurements')}>
          Measurements {doc.measurements.length}
        </button>
        <label className='sm-check'>
          <input type='checkbox' checked={openOnly} onChange={event => setOpenOnly(event.target.checked)} />
          Open only
        </label>
      </div>
      <ol className='sm-qa-list'>
        {shown.map(entry => (
          <Row
            key={entry.id}
            entry={entry}
            doc={doc}
            proposal={proposals.find(proposal => proposal.target === entry.id)}
            focused={focusId === entry.id}
            onAnswer={onAnswer}
            onAccept={onAccept}
            onReject={onReject}
            onJump={onJump}
          />
        ))}
        {shown.length === 0 && <li className='sm-muted'>Nothing open.</li>}
      </ol>
    </Sheet>
  );
}
