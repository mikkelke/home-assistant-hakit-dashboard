import type { MapDoc, SuggestItem } from '../../sensorMap/mapDoc';
import type { Ghost } from './MarkLayers';
import { SetupSuggestion } from './SetupSheet';
import { Sheet } from './Sheet';
import { SuggestionCard } from './SuggestionCard';

type Kind = SuggestItem['kind'];
type PlanItem = Exclude<SuggestItem, { kind: 'phone' | 'wifi' }>;

/** What a survey needs comes first, then what is on the plan, then the answers. */
const KIND: Record<Kind, { tag: string; rank: number }> = {
  phone: { tag: 'Phone', rank: 0 },
  wifi: { tag: 'Wi-Fi', rank: 1 },
  new_device: { tag: 'New device', rank: 2 },
  placement: { tag: 'Placement', rank: 3 },
  furniture: { tag: 'Furniture', rank: 4 },
  vent: { tag: 'Vent', rank: 5 },
  rename: { tag: 'Rename', rank: 6 },
  answer: { tag: 'Answer', rank: 7 },
};

interface SuggestionsSheetProps {
  /** Every suggestion nobody has decided yet. */
  items: readonly SuggestItem[];
  doc: MapDoc;
  /** The suggestions that draw a marker on the plan. */
  ghosts: readonly Ghost[];
  onAccept: (item: SuggestItem) => void;
  onReject: (id: string) => void;
  onShow: (item: SuggestItem) => void;
  onClose: () => void;
}

const nameOf = (doc: MapDoc, key: string) => doc.devices[key]?.name ?? key;

function titleOf(item: PlanItem, doc: MapDoc): string {
  switch (item.kind) {
    case 'new_device':
      return item.device.name;
    case 'placement':
      return nameOf(doc, item.device_key);
    case 'furniture':
      return item.furniture.name;
    case 'vent':
      return item.vent.name;
    case 'rename':
      return `${nameOf(doc, item.device_key)} to ${item.name}`;
    case 'answer': {
      const question = [...doc.questions, ...doc.measurements].find(entry => entry.id === item.target);
      return question ? `${question.id}: ${question.text}` : item.target;
    }
  }
}

/** Every suggestion that waits for a decision, in one place: what each is about and why, and Accept, Discard and, for
 * one that has a place on the plan, Show on map. */
export function SuggestionsSheet({ items, doc, ghosts, onAccept, onReject, onShow, onClose }: SuggestionsSheetProps) {
  const ordered = [...items].sort((a, b) => KIND[a.kind].rank - KIND[b.kind].rank);
  return (
    <Sheet title='Suggestions' subtitle={`${items.length} waiting`} onClose={onClose} className='tall'>
      {ordered.length === 0 && <p className='sm-muted'>Nothing is waiting.</p>}
      {ordered.map(item => {
        if (item.kind === 'phone' || item.kind === 'wifi') {
          return <SetupSuggestion key={item.id} item={item} doc={doc} tag={KIND[item.kind].tag} onAccept={onAccept} onReject={onReject} />;
        }
        const ghost = ghosts.find(candidate => candidate.id === item.id);
        const onPlan = ghost !== undefined || (item.kind === 'rename' && doc.devices[item.device_key]?.placement.pos != null);
        return (
          <SuggestionCard
            key={item.id}
            tag={KIND[item.kind].tag}
            title={titleOf(item, doc)}
            reason={item.reason}
            detail={
              item.kind === 'answer'
                ? `Proposed: ${item.answer}`
                : ghost
                  ? `At x ${ghost.at[0].toFixed(2)}, y ${ghost.at[1].toFixed(2)}.`
                  : undefined
            }
            warn={ghost?.stale ? 'Made against an older layout.' : undefined}
            onAccept={() => onAccept(item)}
            onDiscard={() => onReject(item.id)}
            onShow={onPlan ? () => onShow(item) : undefined}
          />
        );
      })}
    </Sheet>
  );
}
