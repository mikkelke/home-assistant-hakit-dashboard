# Energy plan test fixtures

- `prices-2026-10.json`: hourly all-in prices (DKK/kWh incl. VAT) for the full Europe/Copenhagen
  days 2026-10-01, 02, 09 and 10, in the price entity's `raw_today` point shape. Source: the HA
  recorder's long-term statistics for `sensor.energi_data_service` (hourly `state`, the price of
  that hour), exported 2026-10-13. Checked against the entity's own `raw_today` for 2026-10-13
  00:00 to 11:00 (identical to its 3 published decimals).
- `run-profiles.json`: a `sensor.appliance_run_profiles` entity in the schema 1 wire format. Each
  profile is the per-minute mean energy from power onset over the house's measured cycles (recorder
  plug power matched to the appliance feedback records), quantised to 0.1 Wh: washer Bomuld 60
  (38 cycles), dishwasher ECO (74), dryer Ekspres skabstoert (8, unverified energy). Completion
  minutes are fixture values: washer 190 (p90 onset to end 186), dishwasher 250 (onset to
  completion incl. passive drying measured at 248 to 249), dryer 95.
