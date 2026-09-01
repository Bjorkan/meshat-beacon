# Upgrade PostgreSQL 16 to 18

PostgreSQL major versions cannot share physical database files. The official
PostgreSQL 18 image also changed its persistent mount point from
`/var/lib/postgresql/data` to `/var/lib/postgresql`.

Fresh deployments do not need this procedure. Run it only when
`data/postgres/` contains an existing PostgreSQL 16 database.

The procedure exports only Beacon's `tower` database. Do not use it for a
PostgreSQL instance that also hosts unrelated databases or custom roles.

## Before you start

- Run all commands from `beacon-docs/docker-deployment-type1/`.
- Make sure the existing PostgreSQL 16 `db` container is still running.
- Do not run `docker compose up`, `--force-recreate`, or remove the old
  container after updating the compose file until the backup is complete.
- Ensure there is enough free disk space for both database versions and the
  logical backup.

Confirm that the running source database is PostgreSQL 16:

```bash
docker compose exec -T db postgres --version
```

The command must report PostgreSQL 16. Stop here if it reports another major
version.

## 1. Stop writes and create a logical backup

Stop Beacon while leaving PostgreSQL running. This prevents writes after the
backup snapshot:

```bash
docker compose stop app
mkdir -p data/postgres-upgrade
```

Create a custom-format backup without ownership or ACL metadata. The new
PostgreSQL 18 cluster creates the `tower` user and database from the compose
environment, so they must not be recreated by the restore:

```bash
docker compose exec -T db \
  pg_dump --username tower --dbname tower --format=custom --no-owner --no-acl \
  > data/postgres-upgrade/tower-pg16.dump
```

Check that the backup is non-empty and readable:

```bash
test -s data/postgres-upgrade/tower-pg16.dump
docker compose exec -T db pg_restore --list \
  < data/postgres-upgrade/tower-pg16.dump > /dev/null
```

Do not continue if either command fails.

## 2. Preserve the PostgreSQL 16 files

Stop the old database and move its files instead of deleting them. The moved
directory is the rollback copy:

```bash
docker compose stop db
mv data/postgres data/postgres-pg16
mkdir -p data/postgres
```

The updated `docker-compose.yml` must contain both of these settings:

```yaml
image: postgres:18-alpine
volumes:
  - ./data/postgres/:/var/lib/postgresql
```

## 3. Initialize PostgreSQL 18 and restore Beacon

Start only the new database and wait for it to accept connections:

```bash
docker compose up -d db
until docker compose exec -T db pg_isready -U tower -d tower; do sleep 2; done
```

Restore the backup. `--exit-on-error` ensures a partial restore is reported as
a failure:

```bash
docker compose exec -T db \
  pg_restore --username tower --dbname tower --clean --if-exists \
  --no-owner --no-acl --exit-on-error \
  < data/postgres-upgrade/tower-pg16.dump
```

Verify the server version and Beacon migration table:

```bash
docker compose exec -T db psql -U tower -d tower -c "SELECT version();"
docker compose exec -T db psql -U tower -d tower \
  -c "SELECT COUNT(*) AS applied_migrations FROM schema_migrations;"
```

Finally, start the stack and inspect its health and logs:

```bash
docker compose up -d
docker compose ps
docker compose logs --tail=100 db app
```

Keep `data/postgres-pg16/` and
`data/postgres-upgrade/tower-pg16.dump` until Beacon has been validated. Remove
them later only as a deliberate cleanup operation.

## Roll back

If the restore or application validation fails, stop PostgreSQL 18 before
touching either data directory:

```bash
docker compose stop app db
mv data/postgres data/postgres-pg18-failed
mv data/postgres-pg16 data/postgres
```

Change the database service back to `postgres:16-alpine` and restore the old
mount target:

```yaml
image: postgres:16-alpine
volumes:
  - ./data/postgres/:/var/lib/postgresql/data
```

Then restart PostgreSQL 16 and Beacon:

```bash
docker compose up -d db
docker compose up -d app
```

Never start PostgreSQL 18 directly against the PostgreSQL 16 physical data
directory.
