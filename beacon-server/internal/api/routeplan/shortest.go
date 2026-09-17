// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package routeplan

import (
	"container/heap"
	"time"

	"github.com/google/uuid"
)

// Path is one node sequence from source to destination with its total cost.
type Path struct {
	Nodes []uuid.UUID
	Cost  float64
	// Unmeasured[i] reports whether leg i (Nodes[i] -> Nodes[i+1]) had no
	// fresh SNR reading. Carried alongside so callers never recompute cost
	// semantics from raw edges.
	Unmeasured []bool
	// Unseen[i] reports whether leg i (Nodes[i] -> Nodes[i+1]) was never
	// observed carrying a packet in that direction (see Edge.Unseen):
	// topologically possible but unproven ("unconfirmed possible" in the
	// UI). Carried alongside for the same reason as Unmeasured.
	Unseen []bool
}

type dijkstraItem struct {
	node  uuid.UUID
	hops  int // hops used to reach node; part of the search state
	cost  float64
	index int
}

type dijkstraPQ []*dijkstraItem

func (pq dijkstraPQ) Len() int           { return len(pq) }
func (pq dijkstraPQ) Less(i, j int) bool { return pq[i].cost < pq[j].cost }
func (pq dijkstraPQ) Swap(i, j int)      { pq[i], pq[j] = pq[j], pq[i]; pq[i].index = i; pq[j].index = j }
func (pq *dijkstraPQ) Push(x any) {
	item := x.(*dijkstraItem)
	item.index = len(*pq)
	*pq = append(*pq, item)
}
func (pq *dijkstraPQ) Pop() any {
	old := *pq
	n := len(old)
	item := old[n-1]
	*pq = old[:n-1]
	return item
}

// removable edges/nodes for Yen's spur computation
type bans struct {
	edges map[[2]uuid.UUID]bool
	nodes map[uuid.UUID]bool
}

// ShortestPaths returns up to k loopless shortest paths from src to dst
// (Yen's algorithm over Dijkstra), best first. The planner is repeater-only
// end-to-end (MeshCore repeater routes): endpoints are validated repeaters by
// the caller (db/handler layer) and only repeaters are routable as
// intermediate transit nodes. The effective hop bound is computed once from
// cfg and used for the first search, every spur search's remaining budget,
// and the combined-length guard, so all three always agree. now anchors the
// SNR freshness check.
func ShortestPaths(g Graph, cfg Config, src, dst uuid.UUID, k int, now time.Time) []Path {
	if k <= 0 {
		return nil
	}
	if _, ok := g.Nodes[src]; !ok {
		return nil
	}
	if _, ok := g.Nodes[dst]; !ok {
		return nil
	}
	maxHops := maxHopsOrDefault(cfg.MaxHops)
	first := dijkstra(g, cfg, src, dst, nil, now, maxHops)
	if first == nil {
		return nil
	}
	paths := []Path{*first}
	candidates := &pathHeap{}
	seen := map[string]bool{pathKey(first.Nodes): true}
	for len(paths) < k {
		prev := paths[len(paths)-1]
		for i := 0; i < len(prev.Nodes)-1; i++ {
			spur := prev.Nodes[i]
			root := append([]uuid.UUID(nil), prev.Nodes[:i+1]...)
			rootHops := len(root) - 1
			remaining := maxHops - rootHops
			if remaining < 0 {
				continue
			}
			b := &bans{edges: map[[2]uuid.UUID]bool{}, nodes: map[uuid.UUID]bool{}}
			for _, p := range paths {
				if len(p.Nodes) > i && equalPrefix(p.Nodes, root) {
					b.edges[[2]uuid.UUID{p.Nodes[i], p.Nodes[i+1]}] = true
				}
			}
			for _, n := range root[:len(root)-1] {
				b.nodes[n] = true
			}
			// Spur search honors the REMAINING budget, not the total: a
			// cheaper over-limit spur must not hide a pricier spur that
			// fits. remaining==0 means zero hops allowed (spur==dst only),
			// passed explicitly so it never falls back to a default.
			spurPath := dijkstra(g, cfg, spur, dst, b, now, remaining)
			if spurPath == nil {
				continue
			}
			combined := append(append([]uuid.UUID(nil), root[:len(root)-1]...), spurPath.Nodes...)
			if hasLoop(combined) {
				continue
			}
			// Defensive combined-length guard against the same bound.
			if len(combined)-1 > maxHops {
				continue
			}
			key := pathKey(combined)
			if seen[key] {
				continue
			}
			seen[key] = true
			cost, unmeasured, unseen := pathCost(g, cfg, combined, now)
			heap.Push(candidates, &pathItem{path: Path{Nodes: combined, Cost: cost, Unmeasured: unmeasured, Unseen: unseen}})
		}
		if candidates.Len() == 0 {
			break
		}
		paths = append(paths, heap.Pop(candidates).(*pathItem).path)
	}
	return paths
}

type pathItem struct {
	path  Path
	index int
}

type pathHeap []*pathItem

func (h pathHeap) Len() int           { return len(h) }
func (h pathHeap) Less(i, j int) bool { return h[i].path.Cost < h[j].path.Cost }
func (h pathHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i]; h[i].index = i; h[j].index = j }
func (h *pathHeap) Push(x any)        { item := x.(*pathItem); item.index = len(*h); *h = append(*h, item) }
func (h *pathHeap) Pop() any          { old := *h; n := len(old); item := old[n-1]; *h = old[:n-1]; return item }

