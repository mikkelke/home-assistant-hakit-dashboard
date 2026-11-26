---
name: Home Dashboard
description: A dark, touch-first Home Assistant dashboard that three housemates read at a glance on a phone, plus one kitchen tablet for the coffee brew graph.
colors:
  ground: "#0d0f13"
  backdrop: "#0a101b"
  surface-card: "#15161a"
  surface-chip: "rgba(255, 255, 255, 0.06)"
  line: "rgba(255, 255, 255, 0.07)"
  text-1: "#e4e4e7"
  text-2: "#a1a1aa"
  text-3: "#8b8b94"
  room-tile: "#141518"
  device-card: "#1c1c1e"
  device-chip: "#2c2c2e"
  device-chip-high: "#3a3a3c"
  label-1: "rgba(255, 255, 255, 0.92)"
  label-2: "rgba(235, 235, 245, 0.6)"
  label-3: "rgba(235, 235, 245, 0.3)"
  dock: "rgba(15, 17, 23, 0.95)"
  dock-button-fill: "rgba(24, 25, 28, 0.6)"
  accent-sky: "#38bdf8"
  accent-gold: "#fbbf24"
  accent-rose: "#fb7185"
  ok-green: "#22c55e"
  ok-mint: "#34d399"
  warn-amber: "#f59e0b"
  alarm-red: "#ff453a"
  band-normal: "#94a3b8"
  band-unknown: "#52525b"
  coffee-copper: "#d4956a"
  coffee-copper-light: "#f0c9ad"
  coffee-advice: "#a78bfa"
typography:
  figure:
    fontFamily: "Roboto, Helvetica, Arial, sans-serif"
    fontSize: "46px"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  display:
    fontFamily: "Roboto, Helvetica, Arial, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "\"tnum\""
  title:
    fontFamily: "Roboto, Helvetica, Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
  card-title:
    fontFamily: "Roboto, Helvetica, Arial, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 600
  body:
    fontFamily: "Roboto, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.3
  label:
    fontFamily: "Roboto, Helvetica, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    fontFeature: "\"tnum\""
  caption:
    fontFamily: "Roboto, Helvetica, Arial, sans-serif"
    fontSize: "11.5px"
    fontWeight: 500
rounded:
  chip: "12px"
  tile: "16px"
  page-card: "20px"
  card: "24px"
  pill: "999px"
  round: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  card-pad: "1.25rem"
  tap: "44px"
components:
  room-tile:
    backgroundColor: "{colors.room-tile}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.tile}"
    padding: "12px"
  device-card:
    backgroundColor: "{colors.device-card}"
    textColor: "{colors.label-1}"
    rounded: "{rounded.card}"
    padding: "{spacing.card-pad}"
  page-card:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.page-card}"
  chip:
    backgroundColor: "{colors.surface-chip}"
    textColor: "{colors.text-2}"
    typography: "{typography.label}"
    rounded: "15px"
    height: "30px"
  pulse-chip:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.text-1}"
    typography: "{typography.label}"
    rounded: "15px"
    height: "30px"
  icon-button:
    backgroundColor: "{colors.surface-chip}"
    textColor: "{colors.text-2}"
    rounded: "{rounded.round}"
    size: "44px"
  exit-button:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.round}"
    size: "56px"
  list-row:
    textColor: "{colors.text-1}"
    typography: "{typography.body}"
    height: "48px"
    padding: "8px 14px"
  dock:
    backgroundColor: "{colors.dock}"
    rounded: "{rounded.tile}"
    padding: "12px 16px"
  dock-button:
    backgroundColor: "{colors.dock-button-fill}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.chip}"
    size: "48px"
  sheet:
    backgroundColor: "{colors.device-card}"
    textColor: "{colors.label-1}"
    rounded: "{rounded.card}"
    padding: "{spacing.card-pad}"
    width: "420px"
---

# Design System: Home Dashboard

## Overview

**Creative North Star: "The Hallway Glance"**

The dashboard is read standing up, phone in one hand, for a few seconds. Home answers one question per tile (lit, occupied, running, due, expensive) with an icon, a colour and a number; sentences sit behind a tap. A second, rarer reader is the kitchen tablet: landscape, counter distance, watching the brew graph while coffee runs. There is no wall display, and no layout assumes one.

