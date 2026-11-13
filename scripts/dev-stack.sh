#!/usr/bin/env bash
# Operator start procedure for the local stack: make sure Supabase answers through
# PostgREST (starting the local stack when it is down), then exec `npm run dev`.
#
# Usage: bash scripts/dev-stack.sh [--check] [--no-scrapers]
#   --check        only probe Supabase (market_types through PostgREST) and exit:
#                  0 when it answers HTTP 200, 1 otherwise. Nothing is started.
#   --no-scrapers  start the API with SCRAPERS_ON=false (serves stored odds only).
#
# Exit codes: 0 (--check: reachable), 1 (Supabase unreachable or could not be started,
# API already running, docker / supabase CLI failure), 2 (usage error).
# Without --check a successful run does not return: it execs `npm run dev`.

set -eu

usage="usage: dev-stack.sh [--check] [--no-scrapers]"
check_only=0
no_scrapers=0
for arg in "$@"; do
  case "$arg" in
    --check) check_only=1 ;;
    --no-scrapers) no_scrapers=1 ;;
    -h | --help) echo "$usage"; exit 0 ;;
    *) echo "$usage" >&2; exit 2 ;;
  esac
done

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root_dir"

# Load .env without overriding variables already set in the environment (the dotenv rule).
# Plain KEY=VALUE lines only: an optional `export ` prefix, single or double quotes, and
# `#` comments are understood; nothing in the file is executed.
load_env_file() {
  local env_line env_key env_value
  while IFS= read -r env_line || [ -n "$env_line" ]; do
    env_line="${env_line%$'\r'}"
    [[ "$env_line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*(.*)$ ]] || continue
    env_key="${BASH_REMATCH[2]}"
    env_value="${BASH_REMATCH[3]}"
    if [[ "$env_value" =~ ^\"([^\"]*)\" || "$env_value" =~ ^\'([^\']*)\' ]]; then
      env_value="${BASH_REMATCH[1]}"
    else
      env_value="${env_value%%#*}"
      env_value="${env_value%"${env_value##*[![:space:]]}"}"
    fi
    [ -n "${!env_key+x}" ] && continue
    printf -v "$env_key" '%s' "$env_value"
  done < "$1"
}
if [ -f .env ]; then
  load_env_file .env
fi

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_KEY:-}" ]; then
  echo "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set (environment or .env)" >&2
  exit 1
fi

# Probe through PostgREST to a real table: during the PGRST002 window PostgREST answers
# while Postgres is still starting, so only HTTP 200 counts as reachable. `|| true` keeps
# `set -e` from exiting on curl's own failure (exit 7 on a closed port); the code is then 000.
probe_supabase() {
  curl -s -o /dev/null -w '%{http_code}' -m 3 "${SUPABASE_URL%/}/rest/v1/market_types?select=id&limit=1" \
    -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" || true
}

code=$(probe_supabase)

if [ "$check_only" -eq 1 ]; then
  if [ "$code" = "200" ]; then
    echo "Supabase reachable at $SUPABASE_URL (market_types HTTP 200)"
    exit 0
  fi
  echo "Supabase NOT reachable at $SUPABASE_URL (HTTP $code)"
  exit 1
fi

api_port="${PORT:-3001}"
api_code=$(curl -s -o /dev/null -w '%{http_code}' -m 3 "http://localhost:$api_port/api/health" || true)
if [ "$api_code" = "200" ]; then
  echo "API already running on :$api_port" >&2
  exit 1
fi

if [ "$code" != "200" ]; then
  echo "Supabase NOT reachable at $SUPABASE_URL (HTTP $code)"
  if [[ "$SUPABASE_URL" =~ ^https?://(127\.0\.0\.1|localhost)(:[0-9]+)?(/.*)?$ ]]; then
    if ! docker info > /dev/null 2>&1; then
      echo "Docker is not reachable (docker info failed): start Docker and retry" >&2
      exit 1
    fi
    label="label=com.supabase.cli.project=backend"
    if ! stack_ids=$(docker ps -a --filter "$label" -q); then
      echo "docker ps failed: cannot tell whether the local Supabase stack exists" >&2
      exit 1
    fi
    if [ -n "$stack_ids" ]; then
      # The stack exists: start its stopped containers, except edge_runtime, which the API
      # does not use. `supabase start` is not run here. Containers that are running but
      # still starting (the PGRST002 window) are left to the poll below. `-q` ignores
      # --format, so the names come from the --format form.
      stopped=$(docker ps -a --filter "$label" --filter status=exited --format '{{.Names}}' | grep -v edge_runtime || true)
      if [ -n "$stopped" ]; then
        echo "Starting stopped Supabase containers: ${stopped//$'\n'/ }"
        if ! printf '%s\n' "$stopped" | xargs -r docker start > /dev/null; then
          echo "docker start reported an error; waiting for Supabase anyway" >&2
        fi
      fi
    else
      echo "No local Supabase containers found: running supabase start"
      # Prefer a Supabase CLI 2.70.5 that is already in the npx cache: it works offline.
      # npx names its cache dir after a hash of the raw argument, so `npx supabase@2.70.5`
      # does not reuse the copy a bare `npx supabase` cached. Its first run fetches the
      # package from the registry and its postinstall downloads the binary from GitHub.
      cli_version="2.70.5"
      cached_cli=""
      for cli_pkg in "${HOME:-}"/.npm/_npx/*/node_modules/supabase; do
        [ -f "$cli_pkg/package.json" ] && [ -x "$cli_pkg/bin/supabase" ] || continue
        # The first "version" in package.json is the top-level one.
        cli_pkg_version=$(grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$cli_pkg/package.json" | head -n 1 | sed -E 's/.*"([^"]*)"$/\1/')
        if [ "$cli_pkg_version" = "$cli_version" ]; then
          cached_cli="$cli_pkg/bin/supabase"
          break
        fi
      done
      if [ -n "$cached_cli" ]; then
        echo "Using the cached Supabase CLI $cli_version: $cached_cli"
        if ! "$cached_cli" start; then
          echo "supabase start failed (cached CLI $cached_cli)." >&2
          echo "Check the output above and that Docker is healthy, then retry. Nothing was deleted." >&2
          exit 1
        fi
      else
        echo "No cached Supabase CLI $cli_version under ~/.npm/_npx: running npx --yes supabase@$cli_version start"
        if ! npx --yes "supabase@$cli_version" start; then
          cat >&2 <<EOF
supabase start failed.
The first npx --yes supabase@$cli_version needs network access: npm fetches the package from the registry and its postinstall downloads the CLI binary (about 56 MB) from github.com. If you are offline, connect and retry.
If it also fails online, the npx cache may be corrupt: grep -l '"version": "$cli_version"' ~/.npm/_npx/*/node_modules/supabase/package.json lists the cached $cli_version copies. None of them has an executable bin/supabase (this script would have used it), so remove that _npx/<hash> dir, then retry. Nothing was deleted.
EOF
          exit 1
        fi
      fi
    fi
  else
    echo "SUPABASE_URL is not local: not starting anything, waiting for it"
  fi

  # PGRST002 (HTTP 503) and 000 (connection refused) mean not ready yet.
  echo "Waiting up to 90 s for Supabase at $SUPABASE_URL ..."
  deadline=$((SECONDS + 90))
  while :; do
    code=$(probe_supabase)
    [ "$code" = "200" ] && break
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "Supabase NOT reachable at $SUPABASE_URL after 90 s (last HTTP $code)" >&2
      exit 1
    fi
    sleep 3
  done
fi

echo "Supabase reachable at $SUPABASE_URL (market_types HTTP 200)"

if [ "$no_scrapers" -eq 1 ]; then
  export SCRAPERS_ON=false
fi
echo "Starting the API: npm run dev"
exec npm run dev
