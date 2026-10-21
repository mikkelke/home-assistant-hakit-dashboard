# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React 19 and Vite 7 single-page app on `@hakit/core`, the Home Assistant WebSocket client. No backend of its own: every read is an entity or a registry, every write a Home Assistant service call. The built files are served by Home Assistant under `/local/ha-dashboard/` and opened in the Companion app's webview or a browser. A new build reaches open dashboards by itself: clients poll `version.json` and reload within about a minute.

## Users

- **Primary: the three residents of one shared apartment**, the owner (a Home Assistant administrator) and two housemates. Viewing is phone-first, in the Companion app or a mobile browser. Cold loads are common, so first-paint bytes matter: the Home grid is the entry bundle and every other surface is a lazy chunk.
- **One exception: a tablet on the kitchen wine fridge**, signed in as its own Home Assistant user. It is used while coffee brews, to watch the live brew graph from counter distance, probably in landscape. It is not an always-on wall display; there is none, and any "wall tablet" wording elsewhere in the repo is wrong.
- Admin-only surfaces (owner): Map, Heating, Batteries, Smoke alarm. Housemates see the lists shared with them and can change the heating only in their own room.

## Product Purpose

One shared picture of the apartment that three people can read in a glance: which rooms are lit and occupied, who is home, what is running and when it ends, what is due, what the power costs now. The few direct controls are the ones people reach for: lights, blinds, Sonos, TV, the doors, the room's heating target, to-do lists. Success: a housemate answers "is the washer done", "is the flat warm", "who rang" without words and without opening a second app.

## Positioning

The dashboard shows conclusions the house already reached. AppDaemon publishes semantic entities (room feel with its comfort word, house events, what is due, appliance run profiles, the heating plan, the coffee brew), and the screens render those instead of re-deriving them from raw sensors. Most of the house runs itself (the intercom opens for the doorbell, the robot vacuum cleans on its own, resident lights follow people), so screens report what the house did and offer an override; they do not centre on those automations.

## Operating Context

- Home Assistant and AppDaemon run in the building. The dashboard reads one live entity map plus on-demand history, statistics, to-do and media calls.
- Time is the house clock, Europe/Copenhagen, 24-hour, dates day-first (dd/mm or dd.mm); energy numbers use the Danish format (1.234,56). UI strings are English; room, list and programme names come from Home Assistant and may be Danish.
- Dark only, apart from an optional light plan in the sensor map. Most of the household's phones are iPhones, so Safari's webview is the main client.
- Rooms, entity ids and conventions (`sensor.<room>_feel`, `binary_sensor.<room>_active`, `light.*` per room in `src/config/lights.ts`) are specific to this flat.

## Capabilities and Constraints

- Pages: Home grid, room panel, timeline, Energy (six tabs), Lists, coffee stage, Heating (admin), sensor map (admin), menu, and the quick-access sheets (doors, media with media requests, transit, weather).
- The viewer lookup (`auth/current_user`) gates admin pages and what each resident sees; the safe default while it resolves is the restricted view.
- Nothing is hover-only and `title=` tooltips carry no information: this is a touch product.
- Overlays portal to `document.body`: the mobile room panel's transform breaks `position: fixed` inside it.
- Optional `VITE_*_FEEDBACK_URL` endpoints hold appliance cycle history; without them the cards hide that history.
- Local previews exist in production code: `?washer_demo=`, `?dishwasher_demo=`, `?dryer_demo=`, `?fire_demo=`, `?coffee_demo=`.

## Brand Commitments

None beyond the household's own names (rooms, people, programmes). No logo, no external brand.

## Evidence on Hand

- `harness/` renders every page and key overlay at 390x844 and 1280x800 from synthetic fixtures; run it with `npm run screens`. The fixtures hold invented times, names and values only.
- `src/**/__tests__/fixtures` are hand-written invented data for the parsers.
- No usage counts, user research or timing measurements are committed; none are to be invented. Real exports (entity dumps, logs, archives, floor plans) must never be committed: the repository is public.

## Product Principles

1. Show the conclusion, keep the sensor behind a tap. The backend decides comfortable, due, cheapest; the UI never re-derives it.
2. Icons and compact chips over text. Words go behind a tap (a sheet, a details row). State is colour plus icon, never colour alone.
3. Phone first, cheap on a cold load. First paint carries the Home grid; heavy surfaces load on demand.
4. One shared reality. Every resident sees the same house; people differ only in what they may see (lists, admin pages) and change (their own room).
5. Report the automation, allow the override. The house acts on its own; the dashboard says what it did and lets a person take over.

## Accessibility & Inclusion

- Tap targets aim for 44 px: 14 `min-height: 44px` rules and 33 pseudo-element hit-area extensions, yet many chips are visibly 22 to 38 px tall.
- `prefers-reduced-motion` is honoured: animation is cut to one iteration and a few milliseconds, and decorative motion runs on a budget (`useMotionSlot`).
- Hover styles exist only under `(hover: hover) and (pointer: fine)`.
- State must not rely on colour alone, and unavailable devices must not read as off (not yet met, see DESIGN.md).
- Text below 12 px is common (123 `font-size` declarations in the stylesheets); phone legibility is an open issue.
