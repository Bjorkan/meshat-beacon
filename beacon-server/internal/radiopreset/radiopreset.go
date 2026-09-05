// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Package radiopreset resolves Beacon radio presets against MeshCore's suggested radio settings
// catalogue. The catalogue is fetched once at startup (never per request, never from browsers)
// and retained in memory for the process lifetime. Startup failure leaves Beacon fully
// operational with raw preset labels.
package radiopreset

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
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

type upstreamEntry struct {
	Title           string `json:"title"`
	Frequency       string `json:"frequency"`
	SpreadingFactor string `json:"spreading_factor"`
	Bandwidth       string `json:"bandwidth"`
	CodingRate      string `json:"coding_rate"`
}

// Entry is one normalized catalogue entry.
type Entry struct {
	Title           string
	FrequencyMHz    float64
	SpreadingFactor int
	BandwidthKHz    float64
	CodingRate      int
}

// Catalogue is the startup-loaded snapshot of suggested radio settings.
type Catalogue struct {
	entries []Entry
}

// Fetcher abstracts the HTTP GET so tests inject a fake source; production passes nil to use the
// default client against MeshCoreConfigURL.
type Fetcher func(ctx context.Context, url string) ([]byte, error)

func defaultFetch(ctx context.Context, url string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()
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
	var body struct {
		Config struct {
			Suggested struct {
				Entries []upstreamEntry `json:"entries"`
			} `json:"suggested_radio_settings"`
		} `json:"config"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(body.Config.Suggested.Entries)
	if err != nil {
		return nil, err
	}
	return raw, nil
}

// Load fetches the catalogue once. On any failure it logs a bounded warning and returns an empty
// catalogue so Beacon keeps serving raw labels — startup must never fail because of this.
func Load(ctx context.Context, fetch Fetcher) *Catalogue {
	if fetch == nil {
		fetch = defaultFetch
	}
	raw, err := fetch(ctx, MeshCoreConfigURL)
	if err != nil {
		log.Printf("radiopreset: startup catalogue unavailable, using raw labels: %v", err)
		return &Catalogue{}
	}
	var entries []upstreamEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		log.Printf("radiopreset: startup catalogue parse failed, using raw labels: %v", err)
		return &Catalogue{}
	}
	cat := &Catalogue{}
	for _, e := range entries {
		entry, err := normalize(e)
		if err != nil {
			continue
		}
		cat.entries = append(cat.entries, entry)
	}
	return cat
}

// LoadFromEntries builds a catalogue from already-parsed entries (tests and offline tooling).
func LoadFromEntries(raw []upstreamEntry) *Catalogue {
	cat := &Catalogue{}
	for _, e := range raw {
		entry, err := normalizeUpstream(e.Title, e.Frequency, e.SpreadingFactor, e.Bandwidth, e.CodingRate)
		if err != nil {
			continue
		}
		cat.entries = append(cat.entries, entry)
	}
	return cat
}

func normalize(e upstreamEntry) (Entry, error) {
	return normalizeUpstream(e.Title, e.Frequency, e.SpreadingFactor, e.Bandwidth, e.CodingRate)
}

func normalizeUpstream(title, freq, sf, bw, cr string) (Entry, error) {
	f, err := strconv.ParseFloat(strings.TrimSpace(freq), 64)
	if err != nil {
		return Entry{}, err
	}
	sfi, err := strconv.Atoi(strings.TrimSpace(sf))
	if err != nil {
		return Entry{}, err
	}
	b, err := strconv.ParseFloat(strings.TrimSpace(bw), 64)
	if err != nil {
		return Entry{}, err
	}
	c, err := strconv.Atoi(strings.TrimSpace(cr))
	if err != nil {
		return Entry{}, err
	}
	return Entry{Title: strings.TrimSpace(title), FrequencyMHz: f, SpreadingFactor: sfi, BandwidthKHz: b, CodingRate: c}, nil
}

// MatchResult describes how a Beacon preset maps to the catalogue.
type MatchResult struct {
	// Title is set only for a confident exact match. Multiple titles sharing identical complete
	// parameters are joined deterministically as "A / B" rather than picking array order.
	Title string
	// Ambiguous is true when the known fields match several catalogue entries that differ only
	// on fields Beacon did not record (e.g. missing coding rate). Callers keep the raw label.
	Ambiguous bool
}

// Match resolves a preset. freqMHz/bwKHz/sf always participate; codingRate participates only when
// known (non-nil): a nil CR that leaves several CR-distinct candidates must not claim a title.
func (c *Catalogue) Match(freqMHz float64, bwKHz float64, sf int, codingRate *int) MatchResult {
	var exact []Entry
	var partial []Entry
	for _, e := range c.entries {
		if e.FrequencyMHz != freqMHz || e.BandwidthKHz != bwKHz || e.SpreadingFactor != sf {
			continue
		}
		if codingRate != nil {
			if e.CodingRate == *codingRate {
				exact = append(exact, e)
			}
		} else {
			partial = append(partial, e)
		}
	}
	if codingRate != nil {
		if len(exact) == 0 {
			return MatchResult{}
		}
		titles := uniqueTitles(exact)
		return MatchResult{Title: strings.Join(titles, " / ")}
	}
	if len(partial) == 0 {
		return MatchResult{}
	}
	// Without CR we can only claim a title when every candidate agrees on all remaining fields
	// AND shares one title; differing CRs or differing titles mean ambiguous.
	crs := map[int]bool{}
	for _, e := range partial {
		crs[e.CodingRate] = true
	}
	titles := uniqueTitles(partial)
	if len(crs) == 1 && len(titles) == 1 {
		return MatchResult{Title: titles[0]}
	}
	return MatchResult{Ambiguous: true}
}

func uniqueTitles(entries []Entry) []string {
	seen := map[string]bool{}
	var out []string
	for _, e := range entries {
		if !seen[e.Title] {
			seen[e.Title] = true
			out = append(out, e.Title)
		}
	}
	sort.Strings(out)
	return out
}

// Len reports the catalogue size (tests and startup logging).
func (c *Catalogue) Len() int {
	if c == nil {
		return 0
	}
	return len(c.entries)
}