// dijkstra finds the cheapest src->dst path honoring bans, the mid-node
// type gate, and an explicit hop limit. The search state is (node, hopsUsed):
// a cheaper arrival with no hop budget left must not dominate a slightly more
// expensive arrival that can still reach the destination. maxHops < 0 means
// unbounded; maxHops == 0 allows only the zero-hop path (src==dst). The
// limit is a plain parameter -- never Config.MaxHops with a "zero means
// default" fallback -- so Yen spur searches can pass the exact remaining
// budget including zero. Returns nil when unreachable within the bound.
func dijkstra(g Graph, cfg Config, src, dst uuid.UUID, b *bans, now time.Time, maxHops int) *Path {
	type state struct {
		node uuid.UUID
		hops int
	}
	dist := map[state]float64{{node: src, hops: 0}: 0}
	prev := map[state]state{}
	prevUnmeasured := map[state]bool{}
	prevUnseen := map[state]bool{}
	pq := &dijkstraPQ{&dijkstraItem{node: src, hops: 0, cost: 0}}
	heap.Init(pq)
	visited := map[state]bool{}
	var best *state
	var bestCost float64
	for pq.Len() > 0 {
		item := heap.Pop(pq).(*dijkstraItem)
		s := state{node: item.node, hops: item.hops}
		if visited[s] {
			continue
		}
		visited[s] = true
		if s.node == dst {
			best = &state{node: s.node, hops: s.hops}
			bestCost = item.cost
			break
		}
		if maxHops >= 0 && s.hops >= maxHops {
			continue
		}
		for _, e := range g.Edges[s.node] {
			v := e.To
			if b != nil {
				if b.edges[[2]uuid.UUID{s.node, v}] || b.nodes[v] {
					continue
				}
			}
			// Repeater-only transit: endpoints are validated repeaters
			// upstream, and every intermediate hop must be a repeater.
			// Companion/sensor/room_server can never forward a MeshCore
			// repeater route.
			if v != dst {
				n, ok := g.Nodes[v]
				if !ok || n.Type != NodeTypeRepeater {
					continue
				}
			}
			cost, unmeasured := cfg.LegCost(e, now)
			ns := state{node: v, hops: s.hops + 1}
			nc := dist[s] + cost
			if d, ok := dist[ns]; ok && nc >= d {
				continue
			}
			dist[ns] = nc
			prev[ns] = s
			prevUnmeasured[ns] = unmeasured
			prevUnseen[ns] = e.Unseen()
			heap.Push(pq, &dijkstraItem{node: v, hops: ns.hops, cost: nc})
		}
	}
	if best == nil {
		return nil
	}
	// walk back through (node, hops) states
	nodes := []uuid.UUID{dst}
	flags := []bool{}
	unseen := []bool{}
	for cur := *best; !(cur.node == src && cur.hops == 0); {
		p, ok := prev[cur]
		if !ok {
			return nil
		}
		flags = append([]bool{prevUnmeasured[cur]}, flags...)
		unseen = append([]bool{prevUnseen[cur]}, unseen...)
		nodes = append([]uuid.UUID{p.node}, nodes...)
		cur = p
	}
	return &Path{Nodes: nodes, Cost: bestCost, Unmeasured: flags, Unseen: unseen}
}

// DefaultMaxHopsFallback guards a zero Config (tests that only set weights).
const DefaultMaxHopsFallback = 12

// maxHopsOrDefault maps Config.MaxHops onto the single effective bound used
// for the first search, every spur search's remaining budget, and the
// combined-length guard: positive values bound, zero (unset) falls back to
// the default. Negative is treated as the default too (config validation
// rejects negatives; this keeps programmatic misuse bounded rather than
// silently unbounded -- the planner always bounds).
func maxHopsOrDefault(configured int) int {
	if configured <= 0 {
		return DefaultMaxHopsFallback
	}
	return configured
}

func pathCost(g Graph, cfg Config, nodes []uuid.UUID, now time.Time) (float64, []bool, []bool) {
	var total float64
	flags := make([]bool, 0, len(nodes)-1)
	unseen := make([]bool, 0, len(nodes)-1)
	for i := 0; i+1 < len(nodes); i++ {
		found := false
		for _, e := range g.Edges[nodes[i]] {
			if e.To == nodes[i+1] {
				c, u := cfg.LegCost(e, now)
				total += c
				flags = append(flags, u)
				unseen = append(unseen, e.Unseen())
				found = true
				break
			}
		}
		if !found {
			flags = append(flags, true)
			unseen = append(unseen, true)
		}
	}
	return total, flags, unseen
}

func equalPrefix(p, prefix []uuid.UUID) bool {
	if len(p) < len(prefix) {
		return false
	}
	for i := range prefix {
		if p[i] != prefix[i] {
			return false
		}
	}
	return true
}

func hasLoop(nodes []uuid.UUID) bool {
	seen := map[uuid.UUID]bool{}
	for _, n := range nodes {
		if seen[n] {
			return true
		}
		seen[n] = true
	}
	return false
}

func pathKey(nodes []uuid.UUID) string {
	b := make([]byte, 0, len(nodes)*16)
	for _, n := range nodes {
		b = append(b, n[:]...)
	}
	return string(b)
}
