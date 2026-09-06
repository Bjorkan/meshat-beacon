# Visuella buggar – beacon.meshat.se

Granskad med Playwright mot https://beacon.meshat.se (produktion, kör denna source).
App-version i footer: **v1.2.1**. Datum: 2026-09-06.

**Metod:** Desktop 1440×900 och mobil 390×900, mörkt + ljust tema, svenska + engelska.
Alla 8 flikar (Paket, Kanaler, Karta, Noder, Observatörer, Rutter, Traces, Analysinkl. underflikarna Mesh/Sändare/Klockavvikelse/Observatör/Granngraf), expanderade paketrader,filterdropdowns, regionväljare, detaljpaneler för nod/observatör/rutt, språkbyte ochnonexistent route (404). Ingen horisontell overflow hittades på någon flik
(`document.documentElement.scrollWidth == window.innerWidth` på samtliga).

## Sammanfattning

| #   | Fyndkategori                                                       | Vy                                        | Allvar |
| --- | ------------------------------------------------------------------ | ----------------------------------------- | ------ |
| 1   | Relativ tid radbryts till två rader (`för 0s / sedan`)             | Paket (Ålder), Rutter (Först/Senast sedd) | P1     |
| 2   | Sorteringspilar på **alla** kolumner samtidigt                     | Noder, Observatörer, Rutter               | P1     |
| 3   | Trace-kort visar lös `-`-rad + stora tomma ytor                    | Traces (desktop + mobil)                  | P1     |
| 4   | Klockavvikelse visar absurda värden (`+527515h 23m före`)          | Analys → Klockavvikelse                   | P1     |
| 5   | Rutt-detalj visar varje nodnamn **två gånger** (`#1 [pill] namn`)  | Rutter detaljpanel                        | P1     |
| 6   | SNR visas rött även för positiva värden (ingen bra/dålig-skillnad) | Paket expanderad rad                      | P2     |
| 7   | Radio-kolumnen är ~99 % `—`, Grannar ~allt `0` (bruskolumner)      | Noder                                     | P2     |
| 8   | `0 MHz · SF0 · 0 kHz` upprepas som "data", tom IATA-kolumn         | Observatörer                              | P2     |
| 9   | Identiska namn utan särskiljning (`KiekR_hepp` ×2 m.fl.)           | Observatörer (även Sändare-tabellen)      | P2     |
| 10  | Tom state `Välj en kanal` – stor död yta utan hjälp/CTA            | Kanaler                                   | P2     |
| 11  | Tom state `Välj en region` – död ände utan inline-åtgärd           | Analys → Granngraf                        | P2     |
| 12  | 404-sidan visar bara `404`, ingen väg tillbaka                     | Okänd route                               | P2     |
| 13  | Kluster-underetiketter oläsliga + kluster klipps i kant/footer     | Karta (desktop + mobil)                   | P2     |
| 14  | `Laddar noder… (N)`-piller flyter över tabell/kluster              | Noder detalj, Karta                       | P2     |
| 15  | Payload-typer: etiketter/valörer kolliderar (`43.5k35.8k…`)        | Analys → Mesh                             | P2     |
| 16  | KPI-kort inkonsekventa (2 av 4 saknar sparkline)                   | Analys → Mesh                             | P3     |
| 17  | `BROKERS: MQTT1` med röd fel-badge (bara ett namn)                 | Observatör detalj                         | P3     |
| 18  | `efter namn`-etikett på värdesorterad topplista + dublettnod       | Analys → Sändare                          | P2     |
| 19  | Inledande `·`-separator när IATA saknas (`· meshcore/…`)           | Observatörer mobil                        | P2     |
| 20  | `Färst grannar`-chips – korrekt men obegriplig copy                | Noder mobil                               | P3     |
| 21  | DIRECT-rader duplicerar `0h` i två kolumner                        | Paket                                     | P3     |
| 22  | Expanderad meta-rad: gement `observatör`, hopträngd                | Paket expanderad rad                      | P3     |
| 23  | `TRAN… #se08` – rutt-typ trunkeras                                 | Paket (Rutt-kolumn)                       | P3     |
| 24  | X-axel `31, Sep, 2…` (månadsbrytning), `200 taggar`-jargong        | Analys/Traces                             | P3     |
| 25  | Ljust läge: IATA-konturer svaga mot ljus terräng                   | Karta ljust läge                          | P3     |

---

## P1 – bör fixas först

### 1. Relativ tid radbryts (`för 0s / sedan`)

