#!/bin/bash

# Apply Supabase migrations to local database
# Usage: ./scripts/apply-migrations.sh [migration_file]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
MIGRATIONS_DIR="$BACKEND_DIR/supabase/migrations"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Docker socket (try both common locations)
if [ -S "/var/run/docker.sock" ]; then
    export DOCKER_HOST="unix:///var/run/docker.sock"
elif [ -S "$HOME/.docker/desktop/docker.sock" ]; then
    export DOCKER_HOST="unix://$HOME/.docker/desktop/docker.sock"
fi

# Container name
CONTAINER_NAME="supabase_db_backend"

echo -e "${CYAN}=== Supabase Migration Tool ===${NC}\n"

# Check if Docker is running
if ! docker ps &>/dev/null; then
    echo -e "${RED}Error: Docker is not running or not accessible${NC}"
    exit 1
fi

# Check if Supabase container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo -e "${RED}Error: Supabase database container '${CONTAINER_NAME}' is not running${NC}"
    echo -e "${YELLOW}Start Supabase with: npx supabase start${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Docker is running${NC}"
echo -e "${GREEN}✓ Supabase database container found${NC}\n"

apply_migration() {
    local file="$1"
    local filename=$(basename "$file")

    echo -e "${CYAN}Applying: ${filename}${NC}"

    if docker exec -i "$CONTAINER_NAME" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$file" 2>&1; then
        echo -e "${GREEN}✓ Migration applied successfully${NC}\n"
        return 0
    else
        echo -e "${RED}✗ Migration failed${NC}\n"
        return 1
    fi
}

# If specific migration file provided
if [ -n "$1" ]; then
    if [ -f "$1" ]; then
        apply_migration "$1"
    elif [ -f "$MIGRATIONS_DIR/$1" ]; then
        apply_migration "$MIGRATIONS_DIR/$1"
    else
        echo -e "${RED}Error: Migration file not found: $1${NC}"
        exit 1
    fi
else
    # Apply all migrations in order
    echo -e "${YELLOW}Applying all migrations from: ${MIGRATIONS_DIR}${NC}\n"

    if [ ! -d "$MIGRATIONS_DIR" ]; then
        echo -e "${RED}Error: Migrations directory not found${NC}"
        exit 1
    fi

    migration_files=$(find "$MIGRATIONS_DIR" -name "*.sql" -type f | sort)

    if [ -z "$migration_files" ]; then
        echo -e "${YELLOW}No migration files found${NC}"
        exit 0
    fi

    failed=0
    for file in $migration_files; do
        if ! apply_migration "$file"; then
            failed=1
        fi
    done

    if [ $failed -eq 0 ]; then
        echo -e "${GREEN}=== All migrations applied successfully ===${NC}"
    else
        echo -e "${RED}=== Some migrations failed ===${NC}"
        exit 1
    fi
fi
