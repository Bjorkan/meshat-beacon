// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"sort"
	"strings"
)

// NodePathCollection binds a traversal cursor to the selected geographic filter.
func NodePathCollection(iatas []string) string {
	unique := make(map[string]bool)
	for _, iata := range iatas {
		unique[iata] = true
	}
	codes := make([]string, 0, len(unique))
	for code := range unique {
		codes = append(codes, code)
	}
	sort.Strings(codes)
	return "node-path-packets:" + strings.Join(codes, ",")
}
