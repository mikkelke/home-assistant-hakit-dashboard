# Home screen test fixtures

- `house-events-2026-10-13.json`: the live `sensor.house_events` entity as the HA REST API returned
  it on 2026-10-13 at 13:24 UTC, without its `context`. 40 rows from 10.10 11:46 to 13.10 12:26:
  7 doorbell rings (each a `mdi:bell-ring` row and a `mdi:door-open` row with the same cause, 3 to
  5 s apart), 3 washer, 1 dryer and 1 dishwasher finishes, 5 `mdi:basket-check` emptied rows, 2
  wake-up alarms and 11 admin-only rows in all.
