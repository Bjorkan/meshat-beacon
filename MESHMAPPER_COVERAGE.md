# MeshMapper Coverage API — integrationsnoteringar

Källa: `https://wiki.meshmapper.net/coverage-api/` samt verifierat live-svar
mot region `SWE` (2026-09-05, schema v2).

Syfte: underlag för en framtida Beacon-integration som hämtar, validerar,
cachad och exponerar täckningsdata via Beacons eget API. Denna fil innehåller
**ingen API-nyckel** — nyckeln ska endast lagras som hemlighet i
servermiljön (t.ex. miljövariabel) och aldrig i kod, fil eller logg.

## Endpoint och autentisering

- `GET https://meshmapper.net/coverage.php?key=YOUR_API_KEY`
- Valfri sektion: `?include=repeaters` (returnerar top-level `repeaters`).
- Varje nyckel är bunden till **en region**. `SWE` är **multiregionen Sverige**
  och inkluderar alla IATA-områden i hela Sverige — svaret är alltså redan det
  sammanslagna svenska rutnätet (samma payloadform som en enkel region, inga
  extra `regions`/`regions_skipped`-fält).
- Kvot **100 requests/dag** per nyckel.
- **Viktigt:** kvoten räknas även vid cache-träffar och `304 Not Modified`.
- Nyckelhantering (adminpanel): en nyckel per administratör och region,
  beskrivning obligatorisk, **Regenerate** ogiltigförklarar gamla nyckeln direkt.

## Cachning och polling (måste respekteras)

- `Cache-Control: public, max-age=900` — servern cachar ca **15 minuter**.
- `ETag` + `Last-Modified` stöds. Skicka `If-None-Match: "<etag>"` för att få
  `304 Not Modified` med tom body vid oförändrad data.
- Skicka `Accept-Encoding: gzip` (de flesta klienter gör det automatiskt);
  payload är grovt **9× mindre** komprimerad.
- Rekommenderat poll-intervall: **≥ 15 minuter**. Tätare polling ger identisk
  data men förbrukar ändå dygnskvot.
- `generated_at` anger när det cachade svaret byggdes.
- `data_age_seconds` anger sekunder mellan senaste pingen och byggtid
  (färskhetsindikator; `null` om regionen saknar data).

## Verifierat live-svar för SWE (2026-09-05)

- `success: true`, `region: "SWE"`, `region_name: "SWE"` (obs: regionnamnet är
  f.n. bara koden, inget läsbart namn).
- `schema_version: 2`, `grid_size: { lat: 0.0027, lon: 0.00384 }` (~300 m celler).
- `total_squares: 85077`, `point_count: 594229` (okodat ~2,8 MB gzippat).
- `bbox: { minLat: 55.34, minLon: 11.02, maxLat: 66.76, maxLon: 22.16 }`
  (täckning över Sverige).
- `data_age_seconds: 2153` (~36 min gammalt vid mättillfället).
- `type_bits: { BIDIR: 1, TX: 2, RX: 4, DISC: 8, DEAD: 16, DROP: 32 }`.
- `coverage_type_counts`: övervägande `DROP` (56994), därefter `BIDIR` (16252),
  `DISC` (7143), `TX` (2331), `RX` (1609), `DEAD` (748).
- `include=repeaters` ger `repeaters` med **1821 poster** (se fält nedan).
- `repeaters`-fält har inga nulls i något fält (verifierat över alla 1821).
  `advert_bytes`-fördelning: 2 (728), 3 (581), 1 (512) — användbar för
  multibyte-analys. `enabled: 2` (flaggad ID-kollision) hos **456 av 1821** —
  en fjärdedel av listan är tvetydig identitet och bör hanteras/filtreras i UI.

## Top-level-fält

| Fält                   | Typ         | Beskrivning                                 |
| ---------------------- | ----------- | ------------------------------------------- |
| `success`              | bool        | `true` vid lyckat svar.                     |
| `region`               | string      | Regionskod nyckeln är scopad till.          |
| `region_name`          | string      | Läsbart namn (kan vara bara koden).         |
| `grid_size`            | objekt      | Cellstorlek i grader (`lat`, `lon`).        |
| `schema_version`       | int         | Schemat är additivt — ignorera okända fält. |
| `generated_at`         | int         | Unix-tid då svaret byggdes.                 |
| `data_age_seconds`     | int/null    | Färskhet; `null` om ingen data.             |
| `total_squares`        | int         | Antal returnerade celler.                   |
| `point_count`          | int         | Totalt antal aggregerade pingar.            |
| `coverage_type_counts` | objekt      | Antal celler per dominant `coverage_type`.  |
| `type_bits`            | objekt      | Legend för att avkoda `status_mask`.        |
| `bbox`                 | objekt/null | Yttre begränsningsbox; `null` om tomt.      |
| `grid_squares`         | array       | Cellista (se nedan).                        |
| `repeaters`            | array       | Endast vid `?include=repeaters`.            |

