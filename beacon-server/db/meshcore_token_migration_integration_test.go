package db

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestMeshCoreTokenMigrationPostgres(t *testing.T) {
	dsn := os.Getenv("BEACON_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set BEACON_TEST_POSTGRES_DSN")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `
CREATE TEMP TABLE transport_scopes (id INT PRIMARY KEY, name TEXT UNIQUE) ON COMMIT DROP;
CREATE TEMP TABLE packets (scope_id INT) ON COMMIT DROP;
CREATE TEMP TABLE nodes (default_scope_id INT) ON COMMIT DROP;
CREATE TEMP TABLE observer_scopes (observer_id INT, scope_id INT, first_seen TIMESTAMPTZ, last_seen TIMESTAMPTZ, PRIMARY KEY(observer_id, scope_id)) ON COMMIT DROP;
INSERT INTO transport_scopes VALUES (1, '#se01'), (2, '#se0680'), (3, 'se0680'), (4, '#custom');
INSERT INTO packets VALUES (1), (2);
INSERT INTO nodes VALUES (2);
INSERT INTO observer_scopes VALUES (10, 2, '2026-01-01', '2026-09-01'), (10, 3, '2026-02-01', '2026-09-10');`)
	if err != nil {
		t.Fatal(err)
	}
	migration, err := migrationFiles.ReadFile("migrations/049_meshcore_region_tokens.sql")
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err := tx.Exec(ctx, string(migration)); err != nil {
			t.Fatal(err)
		}
	}
	var valid bool
	err = tx.QueryRow(ctx, `SELECT
  (SELECT name FROM transport_scopes WHERE id=1) = 'se01'
  AND (SELECT name FROM transport_scopes WHERE id=4) = '#custom'
  AND NOT EXISTS (SELECT 1 FROM transport_scopes WHERE id=2)
  AND (SELECT count(*) FROM packets WHERE scope_id IN (1,3)) = 2
  AND (SELECT default_scope_id FROM nodes) = 3
  AND (SELECT count(*) FROM observer_scopes) = 1
  AND EXISTS (SELECT 1 FROM observer_scopes WHERE scope_id=3 AND first_seen='2026-01-01' AND last_seen='2026-09-10')`).Scan(&valid)
	if err != nil || !valid {
		t.Fatalf("migration lost associations: valid=%v err=%v", valid, err)
	}
}
