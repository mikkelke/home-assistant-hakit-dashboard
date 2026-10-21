import type { HouseBuilder } from './builder';
import { HaError } from './types';

interface Item {
  uid: string;
  summary: string;
  status: 'needs_action' | 'completed';
}

const GROCERIES = [
  'Havregryn',
  'Mælk 1 l',
  'Smør',
  'Rugbrød',
  'Æg, 10 stk',
  'Bananer',
  'Æbler, de små røde',
  'Kaffebønner, mellemristet, 1 kg',
  'Pasta',
  'Hakkede tomater, 4 dåser',
  'Løg',
  'Hvidløg',
  'Gulerødder',
  'Kartofler 2 kg',
  'Basmatiris',
  'Kyllingebryst',
  'Hakket oksekød 8-12 %',
  'Fløde',
  'Græsk yoghurt',
  'Ost til madpakker',
  'Agurk',
  'Peberfrugt, rød og gul',
  'Spinat',
  'Citroner',
  'Tandpasta',
  'Opvasketabs, de store pakker fra tilbudsavisen, hvis de stadig har dem i den lille butik ved stationen',
  'Toiletpapir',
  'Køkkenrulle',
  'Hæfteklammer',
  'Batterier AA',
  'Vaskemiddel, sensitiv',
  'Skyllemiddel',
  'Kaffefiltre',
  'Te, Earl Grey',
  'Honning',
  'Peanutbutter',
  'Müsli',
  'Mandelmælk',
  'Tortillas',
  'Frosne ærter',
  'Is, vanilje',
  'Tun på dåse',
  'Majs',
  'Sennep',
  'Ketchup',
];

const HOME = [
  'Tag skraldet med ned',
  'Betal fjernvarmen',
  'Book tid til rengøring af emhætten',
  'Skift pærer i entréen',
  'Ring til viceværten om cykelkælderen',
];

const OFFICE = ['Print kontrakten', 'Genbestil toner', 'Aflever nøglekort', 'Tøm køleskabet fredag'];

function build(names: readonly string[], seed: string, doneEvery: number): Item[] {
  return names.map((summary, index) => ({
    uid: `${seed}-${index}`,
    summary,
    status: doneEvery > 0 && index % doneEvery === doneEvery - 1 ? 'completed' : 'needs_action',
  }));
}

const LISTS: Array<{ id: string; name: string; icon?: string; items: Item[] }> = [
  { id: 'todo.indkob', name: 'Indkøb', items: build(GROCERIES, 'groceries', 6) },
  { id: 'todo.husk_hjemme', name: 'Husk hjemme', items: build(HOME, 'home', 4) },
  { id: 'todo.husk_kontor', name: 'Husk kontor', items: build(OFFICE, 'office', 3) },
  { id: 'todo.net_kob', name: 'Net køb', items: [] },
];

const USERS = [
  { id: 'a1f0c0de0000000000000000000000a1', name: 'Mikkel', is_owner: true, system_generated: false, is_active: true },
  { id: 'b2e1d1ef0000000000000000000000b2', name: 'Kristine', is_owner: false, system_generated: false, is_active: true },
  { id: 'd4c3b3a10000000000000000000000d4', name: 'Claudia', is_owner: false, system_generated: false, is_active: true },
  { id: 'c3d2e2f00000000000000000000000c3', name: 'Rooftop', is_owner: false, system_generated: false, is_active: true },
  { id: 'e5f4a4b20000000000000000000000e5', name: 'AppDaemon', is_owner: false, system_generated: false, is_active: true },
  { id: 'f6a5b5c30000000000000000000000f6', name: 'Supervisor', is_owner: false, system_generated: true, is_active: true },
];

export function addLists(h: HouseBuilder): void {
  for (const list of LISTS) {
    const open = list.items.filter(item => item.status === 'needs_action').length;
    h.put(`todo.${list.id.slice(5)}`, open, {
      friendly_name: list.name,
      supported_features: 15,
      ...(list.icon ? { icon: list.icon } : {}),
    });
  }
  h.ws['todo/item/subscribe'] = (message, context) => {
    const list = LISTS.find(candidate => candidate.id === message.entity_id);
    if (!list) throw new HaError('not_found', 'Entity not found');
    context.event({ items: list.items });
    return null;
  };
  h.ws['config/auth/list'] = () => {
    if (!h.viewer.isAdmin) throw new HaError('unauthorized', 'Unauthorized');
    return USERS.map(user => ({
      ...user,
      username: user.name.toLowerCase(),
      group_ids: user.is_owner ? ['system-admin'] : ['system-users'],
      local_only: false,
    }));
  };
  h.systemData.todo_lists = {
    visible: {
      'todo.indkob': [USERS[0].id, USERS[1].id, USERS[2].id, USERS[3].id],
      'todo.husk_hjemme': [USERS[0].id, USERS[1].id],
      'todo.husk_kontor': [USERS[0].id],
    },
  };
}
