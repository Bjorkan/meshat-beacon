# Bucketed telemetry DB errors panic instead of returning the JSON 500 envelope

In `getObserverTelemetry` (beacon-server `internal/api/handlers/observers.go`, ~line 229) the
bucketed branch shadows the outer `err`:

```go
points, err := reader.GetObserverTelemetryBucketed(...)
```

When the bucketed query fails, the outer `err` stays nil, `telemetry` stays nil, and
`telemetry.Range = rangeParam` a few lines down nil-derefs. chi's Recoverer turns the panic into a
bare 500 with no `{error: ...}` body.

Only reachable with `interval=6h`/`24h` (the 7d/30d ranges in beacon-web). Fix: assign with `=`
(declare `points` separately) so the error reaches the existing `if err != nil` check.