The material is flat charcoal on near-black. Two generations share the screen. Device cards and sheets use iOS-style charcoal (#1c1c1e, 24 px corners, translucent white labels). The newer pages, Lists most of all, draw on the tokens in `src/index.css` (#15161a cards, a 1 px hairline, 20 px corners). The tokens are the direction; the literals are debt that shrinks as files are touched.

Colour carries state and never travels alone: a room that is lit glows, an occupied room breathes at its edge, a running appliance draws a ring, a playing speaker gets an equaliser, an open window in the cold frosts the tile, a sleeping occupant turns the room indigo. Every one of them also has an icon: state is colour plus icon.

**Key Characteristics:**
- Dark only, flat surfaces, hairline borders, no decorative shadow on cards.
- Icons and compact chips first; words live in sheets and detail rows.
- State is colour plus icon; unavailable must not read as off.
- Phone first: a 2-column then 3-column tile grid, bottom-anchored controls, 44 px targets.
- One shared house: the same screens for everyone, trimmed by role (admin pages, shared lists).
- Most of the house runs itself, so screens report what happened and offer an override.

## Colors

A near-black ground, two families of charcoal surfaces, zinc text and a handful of state hues that each keep one meaning.

### Ground and text
- **Ground** (#0d0f13): backdrop of Home, the room panel and every full-screen page. The body behind it paints #0a101b (backdrop).
- **Text 1** (#e4e4e7, `--text-1`): primary text and icons.
- **Text 2** (#a1a1aa, `--text-2`): secondary text, resting icon buttons.
- **Text 3** (#8b8b94, `--text-3`): quiet text, counts, disabled glyphs.

### Surfaces
- **Card** (#15161a, `--surface-card`): page cards, the Home pulse chips, page headers.
- **Chip fill** (rgba(255,255,255,0.06), `--surface-chip`) and **Hairline** (rgba(255,255,255,0.07), `--line`): chips, inputs, row dividers, card borders.
- **Room tile** (#141518): the Home grid tile, with a 1 px hairline.
- **Device charcoal** (#1c1c1e, chips #2c2c2e and #3a3a3c): device cards and sheets, with a 1 px rgba(255,255,255,0.06) border. Their labels are rgba(255,255,255,0.92), rgba(235,235,245,0.6) and rgba(235,235,245,0.3).
- **Dock** (rgba(15,17,23,0.95)): the quick-access bar.

### State accents
- **Sky** (#38bdf8, `--accent-sky`): information in progress and "now": the timeline NOW line, a running appliance's ring, an open-item count, cold water, the plan line, the focus ring on new pages (device cards use #b8dfff).
- **Gold** (#fbbf24, `--accent-gold`): something wants attention: to-do chips, unconfirmed values, missed rings. Amber (#f59e0b) is the "pricey" price band.
- **Rose** (#fb7185, `--accent-rose`): expensive hours. Alarm red (#ff453a, iOS red) is for stop, errors, alarms and an unavailable robot.
- **Green** (#22c55e): ok, playing, connected. Mint (#34d399) is occupied and the cheap price band.

### Scoped palettes
- **Price bands**: cheap #34d399, normal #94a3b8, pricey #f59e0b, expensive #fb7185, unknown #52525b. One palette on every energy chart.
- **Coffee**: copper (#d4956a, light #f0c9ad) is the cup, sky is the water, purple (#a78bfa) is advice. The stage and the Kitchen card share one chart grammar.
- **Sensor map**: its own `--sm-*` set (panel #161b22, text #e6edf3, accent #58a6ff) with a light plan option.

### Named Rules
**The State-In-The-Surface Rule.** Room state is drawn on the tile (glow, ring, equaliser, frost, indigo), always with an icon next to it. A new state needs both.

**The One-Meaning Rule.** Each accent keeps one job: sky is information in progress, gold is attention, rose is expensive or stop, green is ok. Do not borrow a hue for decoration.

**The Token-On-Touch Rule.** When a rule you edit holds a literal that a `:root` token names, replace it in the same change. No big-bang migration, and no new literal where a token exists.

## Typography

**Face:** `Roboto, Helvetica, Arial, sans-serif`, set once by a universal `*` rule in `src/index.css`. Nothing is loaded from the network, so Roboto only exists on devices that ship it; an iPhone renders Helvetica.

**Character:** plain and dense. Weight 600 does the work (209 of 326 weight declarations); 700 is for tile names and big figures. Numbers use tabular figures where they change (63 declarations) and the Danish format (1.234,56).

### Hierarchy
- **Figure** (600, 46 px, 1.05, -0.02em): the coffee stage's live numbers. 40 px from 769 to 1100 px wide, 34 px on the phone; the cup figure is 52, 44 and 38 px at those sizes.
- **Display** (700, 32 px, 1, -0.02em, tabular): the Home temperature (on the hero recipe, 32 px on a phone and up to 43 px on the tablet) and the plan hero numbers. The resident heat dial is 44 px at 600.
- **Heading** (600, `--fs-heading` 20 px): full-screen page headers and sheet titles.
- **Title** (600, `--fs-title` 17 px): device card headers; list names are 15 px at 600; room tile names 13 px at 700.
- **Body** (400, 15 px, 1.3): list rows, sheet rows. Secondary lines are 13 px.
- **Label** (600, 13 px, tabular): chips and pulse chips.
- **Caption** (500 to 600, 11.5 px): sky chips, timeline chips, badges. Nothing meant to be read should go below this, though 123 declarations do.

### Named Rules
**The Number-Is-The-Headline Rule.** On a tile or card the value (a temperature, a time left, a kWh) is the largest, boldest thing; its label is a chip or a caption. A card hero sits in a size container (`container-type: inline-size` on its wrapper) and scales with it: `clamp(<phone size>, <phone size / 340 px> cqi, <about 1.35x>)`, so phones keep today's size and wider cards grow; it never wraps, tracks at -0.03em, and its unit is a light (300) fraction in `em`.

## Layout

A single scroll container per page; `html` and `body` do not scroll. Home is a column of the sky strip, a pulse row (power now, price now, next event) and a tile grid, with the quick-access dock fixed at the bottom (1.5 rem up, 2 rem from 1025 px).

- **Grid**: 2 columns, 3 from 600 px, 8 px gap, 4 px 8 px container padding, container 1100 px wide (660 px from 1025 px). Tiles are 175:132.
- **Room panel**: on phones (JS breakpoint 768 px) a full-screen sheet over Home; wider, a 450 px side panel (500 px from 1200 px) beside the overview, which narrows to at most 700 px (520 px from 701 to 1100 px). The kitchen tablet at 1280 x 800 shows the overview and the panel side by side.
- **Pages** are fixed full-screen routes at z-index 90. Lists, Heating and Energy each carry a 56 px floating exit button bottom-left, where a thumb rests (52 px in Energy's narrowest layout). Lists and Heating share a header row (glyph disc, 1.25 rem title, icon buttons); Energy leads with its six-tab bar; the sensor map has a back button top-left. Lists pad their content 12 px and switch to two columns from 900 px.
- **Spacing** has no scale in code. The recurring steps are 4, 6, 8, 10, 12 px and 0.5, 0.6, 0.75 rem (8 px alone is 69 gap declarations); device cards pad 1.25 rem, list cards 12 to 14 px, tiles 12 px.
- **Overlays portal to `document.body`.** The phone room panel's transform breaks `position: fixed` for anything rendered inside it.

### Pages
Home grid; room panel (to-do chips, then collapsible cards: Sonos, TV, wake-up, access, washer, dryer, dishwasher, lights, blind, robot vacuum, clean toggles, coffee); Timeline (`#now`); Energy (`#energy`, tabs Live, Plan, Usage, Rooms, Bill, Utilities); Lists (`#lists`); Heating (`#heating`, admin); Body (`#body`, Mikkel only: four cards from the scale's weight history, Now, Phase, History and Rhythms, in one scoped indigo; magenta marks body fat on its swatch only); Sensor map (`#map`, admin); Coffee stage (`#coffee`, the tablet's brew screen); Menu drawer (Batteries, Smoke alarm, Kiosk); quick-access sheets (doors, media with media requests, transit, weather, delivery); fire takeover; person timeline.

## Elevation & Depth

Flat. Cards and tiles are separated from the ground by tone and a 1 px hairline, not by shadow. Shadows appear only on things that float: sheets (`0 20px 60px rgba(0,0,0,0.5)`), the exit button (`0 4px 16px rgba(0,0,0,0.45)`), the dock (`0 8px 32px rgba(0,0,0,0.4)`) and the menu drawer. Scrims are rgba(0,0,0,0.5 to 0.6), sometimes with a 4 to 12 px backdrop blur. Selection and state use rings (`inset 0 0 0 1.5px`) rather than lift.

**The Flat-Until-Floating Rule.** A surface gets a shadow only if it sits over other content and can be dismissed.

## Shapes

Soft and consistent by role: **24 px** device cards and sheets (`--radius-card`), **20 px** page cards (`--radius-page`), **16 px** tiles and the dock (`--radius-tile`), **15 px** chips (`--chip-radius`), **12 px** inputs, inner rows and small panels (`--radius-chip`), **8 px** small insets and bars (`--radius-sm`), **999 px** pills, **50%** icon buttons, glyph discs and badges. Glyph discs are tinted circles holding an icon. Press feedback is `transform: scale(0.97)` over `--dur-press` (120 ms) on `--ease-out` (cubic-bezier(0.23, 1, 0.32, 1)); sheets and stages enter over `--dur-sheet` (220 ms) and leave in about 0.6x that on `--ease-in` (cubic-bezier(0.4, 0, 1, 1)), `--dur-sheet-exit` 130 ms; the room panel leaves in 180 ms. A leaving surface is an inert copy kept by `useExitGhost` until its `-out` animation ends.

**The Tint Ladder.** An accent sits over the surface at one of three shares, by role: `--tint-wash` 8% (a card or row that wants attention), `--tint-chip` 12% (a tappable chip's fill), `--tint-glyph` 16% (a glyph disc or icon well). Write `color-mix(in srgb, <accent> var(--tint-chip), transparent)`. Rims, pressed states, charts and frost keep their own shares.

## Scale

Every radius, type size, duration and tint share comes from a token in `src/index.css`. A value between two steps takes the nearest; a radius tie rounds up so a pill stays a pill, a type tie rounds down so a label never starts to truncate.

| Scale | Steps |
|---|---|
| Radius | `--radius-sm` 8, `--radius-chip` 12, `--radius-tile` 16, `--radius-page` 20, `--radius-card` 24 px; chips `--chip-radius` 15 px |
| Type | `--fs-caption` 11.5, `--fs-label` 13, `--fs-body` 15, `--fs-title` 17, `--fs-heading` 20 px; anything larger is a hero and follows the hero recipe |
| Duration | `--dur-press` 120 ms (press, hover, colour), `--dur-sheet` 220 ms (open, expand, a state change), `--dur-sheet-exit` 130 ms, `--dur-slow` 800 ms (a bar or ring filling) |
| Tint | `--tint-wash` 8 %, `--tint-chip` 12 %, `--tint-glyph` 16 % |

Outside the scale on purpose: hairlines, dots and bars at 1 to 5 px; `999px` pills, `50%` circles and any radius that is half its element's size; icon sizes set through `font-size`; figures above 22 px; charts, the sensor map and the transit chips; the coffee stage, the cook stage and the hold buttons, which are read from across the kitchen and whose fill time is the hold time; looping ambient animations and the reduced-motion reset.

**The Haptics Rule.** Every tap that does something ticks once: it opens, toggles, selects or closes, and a tap on a bare backdrop closes, so it ticks. A tap on nothing, a scroll and a swipe (a press that travels past 14 px or is cancelled) stay quiet; a slider ticks while it is dragged, once each time it crosses a tenth of its range (`stepTicker` in `utils/haptics.ts`, shared by brightness, volume and seek bars), never for a value the house pushes; a hold ticks when it completes, never when it starts or is let go. The root listener in `utils/haptics.ts` reads the markup, never the cursor: a `button`, a link, a checkbox, radio, range or select, a control role or `data-tap` ticks; a `data-backdrop` overlay ticks outside its `role="dialog"`; `data-tap="off"` silences a hold button's release and the gaps between a header's quick controls. Call `hapticTick()` yourself only for a step or a completed hold; that gesture then gets no second tick. In the Home Assistant app, on Android and iPhone alike, the tick is HA's `haptic` event.

## Components

### Room tile
A 175:132 tile (#141518, 16 px, 12 px padding): name at 14 px/700, temperature and humidity below in grey, a room glyph disc bottom-left, status icons top-right. State is drawn on the surface (see the State-In-The-Surface Rule); a running appliance draws its ring at the tile's right, a to-do or alert is a gold icon.

### Device card
Collapsed by default, remembered per card. Header row: 2.1 rem glyph disc in the card's accent, title (1.05 rem/600), optional quick dots (play/pause, light dots), a state word (0.9 rem/600, tinted: green playing, amber needs attention), a chevron. Opened, it shows the live control (a slider, a stepper, a four-button blind row) and a details row. Sibling cards share this anatomy.

### Chip
Icon plus a short value, 30 px high with a 15 px radius (`--chip-height`, `--chip-radius`). **The Rim-Or-Fill Rule:** a chip that only reads has a 1 px rim (`--chip-rim`, or `--chip-rim-tone` in its text colour) and no fill; a chip you can tap has a fill, so what is tappable shows without a hover. A tappable chip keeps a 44 px hit area through a `::before` that reaches 7 px above and below. Exceptions: the coffee stage and the cook stage keep their larger chips (read from across the kitchen), the transit departure chips keep their own look, and round count badges are badges, not chips.

### Page shell
Header on the card colour with a hairline underneath: glyph disc, title, 44 px icon buttons. Body on the ground. Exit button bottom-left. Lists is the cleanest page: tokens for every colour except the backdrop and one shadow.

### List row
48 px minimum height, 15 px text, a 1 px hairline above, a 20 px circle control on the left. Rows in one list look alike; a state difference is content (a check, a badge, a count), not a different shape. On the Lists page the circle is the check-off button (44 px target) and the text sits outside it, so a mouse can select and copy it while a finger on the text still checks the item off. A trailing pencil turns the row into an edit field with Copy, Delete and Save; Escape drops the edit, leaving the row saves it.

### Sheet
A centred overlay on device charcoal, max 420 px wide and 85vh, 24 px corners, a 32 px round close button with its hit area extended by 6 px. The climate sheet anchors to the bottom instead.

### Quick-access dock
Five 48 px buttons (44 px on narrow phones, radius 12 px) on a 16 px rounded bar: access, media (a green count badge while something plays), transit (a dot for an alert), timeline, weather. Icon only; a badge or dot is the only state. The dock is hidden while a quick-access sheet is open.

### Quick-access sheet
Access, media, transit, weather and delivery open the same sheet: #1c1c1e, 24 px corners, 560 px wide at most, 85vh, 1.25 rem padding (0.9 rem up to 480 px). The header is a 2.1 rem glyph disc (the dock icon, tinted per sheet: brass access, blue media, mint transit, sky delivery), a 1.05 rem/600 title and at most one 2.1 rem round action with a 44 px hit area; no hairline. Weather draws its own header on the same surface. One 48 px round close floats at the bottom right of the screen on phones and the top right elsewhere. Delivery has no dock button: the sky ticker's delivery chip opens it (sky while a delivery is on its way, gold when it is arriving, a quiet parcel count when only parcels days away are left). It lists a card per delivery, with a four-step strip for a food order, then the parcels still to come.

### Hold button (coffee)
Copper fill, 56 px tall, 18 px radius, "Hold 1 s to brew": starting, stopping and resuming a brew need a 1 s hold, shown by a ring that fills.

With two or more open bags of beans the hold has a bean picker above it: a card per bag with its cups left and a pastel accent of its own, fixed by the bean's id, so a top-up or a new bag never recolours an open one (of two open beans that hash to the same accent, the one issued later takes the next free one). Nothing is picked by default: the Selected panel reads "Pick beans first" with no plan or band on the chart, and the hold says the same and stays shut until a card is tapped. The panel keeps the room its chips will take, so the picker does not move when a bag is picked. Then everything that describes the cup follows that bag: the Selected panel, the plan on the chart, the water count, the beans tile, and the caption above the hold that names its recipe in its colour. The usual's band, Adjust cup and queued trial belong to the usual's own beans and stay shut for the others. The pick lasts until the brew is under way, and opening the page again forgets it. A brew that names other beans than the baseline's, or another recipe, is drawn on its own plan with no band, median deltas, verdict or "Usual" legend, and its water is measured against its own recipe; one that names neither (the plug saw it, or the machine brewed without the app's recipe) is taken for the usual. "Wrong beans?" corrects a brew of the last 24 hours in the same colours: on the card's ready, last-brew and trial views, and on the stage's ready view, its idle chart card (labelled "Last brew", so it outlasts the pickup) and its stopped view once grounds were used. A new bean name in the Beans sheet needs an ASCII letter or digit; without one Add stays shut and a short hint says why.

### Charts
SVG on the card, price-band colours for energy, copper for cup weight and sky for water in coffee, a dashed plan line, a hatched band for "your usual". A dot marks now.

## Do's and Don'ts

### Do:
- **Do** give every state an icon and a colour, and make the unavailable state look different from off.
- **Do** keep words behind a tap: a chip carries an icon and a short value; the sentence belongs in a sheet or details row.
- **Do** read colours from the `:root` tokens (`--text-1/2/3`, `--surface-card`, `--surface-chip`, `--line`, `--accent-sky/gold/rose`, `--radius-*`, `--chip-*`, `--dur-*`, `--fs-*`, `--tint-*`) and migrate literals as you touch them.
- **Do** make sibling rows and sibling cards identical in shape; differences show as content.
- **Do** use one chip anatomy per card: one height, one radius, one label size.
- **Do** guard every hover style with `(hover: hover) and (pointer: fine)`; all 39 existing ones are.
- **Do** keep tap targets at 44 px, extending small controls with a `::before` hit area (the 32 px close button does).
- **Do** render overlays through a portal to `document.body`.
- **Do** put the exit control bottom-left on full-screen pages.
- **Do** report what the house did on its own (intercom opened, vacuum ran, light followed someone) and offer the override.

### Don't:
- **Don't** put information in `title=` tooltips or hover; a touch screen never shows them.
- **Don't** design a screen around an automated feature (the intercom, the robot vacuum, resident lights).
- **Don't** add a third neutral palette; new work uses the zinc tokens.
- **Don't** let colour be the only state signal.
- **Don't** assume a wall display or a mouse.
- **Don't** copy the uppercase eyebrow labels or the serif fire headline into new surfaces; both are drift (see below).

### Known drift (recorded, not endorsed)
Counts are over `src/**/*.css`, excluding the `:root` definitions.
- **Literals the tokens name**: `#e4e4e7` 86 vs `var(--text-1)` 7; `#a1a1aa` 79 vs `var(--text-2)` 12; `#8b8b94` 9 vs `var(--text-3)` 7; `#38bdf8` 41 vs `var(--accent-sky)` 12; `#fbbf24` 34 vs 8; `#fb7185` 8 vs 5; `rgba(255,255,255,0.06)` 80 vs `var(--surface-chip)` 9; `rgba(255,255,255,0.07)` 20 vs `var(--line)` 10; `#15161a` 2 vs `var(--surface-card)` 7; `border-radius: 12px` 21 vs `var(--radius-chip)` 6.
- **Two neutral palettes**: device charcoal (`#1c1c1e` 31, `#2c2c2e` 50, `#3a3a3c` 22, `rgba(235,235,245,x)` 162) next to the zinc tokens.
- **Font**: `Inter` is declared on `:root` and `body` and the system stack (`-apple-system`, `SF Pro Text`) on 21 card and page selectors, but the universal `* { font-family: Roboto, Helvetica, Arial, sans-serif }` rule sets every element directly and beats inheritance, so none of those declarations reach any text. Only the 33 `font-family: inherit` declarations (buttons and inputs) take their container's stack. Measured: `.sonos-title`, `.list-name` and `.lists-page-title` compute to the Roboto stack while their parent cards compute to the system stack.
- **Type scale**: 828 `font-size` declarations, 94 distinct values, 123 below 12 px.
- **Uppercase eyebrows** (20 `text-transform: uppercase`, letter-spacing 0.03 to 0.08em: THE USUAL, STAGE, TIME LEFT, TO DO, HEALTH, SETTINGS, day headings). A defect the build carries; not a pattern for new surfaces.
- **System serif display** (`ui-serif, 'New York', Georgia`) on the fire takeover headline. Same: not canonized.
- **z-index ladder**: 24 values across 66 declarations. Pages 90, timeline 95, room sheet 100, dock 1000, menu 2100/2101, battery overview 2300, weather popup 3000, twelve overlay rules at 9998 to 10001, fire 12000. No scale; equal values decide by DOM order.
- **Names**: 21 elements carry `title` and no `aria-label`, five of them the icon-only dock buttons.
- **Unavailable reads as off**: with every device unavailable, Sonos shows "Quiet 0 %", lights "off", the blind offers Open and Close, the dishwasher "Empty it"; only the robot card says Unavailable.
