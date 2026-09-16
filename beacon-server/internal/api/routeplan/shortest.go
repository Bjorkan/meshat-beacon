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
}

type dijkstraItem struct {
	node  uuid.UUID
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
// (Yen's algorithm over Dijkstra), best first. Mid-nodes must be
// repeaters/room servers; endpoints may be any type. Paths longer than
// cfg.MaxHops edges are discarded. now anchors the SNR freshness check.
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
	first := dijkstra(g, cfg, src, dst, nil, now)
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
			b := &bans{edges: map[[2]uuid.UUID]bool{}, nodes: map[uuid.UUID]bool{}}
			for _, p := range paths {
				if len(p.Nodes) > i && equalPrefix(p.Nodes, root) {
					b.edges[[2]uuid.UUID{p.Nodes[i], p.Nodes[i+1]}] = true
				}
			}
			for _, n := range root[:len(root)-1] {
				b.nodes[n] = true
			}
			spurPath := dijkstra(g, cfg, spur, dst, b, now)
			if spurPath == nil {
				continue
			}
			combined := append(append([]uuid.UUID(nil), root[:len(root)-1]...), spurPath.Nodes...)
			if hasLoop(combined) {
				continue
			}
			key := pathKey(combined)
			if seen[key] {
				continue
			}
			seen[key] = true
			cost, unmeasured := pathCost(g, cfg, combined, now)
			heap.Push(candidates, &pathItem{path: Path{Nodes: combined, Cost: cost, Unmeasured: unmeasured}})
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

// dijkstra finds the cheapest src->dst path honoring bans and the mid-node
// type gate. Returns nil when unreachable.
func dijkstra(g Graph, cfg Config, src, dst uuid.UUID, b *bans, now time.Time) *Path {
	maxHops := cfg.MaxHops
	if maxHops <= 0 {
		maxHops = DefaultMaxHopsFallback
	}
	dist := map[uuid.UUID]float64{src: 0}
	prev := map[uuid.UUID]uuid.UUID{}
	prevUnmeasured := map[uuid.UUID]bool{}
	hops := map[uuid.UUID]int{src: 0}
	pq := &dijkstraPQ{&dijkstraItem{node: src, cost: 0}}
	heap.Init(pq)
	visited := map[uuid.UUID]bool{}
	for pq.Len() > 0 {
		item := heap.Pop(pq).(*dijkstraItem)
		u := item.node
		if visited[u] {
			continue
		}
		visited[u] = true
		if u == dst {
			break
		}
		if hops[u] >= maxHops {
			continue
		}
		for _, e := range g.Edges[u] {
			v := e.To
			if b != nil {
				if b.edges[[2]uuid.UUID{u, v}] || b.nodes[v] {
					continue
				}
			}
			if v != dst {
				n, ok := g.Nodes[v]
				if !ok || (n.Type != NodeTypeRepeater && n.Type != NodeTypeRoomServer) {
					continue
				}
			}
			cost, unmeasured := cfg.LegCost(e, now)
			nc := dist[u] + cost
			if d, ok := dist[v]; ok && nc >= d {
				continue
			}
			dist[v] = nc
			prev[v] = u
			prevUnmeasured[v] = unmeasured
			hops[v] = hops[u] + 1
			heap.Push(pq, &dijkstraItem{node: v, cost: nc})
		}
	}
	d, ok := dist[dst]
	if !ok {
		return nil
	}
	// walk back
	nodes := []uuid.UUID{dst}
	flags := []bool{}
	for cur := dst; cur != src; {
		p, ok := prev[cur]
		if !ok {
			return nil
		}
		flags = append([]bool{prevUnmeasured[cur]}, flags...)
		nodes = append([]uuid.UUID{p}, nodes...)
		cur = p
	}
	return &Path{Nodes: nodes, Cost: d, Unmeasured: flags}
}

// DefaultMaxHopsFallback guards a zero Config (tests that only set weights).
const DefaultMaxHopsFallback = 12

func pathCost(g Graph, cfg Config, nodes []uuid.UUID, now time.Time) (float64, []bool) {
	var total float64
	flags := make([]bool, 0, len(nodes)-1)
	for i := 0; i+1 < len(nodes); i++ {
		found := false
		for _, e := range g.Edges[nodes[i]] {
			if e.To == nodes[i+1] {
				c, u := cfg.LegCost(e, now)
				total += c
				flags = append(flags, u)
				found = true
				break
			}
		}
		if !found {
			flags = append(flags, true)
		}
	}
	return total, flags
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
