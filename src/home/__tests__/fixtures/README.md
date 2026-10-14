# Home screen test fixtures

- `house-events.json`: a synthetic `sensor.house_events` entity in the shape the HA REST API
  returns, without its `context`. Invented times and values on 10.10 to 13.10.2026: 40 rows,
  7 doorbell rings (each a `mdi:bell-ring` row and a `mdi:door-open` row with the same cause,
  3 to 5 s apart), 3 washer, 1 dryer and 1 dishwasher finishes, 5 `mdi:basket-check` emptied
  rows, 2 wake-up alarms, 2 Rober2 rounds and 11 admin-only rows in all.

Never commit a live export here (an entity dump, a log, an archive index from the box): this
repo is public, and real times show when people are home, asleep or away. Write fixtures by
hand like this one.
