package db

import (
	"context"
	"testing"
	"time"

	sqlc "github.com/MeshCore-Beacon/beacon-server/db/sqlc"
	mockdb "github.com/MeshCore-Beacon/beacon-server/db/sqlc/mock"
	"go.uber.org/mock/gomock"
)

func TestMeshCoreRegionCatalogueWithDiscoveredCounts(t *testing.T) {
	mock := mockdb.NewMockQuerier(gomock.NewController(t))
	mock.EXPECT().ListMeshCoreRegions(gomock.Any(), gomock.Any()).Return([]sqlc.ListMeshCoreRegionsRow{
		{Token: "se0680", NodeCount: 4}, {Token: "custom", NodeCount: 2},
	}, nil)
	store := &Store{q: mock, meshcoreRegionFresh: 7 * 24 * time.Hour}
	regions, err := store.ListMeshCoreRegions(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(regions) != 315 {
		t.Fatalf("got %d regions", len(regions))
	}
	for _, region := range regions {
		switch region.Token {
		case "se0680":
			if region.DisplayName != "Jönköpings kommun" || region.ParentToken != "se06" || region.NodeCount != 4 {
				t.Fatalf("bad municipality: %+v", region)
			}
		case "se06":
			if region.NodeCount != 0 {
				t.Fatal("parent must not aggregate child counts")
			}
		case "custom":
			if region.NodeCount != 2 {
				t.Fatalf("lost discovered region: %+v", region)
			}
		}
	}
}