## Cellfält (`grid_squares[]`)

| Fält                          | Typ        | Beskrivning                                                   |
| ----------------------------- | ---------- | ------------------------------------------------------------- |
| `grid_id`                     | string     | Unikt cell-ID, format `"latIndex_lonIndex"`.                  |
| `bounds`                      | objekt     | `south/west/north/east` i decimalgrader — rita som rektangel. |
| `coverage_type`               | string     | Dominant typ: `BIDIR/TX/RX/DISC/DEAD/DROP`.                   |
| `fill_color` / `border_color` | string     | Hexfärger som matchar MeshMappers karta.                      |
| `snr`                         | float/null | Medel-SNR (dB) i cellen.                                      |
| `snr_min` / `snr_max`         | float/null | Lägsta/högsta SNR i cellen.                                   |
| `timestamp`                   | int/null   | Dominanta (nyaste/högst prioriterade) pingens tid.            |
| `first_seen`                  | int/null   | Äldsta pingens tid i cellen.                                  |
| `count`                       | int        | Antal pingar i cellen (konfidens/täthet).                     |
| `noise`                       | float/null | Medelbrus (dB över mottagarens brusgolv).                     |
| `effective`                   | float      | Medelkvalitet **0–3** (se nedan).                             |
| `status_mask`                 | int        | Bitmask av **alla** typer i cellen (se nedan).                |

## Repeaterfält (`repeaters[]`, endast `?include=repeaters`)

| Fält           | Typ         | Beskrivning                                                |
| -------------- | ----------- | ---------------------------------------------------------- |
| `hex`          | string      | Repeaterns hex-ID (prefix).                                |
| `name`         | string/null | Repeaternamn.                                              |
| `lat` / `lon`  | float/null  | Position.                                                  |
| `last_heard`   | int/null    | Unix-tid då repeatern senast hördes.                       |
| `enabled`      | int         | `1` = aktiv, `2` = flaggad för ID-kollision (listas ändå). |
| `advert_bytes` | int/null    | Adverterad path-ID-bredd i bytes.                          |

## Täckningstyper, kvalitet och statusmask

Dominant `coverage_type` = högst prioriterad ping i cellen:

| Typ     | Färg             | Prioritet | Betydelse                     |
| ------- | ---------------- | --------- | ----------------------------- |
| `BIDIR` | grön `#1e7e34`   | 6         | Tvåvägs bekräftad länk.       |
| `DISC`  | cyan `#17a2b8`   | 5         | Discovery/trace-paket.        |
| `TX`    | orange `#fd7e14` | 4         | Sänt men ej hört tillbaka.    |
| `RX`    | lila `#6f42c1`   | 3         | Hörd trafik, utan att sända.  |
| `DEAD`  | grå `#6c757d`    | 2         | Repeater hörd men ingen rutt. |
| `DROP`  | röd `#bd2130`    | 1         | Ingen förbindelse.            |

- `effective` = medel av poäng per ping: `BIDIR=3`, `TX/RX/DISC=2`,
  `DEAD=1`, `DROP=0`. En ren `BIDIR`-cell får `3.0`. Lämpar sig för en mjuk
  röd→grön gradient där `coverage_type` ensamt bara visar bästa pingen.
  Exempel från live-svar: `effective: 1.93` vid blandad cell.
- `status_mask` = bitvis OR av `type_bits` för alla typer i cellen, t.ex.
  `37 = 1 (BIDIR) + 4 (RX) + 32 (DROP)`. Avkoda alltid mot svarets
  `type_bits`-legend, inte hårdkodade värden.

## Ritning

- Varje cell ritas som rektangel av `bounds`
  (`[south, west]` → `[north, east]`), med `fill_color`/`border_color`
  (exempel: fyll 0.6 opacitet, vikt 1).
- Rutnätet är fasta ~300 m-celler och matchar MeshMappers Simplified Mode.

## Felkoder

