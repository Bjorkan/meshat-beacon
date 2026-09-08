// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Package radiopreset resolves Beacon radio presets against MeshCore's suggested radio settings
// catalogue. The catalogue is fetched once at startup (never per request, never from browsers)
// and retained in memory for the process lifetime. Startup failure leaves Beacon fully
// operational with raw preset labels.
//
// Display naming is keyed by normalized (frequency, bandwidth, spreading factor) only.
// Coding rate is deliberately excluded from the naming key: two radios with the same
// frequency/bandwidth/SF share the same suggested title even when their coding rates differ.
// Multiple distinct titles sharing one triple are ambiguous: callers retain the raw
// radio configuration instead of inventing a combined catalogue title.
package radiopreset

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// MeshCoreConfigURL is the single upstream endpoint read once at startup.
const MeshCoreConfigURL = "https://api.meshcore.nz/api/v1/config"

// fetchTimeout bounds the one startup fetch so a hung upstream cannot stall boot.
const fetchTimeout = 10 * time.Second

// maxConfigBytes caps the startup response so a pathological upstream cannot OOM the server.
const maxConfigBytes = 1 << 20

// numericText accepts upstream numbers sent either as JSON strings ("62.5") or JSON
// numbers (62.5); both carry the same meaning for matching.
type numericText string

func (n *numericText) UnmarshalJSON(raw []byte) error {
	if len(raw) > 0 && raw[0] == '"' {
		var value string
		if err := json.Unmarshal(raw, &value); err != nil {
			return err
		}
		*n = numericText(value)
		return nil
	}
	var value json.Number
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	if _, err := value.Float64(); err != nil {
		return err
	}
	*n = numericText(value.String())
	return nil
}

type upstreamEntry struct {
	Title           string      `json:"title"`
	Frequency       numericText `json:"frequency"`
	SpreadingFactor numericText `json:"spreading_factor"`
	Bandwidth       numericText `json:"bandwidth"`
	// coding_rate is intentionally absent: it never participates in display naming.
}

// radioKey is the naming identity. Frequency/bandwidth use float32 so the catalogue
// normalizes to the same precision Beacon stores in PostgreSQL REAL: the decimal
// "869.618" and its float32 round-trip resolve to one key.
type radioKey struct {
	frequency, bandwidth float32
	sf                   int
}

// Catalogue is the startup-loaded snapshot of suggested radio settings.
type Catalogue struct {
	titles map[radioKey][]string
	count  int
}

// Fetcher abstracts the HTTP GET so tests inject a fake source; production passes nil to use the
// default client against MeshCoreConfigURL. The fetcher receives the same bounded context and
// must return the full config response body; tests never contact the real endpoint.
type Fetcher func(ctx context.Context, url string) ([]byte, error)

func defaultFetch(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("meshcore config: unexpected status %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxConfigBytes+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > maxConfigBytes {
		return nil, fmt.Errorf("meshcore config: response exceeds %d bytes", maxConfigBytes)
	}
	return raw, nil
}

// Load fetches the catalogue once. On any failure it logs a bounded warning and returns an empty
// catalogue so Beacon keeps serving raw labels — startup must never fail because of this.
func Load(ctx context.Context, fetch Fetcher) *Catalogue {
	ctx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()
	if fetch == nil {
		fetch = defaultFetch
	}
	raw, err := fetch(ctx, MeshCoreConfigURL)
	if err == nil && len(raw) > maxConfigBytes {
		err = fmt.Errorf("meshcore config: response exceeds %d bytes", maxConfigBytes)
	}
	var body struct {
		Config struct {
			Suggested struct {
				Entries *[]upstreamEntry `json:"entries"`
			} `json:"suggested_radio_settings"`
		} `json:"config"`
	}
	if err == nil {
		err = json.Unmarshal(raw, &body)
	}
	if err == nil && body.Config.Suggested.Entries == nil {
		err = fmt.Errorf("meshcore config: missing suggested_radio_settings.entries")
	}
	if err != nil {
		log.Printf("radiopreset: startup catalogue unavailable, using raw labels: %.160q", err.Error())
		return &Catalogue{}
	}
	cat := &Catalogue{titles: make(map[radioKey][]string)}
	for _, e := range *body.Config.Suggested.Entries {
		f, err1 := strconv.ParseFloat(strings.TrimSpace(string(e.Frequency)), 64)
		b, err2 := strconv.ParseFloat(strings.TrimSpace(string(e.Bandwidth)), 64)
		sf, err3 := strconv.ParseFloat(strings.TrimSpace(string(e.SpreadingFactor)), 64)
		title := strings.TrimSpace(e.Title)
		if err1 != nil || err2 != nil || err3 != nil || sf != math.Trunc(sf) || title == "" {
			continue
		}
		key, valid := keyFor(f, b, int(sf))
		if !valid {
			continue
		}
		cat.titles[key] = append(cat.titles[key], title)
		cat.count++
	}
	for key, titles := range cat.titles {
		sort.Strings(titles)
		unique := titles[:0]
		for _, title := range titles {
			if len(unique) == 0 || unique[len(unique)-1] != title {
				unique = append(unique, title)
			}
		}
		cat.titles[key] = unique
	}
	return cat
}

func keyFor(f, b float64, sf int) (radioKey, bool) {
	key := radioKey{frequency: float32(f), bandwidth: float32(b), sf: sf}
	if math.IsNaN(f) || math.IsNaN(b) || math.IsInf(f, 0) || math.IsInf(b, 0) {
		return radioKey{}, false
	}
	if math.IsInf(float64(key.frequency), 0) || math.IsInf(float64(key.bandwidth), 0) {
		return radioKey{}, false
	}
	if f <= 0 || b <= 0 || sf < 5 || sf > 12 {
		return radioKey{}, false
	}
	return key, true
}

// Match resolves a preset by normalized frequency/bandwidth/SF. Coding rate never
// participates: entries differing only by coding rate share one title. Genuinely
// distinct titles for one triple return "", as do unknown configurations.
func (c *Catalogue) Match(freqMHz, bwKHz float64, sf int) string {
	if c == nil {
		return ""
	}
	key, valid := keyFor(freqMHz, bwKHz, sf)
	if !valid {
		return ""
	}
	titles := c.titles[key]
	if len(titles) != 1 {
		return ""
	}
	return titles[0]
}

// Len reports the catalogue size (tests and startup logging).
func (c *Catalogue) Len() int {
	if c == nil {
		return 0
	}
	return c.count
}
