package ingest

import (
	"context"
	"crypto/sha256"
	"testing"

	"github.com/MeshCore-Beacon/beacon-server/internal/meshcoreregion"
	"github.com/MeshCore-Beacon/beacon-server/internal/scopestore"
	"github.com/meshcore-go/meshcore-go"
)

type regionCaptureDB struct {
	*frameCaptureDB
	matched string
}

func (db *regionCaptureDB) GetTransportScopeByName(_ context.Context, name string) (int32, error) {
	db.matched = name
	return 680, nil
}

func TestSwedishRegionPacketMatching(t *testing.T) {
	for _, token := range []string{"se", "se06", "se0680", "offgrid"} {
		for _, route := range []uint8{meshcore.RouteTypeTransportFlood, meshcore.RouteTypeTransportDirect} {
			t.Run(token+string(rune('0'+route)), func(t *testing.T) {
				w, base := newTestWorker()
				db := &regionCaptureDB{frameCaptureDB: &frameCaptureDB{stubDB: base}}
				w.db = db
				entries := []scopestore.Entry{}
				for _, region := range meshcoreregion.All() {
					if region.Token == "*" {
						continue
					}
					name := "#" + region.Token
					key := sha256.Sum256([]byte(name))
					entries = append(entries, scopestore.Entry{Name: region.Token, TransportKey: key[:16]})
				}
				scopes := scopestore.New()
				scopes.Load(entries)
				w.scopes = scopes
				key := sha256.Sum256([]byte("#" + token))
				payload := grpTxtPayload(t)
				packet := &meshcore.Packet{Header: meshcore.MakeHeader(route, meshcore.PayloadTypeGrpTxt, 0), Payload: payload, TransportCode1: computeTransportCode(key[:16], meshcore.PayloadTypeGrpTxt, payload)}
				w.handlePacket(context.Background(), "JKG", "0102", packetEnvelope(t, packet))
				if db.matched != token || len(db.packets) != 1 || db.packets[0].ScopeID == nil || *db.packets[0].ScopeID != 680 {
					t.Fatalf("region not stored: match=%s packets=%+v", db.matched, db.packets)
				}
			})
		}
	}
}