- **Vy:** Paket → kolumnen `Ålder`; Rutter → `Först sedd` / `Senast sedd`.
- **Observation:** Ålderscellerna är så smala att `för 0s sedan` bryts till två rader
  (`för 0s` / `sedan`). Syns på Paket (alla DIRECT-rader) och Rutter
  (`för 16s / sedan`, `för 33d / sedan`). Ger ryckiga radhöjder och en
  trasig högermarginal.
- **Repro:** Öppna `/packets` eller `/routes` på 1440px, titta på högerkolumnerna.
- **Rekommendation:** `white-space: nowrap` på tids-/åldersceller (och gärna
  fastare kolumnbredd). Gäller även `Hopp · Hash` (`0h · 3B` klarar sig idag men
  ligger nära gränsen).

### 2. Sortpilar på alla kolumner samtidigt

- **Vy:** Noder (`Namn ▲ Typ ▲ Radio ▲ Grannar ▲`), Observatörer
  (`Namn ▲ Typ ▲ Radio ▲ IATA ▲ Status ▲`), Rutter
  (`IATA ▲ Hopp ▲ … Obs ▲ Först sedd ▲ Senast sedd ▼`).
- **Observation:** Varje sorterbart huvud visar `▲` samtidigt; bara ett är aktivt
  (grönt). Det går inte att se om det är multi-sort eller vilken kolumn som styr.
  På Rutter är `Senast sedd ▼` aktiv men resten visar ändå `▲`.
- **Repro:** Öppna `/nodes`, `/observers`, `/routes`, titta på tabellhuvudet.
- **Rekommendation:** Visa pil endast på aktiv sortering; inaktiva huvuden får
  `↕`/ingen indikator (med hover-affordance).

### 3. Trace-kort: lös `-`-rad och slöseri med yta

- **Vy:** `/traces`, desktop + mobil.
- **Observation:** Varje kort visar sökvägschip (t.ex. `AB`) och undertill en ensam
  `-` på egen rad. I DOM:et ligger ett `"-"` (aria-hidden) efter varje nod –
  avsett som SNR-plats men renderas som innehåll. PING-kort blir ~100 px höga för
  i praktiken ett chip + ett bindestreck; högerhalvan av kortet är tom sånär som
  på åldern.
- **Repro:** Öppna `/traces`, titta på valfritt PING-kort (`68340941`, `75E4527E` …).
- **Rekommendation:** Dölj `-`-plats­hållaren när SNR saknas (eller visa `–` inline
  i chipet), och komprimera kortlayouten (ålder + `pkt · IATA` på en metarad).

### 4. Klockavvikelse visar århundraden av drift

- **Vy:** Analys → Klockavvikelse.
- **Observation:** Värden som `+527515h 23m före`, `-496759h 5m efter`
  (≈ 60 år). Det är antingen felaktig data som visas o-humaniserad, eller trasig
  beräkning – oavsett ser tabellen trasig ut. `före`/`efter` är dessutom båda röda,
  så ingen allvarlighetsgradering syns.
- **Repro:** Öppna `/analytics?statsTab=clockdrift` (samma på engelska:
  `+527515h 23m ahead`).
- **Rekommendation:** Humanisera (`> Xd` → `> 99d` / flagga som ogiltig), filtrera
  orimliga värden, färgkoda allvarlighetsgrad.

### 5. Rutt-detalj upprepar varje nodnamn två gånger

- **Vy:** Rutter → detaljpanel (`RUTTDETALJER`).
- **Observation:** Steglistan visar `#1 [grönt pill: SE-KAM-Fjölebro] SE-KAM-Fjölebro`,
  alltså pill + samma namn i klartext på varje rad. Ser ut som ett renderingsfel
  och dubblar panelbredden i onödan.
- **Repro:** Öppna `/routes`, klicka första raden.
- **Rekommendation:** Visa antingen pill eller klartext (behåll klartext vid behov
  av kopiering), inte båda.

---

## P2 – märkbara brister

### 6. SNR alltid röd, även positiv

- **Vy:** Paket → expanderad observations­tabell (kolumnen `SNR`).
- **Observation:** `-9.80`, `-10.50`, `-9.00` **och** `+1.20` renderas alla i röd ton.
  Färgen signalerar alltså inte bra/dåligt.
- **Repro:** `/packets` → expandera ett FLOOD-paket (t.ex. `E95F6A9D`).
- **Rekommendation:** Tröskla färgen (t.ex. grön ≥ 0, neutral/gul svagt negativ,
  röd under tröskel) eller ta bort färgkodningen.

