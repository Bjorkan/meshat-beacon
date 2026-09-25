// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package handlers

import (
	"net/http"
)

const maxListLimit int32 = 1000

// parseLimit validates the requested result size while retaining each endpoint's default.
func parseLimit(r *http.Request, defaultLimit int32) (int32, error) {
	limit, err := parseResultLimit(r, defaultLimit)
	return int32(limit), err
}
