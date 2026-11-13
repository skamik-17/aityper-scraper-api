#!/usr/bin/env bash
# Run SQL tests against a throwaway Postgres container built from the same image
# as the local Supabase DB. Never touches the shared DB (supabase_db_backend).
#
# Usage: scripts/sql-test.sh <first.test.sql> [more.sql ...]
#   Applies every supabase/migrations/*.sql whose leading digits are <= the first
#   file's leading digits (so 11a_* counts as 11 and runs after 11_*), in sort
#   order, then pipes each given file through psql with ON_ERROR_STOP.
set -euo pipefail

NAME=aityper-sqltest
IMAGE=public.ecr.aws/supabase/postgres:17.6.1.066

if [ $# -lt 1 ]; then
  echo "usage: sql-test.sh <first.test.sql> [more.sql ...]" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"

if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "sql-test: container $NAME already exists; remove it first (docker rm -f $NAME)" >&2
  exit 3
fi

leading_digits() { basename "$1" | sed -E 's/^([0-9]+).*/\1/'; }
LIMIT=$((10#$(leading_digits "$1")))

trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -U postgres -h localhost >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$NAME" pg_isready -U postgres -h localhost >/dev/null

PSQL=(docker exec -i "$NAME" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)

for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  d=$((10#$(leading_digits "$f")))
  if [ "$d" -le "$LIMIT" ]; then
    "${PSQL[@]}" < "$f" >/dev/null
  fi
done

for t in "$@"; do
  "${PSQL[@]}" < "$t"
done

echo "SQL TESTS PASSED $*"
