#!/bin/bash
#
# Wrapper script for clearing local Supabase database
#
# Usage:
#   ./clear-database.sh [options]
#
# Options:
#   --all      Clear all tables (default)
#   --odds     Clear only scraped_odds table
#   --runs     Clear only scraper_runs table
#   --extended Clear only extended market tables (double_chance, over_under, btts)
#   --dry-run  Show what would be deleted without actually deleting
#
# Examples:
#   ./clear-database.sh --dry-run          # Preview what would be deleted
#   ./clear-database.sh --odds             # Clear only odds data
#   ./clear-database.sh --extended         # Clear extended markets only
#   ./clear-database.sh                    # Clear everything
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$SCRIPT_DIR/.." || exit 1

npx tsx scripts/clear-database.ts "$@"