### 7. Noder: Radio- och Grannar-kolumnerna är brus

- **Vy:** `/nodes`.
- **Observation:** `Radio` visar `—` på i princip alla rader (enda undantaget i
  stickprovet hade `869.618 MHz · SF8 · 62.5 kHz`). `Grannar` visar `0` överallt
  utom en enstaka `1`. Två av sex kolumner bär nästan ingen information men tar
  full bredd.
- **Rekommendation:** Dölj `Radio` när den saknas (eller ersätt med kompakt ikon
  endast där data finns), och tona ned `0`-värden eller gör Grannar till
  sekundär info.

### 8. Observatörer: noll-radio och tom IATA-kolumn

- **Vy:** `/observers`.
- **Observation:** Många rader visar `0 MHz · SF0 · 0 kHz` – en noll-state som ser
  ut som mätdata. IATA-kolumnen är tom för merparten av raderna.
- **Rekommendation:** Visa `—`/`okänd` för saknad radio (både sv/en), överväg att
  slå ihop Typ+Radio eller låt IATA vara ett chip endast där det finns.

### 9. Dubblettnamn utan särskiljning

- **Vy:** `/observers` (`KiekR_hepp` ×2 med MMX/VXO, `KiekR_hshahahaas` ×2,
  `KiekR_jonher_mobile` ×2, `KiekR_stiffe99` som både ONLINE och OFFLINE),
  Analys → Sändare (`SE-YST-Vallosa1SEN` på två rader med olika siffror).
- **Observation:** Samma visningsnamn på flera rader utan förtydligande (instans,
  ID-fragment, IATA). Användaren kan inte avgöra vad som är vad.
- **Rekommendation:** Lägg till särskiljande sekundärinfo (kort-ID, IATA-chip,
  `online`-state) i namnscellen.

### 10. Kanaler: död tomyta innan val

- **Vy:** `/channels` utan vald kanal.
- **Observation:** Högerpanelen är en stor tom yta med endast centrerad texten
  `Välj en kanal`. Ingen ikon, ingen förklaring, ingen CTA.
