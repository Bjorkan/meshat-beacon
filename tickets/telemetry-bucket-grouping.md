# Bucketed observer telemetry groups by hour-of-day, not by time window

`GetObserverTelemetryBucketed` (beacon-server `db/queries/queries.sql`, ~line 217) computes the
bucket as:

```sql
date_trunc('hour', reported_at) + (EXTRACT(HOUR FROM reported_at)::int / $4) * ($4 * interval '1 hour')
```

Truncating to the **hour** before adding the offset breaks the grouping:

- `interval=6h`: hours 0–5 land in six different buckets instead of one, and hours collide across
  days (day D hour 12 and day D+1 hour 0 both map to D+1 00:00). A `MAX−MIN` delta can span reports
  12h apart under a displaced timestamp.
- `interval=24h`: the offset is always 0, so the 30d view returns ~720 per-hour buckets with
  near-zero deltas instead of 30 daily ones.

Expected:

```sql
date_trunc('day', reported_at) + (EXTRACT(HOUR FROM reported_at)::int / $4) * ($4 * interval '1 hour')
```

Affects the 7d/30d observer telemetry charts in beacon-web, which chart these buckets as-is since
the MAX−MIN fix (#52).
