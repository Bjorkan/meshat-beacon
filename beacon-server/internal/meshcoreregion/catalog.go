// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Package meshcoreregion contains the built-in Swedish MeshCore region catalogue.
// Source: https://meshat.se/meshcore/regioner/#svenska-regionnivaer and its
// SCB county/municipality picker (Meshat.se, CC BY 4.0), captured 2026-09-26.
// These are radio transport labels, independent of MQTT IATA geography.
package meshcoreregion

import (
	_ "embed"
	"encoding/json"
	"strings"
)

type Region struct {
	Token       string `json:"token"`
	DisplayName string `json:"displayName"`
	ParentToken string `json:"parentToken"`
	Level       string `json:"level"`
}

//go:embed catalog.json
var data []byte

var catalogue = func() []Region {
	var regions []Region
	if err := json.Unmarshal(data, &regions); err != nil {
		panic(err)
	}
	return regions
}()

func All() []Region { return append([]Region(nil), catalogue...) }

func Lookup(token string) (Region, bool) {
	token = strings.TrimPrefix(token, "#")
	for _, region := range catalogue {
		if region.Token == token {
			return region, true
		}
	}
	return Region{}, false
}
