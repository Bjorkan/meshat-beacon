package db

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	sqlc "github.com/MeshCore-Beacon/beacon-server/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestTracePayloadSelectionIntegration(t *testing.T) {
	url := os.Getenv("BEACON_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set BEACON_TEST_DATABASE_URL for PostgreSQL integration tests")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := "traces_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+pgx.Identifier{schema}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if _, err := admin.Exec(ctx, "DROP SCHEMA "+pgx.Identifier{schema}.Sanitize()+" CASCADE"); err != nil {
			t.Errorf("drop test schema: %v", err)
		}
	}()
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := RunMigrations(ctx, pool); err != nil {
		t.Fatal(err)
	}
	exec := func(t *testing.T, query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(t, "INSERT INTO iata_codes(iata) VALUES ('YVR')")
	nodeIDs := make([]uuid.UUID, 3)
	nodeNames := []string{"Alpha", "Bravo", "Charlie"}
	for i, prefix := range []string{"aabb0000", "ccdd0000", "eeff0000", "aa990000", "cc990000", "ee990000"} {
		id := uuid.New()
		name := "Collision"
		if i < len(nodeIDs) {
			nodeIDs[i] = id
			name = nodeNames[i]
		}
		exec(t, "INSERT INTO nodes(id,public_key,node_type,name) VALUES ($1,decode($2,'hex'),2,$3)", id, prefix+strings.Repeat("00", 28), name)
		exec(t, "INSERT INTO node_short_ids(node_id,iata,prefix_4) VALUES ($1,'YVR',decode($2,'hex'))", id, prefix)
	}
	payload := func(path, snrs string, flags byte) string {
		value := fmt.Sprintf(`{"type":"trace","flags":%d`, flags)
		if path != "" {
			value += `,"pathHashes":` + path
		}
		if snrs != "" {
			value += `,"snrValues":` + snrs
		}
		return value + "}"
	}
	path := `["aa","bb","cc"]`
	type packet struct {
		payload string
		last    time.Duration
		hash    byte
	}
	cases := []struct {
		name       string
		packets    []packet
		want       int
		rawOnly    bool
		resolution bool
	}{
		{
			name: "complete_inbound_snr_beats_empty_at_equal_length",
			packets: []packet{
				{payload(path, `[]`, 0), 2 * time.Hour, 1},
				{payload(path, `[null,4.5,-7]`, 0), time.Hour, 2},
			},
			want: 1,
		},
		{
			name: "complete_inbound_snr_beats_short_at_equal_length",
			packets: []packet{
				{payload(path, `[null,4.5]`, 0), 2 * time.Hour, 1},
				{payload(path, `[null,4.5,-7]`, 0), time.Hour, 2},
			},
			want: 1,
		},
		{
			name: "complete_inbound_snr_beats_missing_or_null_array",
			packets: []packet{
				{payload(path, "", 0), 3 * time.Hour, 1},
				{payload(path, `null`, 0), 2 * time.Hour, 2},
				{payload(path, `[null,4.5,-7]`, 0), time.Hour, 3},
			},
			want: 2,
		},
		{
			name: "longer_path_beats_complete_snr_on_shorter_path",
			packets: []packet{
				{payload(path, `[null,4.5,-7]`, 0), 2 * time.Hour, 1},
				{payload(`["aa","bb","cc","dd"]`, `[null,null,-3,null]`, 0), time.Hour, 2},
			},
			want: 1,
		},
		{
			name: "zero_is_numeric_snr_not_missing",
			packets: []packet{
				{payload(path, `[null,null,9]`, 0), 2 * time.Hour, 1},
				{payload(path, `[null,0,0]`, 0), time.Hour, 2},
			},
			want: 1,
		},
		{
			name: "null_origin_not_required_for_complete_inbound_snr",
			packets: []packet{
				{payload(path, `[99,4,-7]`, 0), time.Hour, 1},
				{payload(path, `[null,5,-8]`, 0), 2 * time.Hour, 2},
			},
			want: 1,
		},
		{
			name: "bogus_numeric_origin_does_not_outweigh_inbound_snr",
			packets: []packet{
				{payload(path, `[99,null,null]`, 0), 2 * time.Hour, 1},
				{payload(path, `[null,null,-8]`, 0), time.Hour, 2},
			},
			want: 1,
		},
		{
			name: "extra_snr_beyond_path_is_not_rewarded",
			packets: []packet{
				{payload(path, `[null,5,null,20,21,22]`, 0), 2 * time.Hour, 1},
				{payload(path, `[null,5,-8]`, 0), time.Hour, 2},
			},
			want: 1,
		},
		{
			name: "only_numeric_json_values_count",
			packets: []packet{
				{payload(`["aa","bb","cc","dd","ee","ff"]`, `[null,"8",true,{},[],null]`, 0), 2 * time.Hour, 1},
				{payload(`["aa","bb","cc","dd","ee","ff"]`, `[null,null,null,null,null,-1]`, 0), time.Hour, 2},
			},
			want:    1,
			rawOnly: true,
		},
		{
			name: "missing_path_has_length_zero",
			packets: []packet{
				{payload("", `[99,20,21]`, 0), 2 * time.Hour, 1},
				{payload(`["aa"]`, `[]`, 0), time.Hour, 2},
			},
			want: 1,
		},
		{
			name: "missing_and_empty_paths_tie_at_zero",
			packets: []packet{
				{payload("", `[99,20,21]`, 0), time.Hour, 1},
				{payload(`[]`, `[]`, 0), 2 * time.Hour, 2},
			},
			want: 1,
		},
		{
			name: "zero_inbound_counts_use_recency",
			packets: []packet{
				{payload(path, `[99,null,null]`, 0), time.Hour, 1},
				{payload(path, `[]`, 0), 2 * time.Hour, 2},
			},
			want: 1,
		},
		{
			name: "latest_last_heard_wins_equal_length_and_numeric_count",
			packets: []packet{
				{payload(path, `[null,5,-8]`, 0), time.Hour, 1},
				{payload(path, `[null,-2,7]`, 0), 2 * time.Hour, 2},
			},
			want: 1,
		},
		{
			name: "lowest_hash_wins_exact_tie_inserted_last",
			packets: []packet{
				{payload(path, `[null,5,-8]`, 0), time.Hour, 2},
				{payload(path, `[null,-2,7]`, 0), time.Hour, 1},
			},
			want: 1,
		},
		{
			name: "lowest_hash_wins_exact_tie_inserted_first",
			packets: []packet{
				{payload(path, `[null,-2,7]`, 0), time.Hour, 1},
				{payload(path, `[null,5,-8]`, 0), time.Hour, 2},
			},
			want: 0,
		},
		{
			name: "path_flags_snr_and_resolution_come_from_one_packet",
			packets: []packet{
				{payload(`["aa","cc","ee"]`, `[]`, 0), 2 * time.Hour, 1},
				{payload(`["aabb","ccdd","eeff"]`, `[null,0,-8]`, 1), time.Hour, 2},
			},
			want:       1,
			resolution: true,
		},
	}
	q := sqlc.New(pool)
	store := New(pool, 5*time.Minute, time.Hour, 0, 24*time.Hour, 7*24*time.Hour)
	base := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	for caseIndex, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tag := fmt.Sprintf("%08x", caseIndex+1)
			hashes := make([]string, len(tc.packets))
			for i, p := range tc.packets {
				hashes[i] = fmt.Sprintf("%08x%02x", caseIndex+1, p.hash)
				exec(t, `INSERT INTO packets(packet_hash,trace_tag,payload_type,payload_version,route_type,raw_payload,raw_header,parsed_payload,first_heard_at,last_heard_at)
					VALUES (decode($1,'hex'),decode($2,'hex'),9,0,1,'','',$3,$4,$5)`, hashes[i], tag, p.payload, base.Add(-time.Duration(i)*time.Minute), base.Add(p.last))
			}
			rows, err := q.ListTraceTags(ctx, sqlc.ListTraceTagsParams{Limit: 100})
			if err != nil {
				t.Fatal(err)
			}
			var best []byte
			for _, row := range rows {
				if row.TraceTag == tag {
					best = row.BestPayload
					if row.PacketCount != int64(len(tc.packets)) {
						t.Errorf("packet count = %d, want %d", row.PacketCount, len(tc.packets))
					}
				}
			}
			var gotJSON, wantJSON any
			if err := json.Unmarshal(best, &gotJSON); err != nil {
				t.Fatalf("BestPayload for %s: %v", tag, err)
			}
			if err := json.Unmarshal([]byte(tc.packets[tc.want].payload), &wantJSON); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(gotJSON, wantJSON) {
				t.Errorf("BestPayload = %s, want packet %s payload %s", best, hashes[tc.want], tc.packets[tc.want].payload)
			}
			if tc.rawOnly {
				return
			}
			var want struct {
				PathHashes []string   `json:"pathHashes"`
				SNRValues  []*float32 `json:"snrValues"`
			}
			if err := json.Unmarshal([]byte(tc.packets[tc.want].payload), &want); err != nil {
				t.Fatal(err)
			}
			items, err := store.ListTraceTags(ctx, nil, "", "", time.Time{}, time.Time{}, time.Time{}, 100)
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, item := range items {
				if item.TraceTag != tag {
					continue
				}
				found = true
				if !reflect.DeepEqual(item.PathHashes, want.PathHashes) {
					t.Errorf("summary path = %v, want %v", item.PathHashes, want.PathHashes)
				}
				if len(item.SNRValues) != len(want.SNRValues) {
					t.Errorf("summary SNR length = %d, want %d", len(item.SNRValues), len(want.SNRValues))
				} else {
					for i, snr := range want.SNRValues {
						if snr != nil && item.SNRValues[i] != *snr {
							t.Errorf("summary SNR[%d] = %v, want %v", i, item.SNRValues[i], *snr)
						}
					}
				}
				if tc.resolution {
					if len(item.ResolvedPath) != len(nodeIDs) {
						t.Fatalf("summary resolved path = %+v", item.ResolvedPath)
					}
					for i, hop := range item.ResolvedPath {
						if hop.Confidence != "high" || hop.NodeID == nil || *hop.NodeID != nodeIDs[i].String() || hop.NodeName == nil || *hop.NodeName != nodeNames[i] {
							t.Errorf("summary resolved hop %d = %+v, want %s (%s) at high confidence", i, hop, nodeNames[i], nodeIDs[i])
						}
					}
				}
			}
			if !found {
				t.Fatalf("summary missing trace %s", tag)
			}
			detail, err := store.GetTraceByTag(ctx, tag)
			if err != nil {
				t.Fatal(err)
			}
			if detail == nil || detail.TraceTag != tag || len(detail.Packets) != len(tc.packets) {
				t.Fatalf("detail = %+v, want %d packets for %s", detail, len(tc.packets), tag)
			}
			found = false
			for _, p := range detail.Packets {
				if p.PacketHash != hashes[tc.want] {
					continue
				}
				found = true
				if len(p.RawPath) != len(want.PathHashes) || len(p.ResolvedRoute) != len(want.PathHashes) {
					t.Fatalf("selected detail path = %+v, resolved = %+v", p.RawPath, p.ResolvedRoute)
				}
				for i, hop := range p.RawPath {
					if hop.Hash != want.PathHashes[i] {
						t.Errorf("detail hash[%d] = %s, want %s", i, hop.Hash, want.PathHashes[i])
					}
					if i >= len(want.SNRValues) {
						if hop.SNR != nil || p.ResolvedRoute[i].SNR != nil {
							t.Errorf("detail fabricated SNR at index %d", i)
						}
					} else if snr := want.SNRValues[i]; snr != nil {
						if hop.SNR == nil || *hop.SNR != *snr || p.ResolvedRoute[i].SNR == nil || *p.ResolvedRoute[i].SNR != *snr {
							t.Errorf("detail raw/resolved SNR[%d] does not match %v", i, *snr)
						}
					}
					if tc.resolution {
						resolved := p.ResolvedRoute[i]
						if resolved.Confidence != "high" || len(resolved.Nodes) != 1 || resolved.Nodes[0].ID != nodeIDs[i] {
							t.Errorf("detail resolved hop %d = %+v, want %s at high confidence", i, resolved, nodeIDs[i])
						}
					}
				}
			}
			if !found {
				t.Errorf("selected packet %s missing from detail", hashes[tc.want])
			}
		})
	}
}
