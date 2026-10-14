# Rober2 test fixtures

- `rober2-maps.json`: a synthetic maps `index.json` in the shape the rober2 app writes. Invented
  times: 37 maps, newest first, five-room rounds on 09.10, 12.10, 13.10 and 14.10 (hallway, both
  kitchen sides, living room, dining room), older single rooms back to 06.12.2025, and two
  stuck-robot snapshots. The 12.10 and 13.10 rounds line up with the Rober2 rows of
  `src/home/__tests__/fixtures/house-events.json`.

Never commit a live export here: this repo is public, and a run log shows when the flat stood
empty. Write fixtures by hand like this one.