| HTTP | `error`               | Betydelse                                                 |
| ---- | --------------------- | --------------------------------------------------------- |
| 400  | `missing_key`         | Ingen nyckel angiven.                                     |
| 400  | `invalid_region`      | Regionskod på nyckeln saknas.                             |
| 401  | `invalid_key`         | Nyckeln hittades inte.                                    |
| 403  | `no_region`           | Ingen region kopplad till nyckeln.                        |
| 429  | `rate_limit_exceeded` | Dygnskvot nådd (svarar med `limit/used/resets_in_hours`). |
| 429  | `rate_limited`        | Per-IP-burstskydd; sprid ut anrop.                        |
| 500  | `server_error`        | Internt fel.                                              |

## Multi-region- och globala nycklar

- `SWE` är en **multiregion-nyckel** (Sverige): flera regioners grid sammanslaget
  till **ett** rutnät med samma payloadform som en enkel region — plus att
  `region`-fältet kan bära den normaliserade medlemsuppsättningen. Utfärdas av
  MeshMapper-teamet, ej självbetjäning (max 6 medlemsregioner; för stor
  medlemsuppsättning ger `507 over_memory_budget`, okänd medlem ger
  `400 invalid_region` utan partiellt svar).
- Globala nycklar returnerar ett kuvert med en sektion per region
  (`global: true`, `regions[]`, `region_count`, `regions_skipped`), cachas i
  **6 timmar** (`max-age=21600`), avsedd polling 1–2 ggr/dag, kan ta ~1 minut
  att bygga vid cache-miss (streamas regionvis). Ingen paginering — använd
  stream-parsning och `If-None-Match`.

## Kända begränsningar (verifierade mot live-API 2026-09-05)

1. **Ingen bbox-filtrering.** Parametrar som `minLat/maxLat/minLon/maxLon`
   ignoreras tyst — svaret returnerar alltid hela regionen (för SWE: 85077
   celler, ~26 MB okodat / ~2,8 MB gzippat). En kartvy över ett län kräver att
   Beacon själv filtrerar/skär celler serverside.
2. **Ingen cell→repeater-koppling.** Grid-cellerna säger _var_ täckning finns,
   `repeaters` säger _var_ repeatrar står — inget fält binder dem. "Täckning
   för repeater X" kan inte byggas från detta API ensamt.
3. **SNR saknas i ~45 % av cellerna** (894/2000 i stickprov). `timestamp`,
   `first_seen` och `noise` finns alltid; signalstyrka-per-position är alltså
   bara halv täckning.
4. **`enabled: 2` hos 456/1821 repeaters** — se repeaternoteringen ovan.
5. **`region_name` är bara `"SWE"`** — inget läsbart namn att visa i UI.
6. **`fresh=1` tvingar ingen ny data** på regional nyckel (samma
   `total_squares`, bara nyare `generated_at`); dokumentationen nämner
   parametern endast som icke-stödd på multi/global (`400 fresh_not_supported`).

## Rekommendationer för Beacon-integrationen

1. **Endast serversidan.** Nyckeln får aldrig skickas till webbläsaren eller
   läggas i webbläsbart config-svar. Hämta med `http.Client` med ändlig timeout.
2. **Cacha aggressivt.** Minst 15 minuters TTL, återanvänd `ETag`, räkna med att
   även `304` kostar kvot — proxya aldrig varje frontend-anrop rakt igenom.
3. **Validera innan cachning.** Kontrollera statuskod och JSON-form
   (`success`, `grid_squares`-array) så skräp aldrig cachas.
4. **Typa datat.** Exponera typade fält till handlern, inte `map[string]any`.
   Logga eller returnera aldrig nyckeln.
5. **Filtrera serverside.** Eftersom API:t saknar bbox-stöd måste Beacon själv
   skära det svenska totalgriddet mot vy/IATA-bbox innan det exponeras —
   annars skickas alltid ~26 MB okodat (~2,8 MB gzippat) per vy.
6. **Begränsning att känna till:** det dokumenterade grid-svaret kopplar **inte**
   celler till enskild repeater — `repeaters` är en separat lista. Övergripande
   täckning (effective) och pingålder (`timestamp`/`first_seen`,
   `data_age_seconds`) kan byggas direkt; täckning per repeater kräver annan
   datakälla.
7. **Använd `effective` + `count` för lager:** `effective` för färggradient,
   `count` för konfidens, `timestamp`/`data_age_seconds` för ålder
   (ping age), `status_mask` för blandade celler. Räkna med att `snr` saknas i
   ~45 % av cellerna — gradienten får inte bero enbart på SNR.