- **Rekommendation:** Riktigt empty-state (ikon, 1–2 rader hjälptext, ev. "välj
  Public"-knapp). Samma mönster gäller embed-vyn implicit.

### 11. Granngraf: död ände för standardvyn

- **Vy:** Analys → Granngraf (`/analytics?statsTab=graph`).
- **Observation:** Hela ytan är ett tomt mörkt fält med `Välj en region` + en
  förklaring. Åtgärden (regionväljaren i headern) finns inte inline – användaren
  måste själv lista ut var den finns.
- **Rekommendation:** Lägg region/IATA-väljare (eller snabbknappar till vanligaste
  IATA) direkt i empty-statet.

### 12. Bar 404 utan väg tillbaka

- **Vy:** Okänd route (testat `/nonexistent-route-xyz`).
- **Observation:** Sidans main-innehåll är endast `404`. Ingen länk hem, ingen
  lista över flikar, URL:en behålls. Header/nav syns visserligen, men själva
  felvyn ger ingen hjälp.
- **Rekommendation:** Ordentlig 404-vy (rubrik, förklaring, `Tillbaka till Paket`).

### 13. Kartkluster: oläsliga underetiketter + klippning

- **Vy:** `/map` desktop + mobil.
- **Observation:**
  - Klusterbubblor innehåller pyttesmå färgade underetiketter (`R34 M1` m.fl.,
    ~8 px) som inte går att läsa och krockar visuellt.
  - Sydligaste klustret (`22`) klipps av footern/vyportkanten (desktop mörkt läge).
  - Mobil: kluster klipps i vänster/högerkant (`40` halv utanför), och
    `Laddar noder… (1600)` + `LIVE`-piller trängs med kluster i underkant.
- **Repro:** `/map` desktop (zooma till Sverigenivå), `/map` på 390 px.
- **Rekommendation:** Ta bort/simplify underetiketter under viss zoom (tooltip vid
  klick istället), lägg till kart-padding mot footer och viewportkanter på mobil.

### 14. Flytande `Laddar noder…`-piller över innehåll

- **Vy:** Noder detaljpanel (`Laddar noder… (50)` ligger över sista tabellraden),
  Karta (`Laddar noder… (701/1308/1600)` över kluster och `LIVE`-knappen på mobil).
- **Rekommendation:** Flytta loadern till icke-överlappande yta (tabellfot /
  kartans övre kant) eller reservera plats i layouten.

### 15. Payload-typer: etiketter och värden kolliderar

- **Vy:** Analys → Mesh → `PAYLOAD-TYPER · 7D`.
- **Observation:** Diagonala x-etiketter (`group_text, request, advert…`) sitter
  tätt och värdena ovanför små staplar flyter ihop (`43.5k35.8k30.7k…`), oläsligt.
- **Rekommendation:** Dölj värden under tröskel (visa i tooltip), förkorta
  etiketter, eller byt till horisontella staplar.

### 18. Sändare: missvisande `efter namn` + dublett

- **Vy:** Analys → Sändare (`?statsTab=talkers`).
- **Observation:** Högra panelen `FRÄMSTA SÄNDARE · 7D` är märkt `efter namn` men
  sorterad efter värde fallande. Vänstra tabellen visar `SE-YST-Vallosa1SEN`
  (SENSOR) på två rader med olika Flood/Direct-siffror.
- **Rekommendation:** Rätta etiketten (sorteringskontroll eller ta bort), slå ihop
  eller särskilj dublett­raderna.

### 19. Mobil Observatörer: lös `·`-separator

- **Vy:** `/observers` på 390 px.
- **Observation:** Rader utan IATA inleds med `·` (`· meshcore/v1.16.0.35-…`),
  ett hängande avgränsartecken där IATA-chipet borde vara.
- **Rekommendation:** Bygg mobilraden utan tomma segment (villkorlig separator).

---

## P3 – puts

- **16. KPI-kort inkonsekventa.** `TOTALT ANTAL PAKET` och `AKTIVA IATA` saknar
  sparkline medan `OBSERVATIONER`/`AKTIVA OBSERVATÖRER` har det. Välj ett mönster.
- **17. `MQTT1`-badge röd i Observatör-detalj.** Rött signalerar fel men är bara
  ett brokernamn (`Sedd för 24d sedan`). Byt till neutral färg.
- **20. `Färst grannar`-chips (mobil Noder).** Grammatiskt försvarbart
  (superlativ av "få") men obegripligt för de flesta – överväg `Minst grannar`.
- **21. DIRECT-rader duplicerar `0h`.** `Sökväg: 0h · direct` + `Hopp · Hash:
0h · 1B`. Visa `direct` utan `0h`-prefix.
- **22. Expanderad paketmeta hopträngd.** `observatör X Första … Senaste …
spridning …` – gement inledningsord, ojämna mellanrum. Typografisk puts.
- **23. `TRAN… #se08`.** Rutt-typen `TRANSPORT_FLOOD` trunkeras med ellipsis i
  Paket-tabellen. Ge kolumnen mer plats eller förkorta kontrollerat (`TRANSPORT`).
- **24. Axel/copy-jargong.** Mesh-grafens x-axel visar `31, Sep, 2…` vid
  månadsskifte; Traces-rubriken `200 taggar` är internt jargong (överväg
  `spår`/`traces` på svenska).
- **25. Ljust läge karta.** Gröna IATA-konturer försvinner bitvis mot ljus terräng
  i norr; klusterbubblorna är kolsvarta mot ljus karta (stilbrott, dock läsbara).

---

## Positiva fynd (behåll)

- Ingen horisontell overflow på någon av de 8 flikarna (1440 px).
- Tema­växlaren fungerar åt båda håll; ljusläget är genomgående läsbart
  (tabeller, badges, detaljpaneler, QR, minikarta).
- Wordmarken följer temat (synlig i båda lägena).
- Mobilskalet fungerar: bottom-nav med `Mer`-overflow, filter blir sök + Filter-knapp,
  tabeller blir kort, Analys får sektionsväljare + 2×2 KPI-grid.
- Filterdropdown (Typer) och regionväljare: sökfält med fokus­ring, `Alla/Ingen`,
  kryssrutor – gediget.
- Live-flöde, språkbyte (sv→en översätter flikar + filter) och detaljnavigering
  (nod/observatör/rutt-URL:er) fungerar.

## Repro-miljö (kort)

- `https://beacon.meshat.se/{packets,channels,map,nodes,observers,routes,traces,analytics}`
- Underflikar: `/analytics?statsTab={mesh,talkers,clockdrift,observer,graph}`
- Detalj: klicka tabellrad på `/nodes`, `/observers`, `/routes`; expandera rad på `/packets`
- Mobil: viewport 390×900 (`lg:`-brytpunkten vid 1024 styr kompakt skal)
- Tema: sol/mån-knappen i headern; språk: `SV`-väljaren; 404: valfri okänd path
