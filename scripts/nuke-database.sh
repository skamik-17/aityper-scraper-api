#!/bin/bash

# Drop everything from local Supabase database (tables, views, types, functions)
# Usage: ./scripts/nuke-database.sh [--yes]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

if [ -S "/var/run/docker.sock" ]; then
    export DOCKER_HOST="unix:///var/run/docker.sock"
elif [ -S "$HOME/.docker/desktop/docker.sock" ]; then
    export DOCKER_HOST="unix://$HOME/.docker/desktop/docker.sock"
fi

CONTAINER_NAME="supabase_db_backend"

echo -e "${RED}=== DATABASE NUKE ===${NC}\n"

if ! docker ps &>/dev/null; then
    echo -e "${RED}Error: Docker is not running${NC}"
    exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo -e "${RED}Error: Container '${CONTAINER_NAME}' not running${NC}"
    exit 1
fi

if [ "$1" != "--yes" ]; then
    echo -e "${YELLOW}This will DROP all tables, views, types, and functions in the public schema.${NC}"
    echo -e "${YELLOW}Re-run migrations with apply-migrations.sh after this.${NC}\n"
    read -p "Type 'nuke' to confirm: " confirm
    if [ "$confirm" != "nuke" ]; then
        echo -e "${RED}Aborted${NC}"
        exit 1
    fi
fi

echo -e "\n${CYAN}Dropping everything in public schema...${NC}"

docker exec -i "$CONTAINER_NAME" psql -U postgres -d postgres <<'SQL'
DO $$ 
DECLARE
    r RECORD;
BEGIN
    -- Drop views
    FOR r IN SELECT viewname FROM pg_views WHERE schemaname = 'public' LOOP
        EXECUTE 'DROP VIEW IF EXISTS public.' || quote_ident(r.viewname) || ' CASCADE';
    END LOOP;

    -- Drop tables
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;

    -- Drop functions
    FOR r IN SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
             FROM pg_proc p
             JOIN pg_namespace n ON p.pronamespace = n.oid
             WHERE n.nspname = 'public' LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS public.' || quote_ident(r.proname) || '(' || r.args || ') CASCADE';
    END LOOP;

    -- Drop custom types (enums)
    FOR r IN SELECT t.typname
             FROM pg_type t
             JOIN pg_namespace n ON t.typnamespace = n.oid
             WHERE n.nspname = 'public' AND t.typtype = 'e' LOOP
        EXECUTE 'DROP TYPE IF EXISTS public.' || quote_ident(r.typname) || ' CASCADE';
    END LOOP;

    -- Drop sequences
    FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP
        EXECUTE 'DROP SEQUENCE IF EXISTS public.' || quote_ident(r.sequencename) || ' CASCADE';
    END LOOP;
END $$;
SQL

echo -e "${GREEN}✓ Database nuked${NC}"
echo -e "${CYAN}Run ./scripts/apply-migrations.sh to rebuild${NC}"
