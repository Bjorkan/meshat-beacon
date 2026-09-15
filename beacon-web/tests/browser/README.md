# Browser regressions

Run from `beacon-web`:

```sh
npx playwright install chromium firefox
npm run test:browser
```

The suite builds production assets and starts a local preview server. Requests and
WebSockets are intercepted with fixtures; a backend is not required. Browser tests
run one worker at a time so concurrent test pages do not distort responsiveness
measurements. CI installs both browsers and runs the same suite.

`trace-detail.spec.ts` covers layout, path containment and nested interactions.
`trace-filter.spec.ts` uses 200 summaries per filter, eight realistic path hops and
two timestamps per desktop row. It checks repeated All/Trace/Ping changes, a held
response while another filter is selected, browser history, viewport-bounded DOM,
and scrolling to the final trace on desktop and mobile widths.

The filter test records frame gaps with `requestAnimationFrame` and attaches timing
JSON to the result. The guards allow up to 250 ms between frames and 2 seconds for
a complete switch, including automation overhead. These are regression limits,
not a claim that every device will meet a particular frame rate.

## Firefox profile for issue #93

Mozilla's [profiler environment variables](https://firefox-source-docs.mozilla.org/testing/debugging-intermittents/index.html#use-the-firefox-profiler)
can capture a profile of the same production fixture:

```sh
MOZ_PROFILER_STARTUP=1 \
MOZ_PROFILER_SHUTDOWN=/tmp/beacon-firefox-profile.json \
npm run test:browser -- trace-filter --project=firefox --workers=1
```

Load that file in Firefox Profiler and inspect the Web Content `GeckoMain` thread.
The test emits `trace-filter` User Timing measures around individual switches.

Measured locally in headless Firefox 155 on 2026-09-16:

| Implementation                                            | Repeated switches                                                     | Largest frame gap       | Mounted desktop rows |
| --------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------- | -------------------- |
| Before fix                                                | First switch timed out after 30 s; profile event delay reached 37.2 s | Switch did not complete | 200                  |
| Stable empty loading array only                           | 699–830 ms                                                            | 317 ms                  | 200                  |
| Stable array, virtualized traces, shared tooltip provider | 186–222 ms                                                            | 50.3 ms                 | 19                   |

These are individual local comparison runs, not a hardware-independent benchmark.
The original profile repeatedly sampled React reconciliation and `DataTable`
while the first filtered request was pending. TanStack's row-model invalidation
schedules a pagination-state reset when the data reference changes. Passing
`rows ?? []` supplied another new reference on every loading render, feeding that
reset back into another render. A shared empty array stops this loop; the guarded
component regression also reproduces it without needing a large fixture.

Virtualization then bounds path/timestamp mounts, and an application-level Radix
provider removes a provider tree per tooltip. Relative timestamps still update and
absolute-time hover, keyboard and touch interactions retain their existing behavior.
