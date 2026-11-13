#!/bin/bash

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color
BOLD='\033[1m'
DIM='\033[2m'

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

BACKEND_URL="http://localhost:3001"
ADMIN_KEY="${ADMIN_API_KEY:-dev-admin-key-12345}"
DEFAULT_LEAGUE="premier-league"

# Available scrapers (bookmaker keys; each one runs its picked full-offer scraper)
SCRAPERS=(betclic betcris betfan betters etoto forbet fortuna fuksiarz lebull lvbet pzbuk sts superbet totalbet)

is_scraper() {
    local key="$1"
    for s in "${SCRAPERS[@]}"; do
        [ "$s" = "$key" ] && return 0
    done
    return 1
}

print_header() {
    echo -e "\n${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}  ${BOLD}$1${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}\n"
}

print_section() {
    echo -e "\n${YELLOW}▶ $1${NC}"
    echo -e "${YELLOW}─────────────────────────────────────────${NC}"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_info() {
    echo -e "${BLUE}→${NC} $1"
}

check_backend() {
    print_section "Sprawdzanie backendu..."

    response=$(curl -s -w "\n%{http_code}" "$BACKEND_URL/api/health" 2>/dev/null)
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    if [ "$http_code" = "200" ]; then
        print_success "Backend działa na $BACKEND_URL"
        echo "$body" | jq -r '.data | "  Database: \(.database)\n  Last scrape: \(.lastScrapeRun // "never")"' 2>/dev/null
        return 0
    else
        print_error "Backend nie odpowiada na $BACKEND_URL"
        echo -e "  ${YELLOW}Uruchom: cd backend && npm run dev${NC}"
        return 1
    fi
}

show_bookmaker_status() {
    print_section "Status bookmakerów"

    response=$(curl -s "$BACKEND_URL/api/bookmakers" 2>/dev/null)

    if [ -z "$response" ]; then
        print_error "Brak odpowiedzi z API"
        return 1
    fi

    echo "$response" | jq -r '
        .data.bookmakers[] |
        if .status == "available" then
            "\u001b[32m✓ \(.id)\u001b[0m - \(.matchesFound) meczy"
        elif .status == "stale" then
            "\u001b[33m⚠ \(.id)\u001b[0m - stale data"
        else
            "\u001b[31m✗ \(.id)\u001b[0m - \(.status)"
        end
    ' 2>/dev/null
}

get_odds() {
    local league="${1:-ekstraklasa}"
    print_section "Kursy dla: $league"

    response=$(curl -s "$BACKEND_URL/api/odds?league=$league" 2>/dev/null)

    if [ -z "$response" ]; then
        print_error "Brak odpowiedzi z API"
        return 1
    fi

    success=$(echo "$response" | jq -r '.success' 2>/dev/null)
    if [ "$success" != "true" ]; then
        print_error "Błąd: $(echo "$response" | jq -r '.error.message // "unknown"')"
        return 1
    fi

    total=$(echo "$response" | jq -r '.meta.totalMatches' 2>/dev/null)
    print_success "Znaleziono $total meczy"
    echo ""

    echo "$response" | jq -r '
        .data.matches[:10][] |
        "  \(.homeTeam) vs \(.awayTeam)\n    Bookmakers: \(.odds | length) | Best: 1=\(.bestOdds.home.odds) X=\(.bestOdds.draw.odds) 2=\(.bestOdds.away.odds)\n"
    ' 2>/dev/null

    if [ "$total" -gt 10 ]; then
        echo -e "  ${DIM}... i $(($total - 10)) więcej${NC}"
    fi
}

trigger_scrape() {
    local league="${1:-ekstraklasa}"
    print_section "Uruchamianie scrapingu: $league"

    print_warn "To może potrwać kilka minut..."
    echo ""

    response=$(curl -s -X POST "$BACKEND_URL/api/admin/scrape" \
        -H "Authorization: Bearer $ADMIN_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"league\": \"$league\"}" 2>/dev/null)

    if [ -z "$response" ]; then
        print_error "Brak odpowiedzi z API"
        return 1
    fi

    success=$(echo "$response" | jq -r '.success' 2>/dev/null)

    if [ "$success" = "true" ]; then
        print_success "Scraping zakończony"
        echo ""
        echo "$response" | jq -r '
            .data |
            "  Czas: \(.duration)ms\n  Sukces: \(.summary.successCount) bookmakerów\n  Błędy: \(.summary.errorCount)\n  Mecze: \(.summary.totalMatchesFound)"
        ' 2>/dev/null

        echo -e "\n  ${BOLD}Szczegóły:${NC}"
        echo "$response" | jq -r '
            .data.results | to_entries[] |
            if .value.status == "success" then
                "    \u001b[32m✓\u001b[0m \(.key): \(.value.data | length) meczy (\(.value.duration)ms)"
            else
                "    \u001b[31m✗\u001b[0m \(.key): \(.value.error // "error")"
            end
        ' 2>/dev/null
    else
        print_error "Scraping nieudany"
        echo "$response" | jq -r '.error.message // .error // "unknown error"' 2>/dev/null
    fi
}

# Test single scraper: its full offer (scrapeFullOffer), main markets of one match
test_single_scraper() {
    local scraper_key="$1"
    local league="${2:-$DEFAULT_LEAGUE}"
    local match_filter="${3:-}"

    if ! is_scraper "$scraper_key"; then
        print_error "Nieznany scraper: $scraper_key"
        echo -e "Dostępne: ${SCRAPERS[*]}"
        return 1
    fi

    print_section "Test: $scraper_key ($league)"

    cd "$BACKEND_DIR" || exit 1

    local args=(--bookmaker "$scraper_key" --league "$league")
    [ -n "$match_filter" ] && args+=(--match "$match_filter")
    timeout 600 npx tsx scripts/scraper-check.ts "${args[@]}" 2>&1

    local exit_code=$?
    cd - > /dev/null
    return $exit_code
}

# Test all scrapers
test_all_scrapers() {
    local league="${1:-$DEFAULT_LEAGUE}"
    local match_filter="${2:-}"

    print_section "Test wszystkich scraperów ($league)"

    local success_count=0
    local fail_count=0
    local results=()

    for scraper_key in "${SCRAPERS[@]}"; do
        echo -e "\n${MAGENTA}━━━ $scraper_key ━━━${NC}"

        if test_single_scraper "$scraper_key" "$league" "$match_filter"; then
            ((success_count++))
            results+=("${GREEN}✓${NC} $scraper_key")
        else
            ((fail_count++))
            results+=("${RED}✗${NC} $scraper_key")
        fi
    done

    # Summary
    print_section "Podsumowanie"
    echo -e "${GREEN}Sukces:${NC} $success_count"
    echo -e "${RED}Błędy:${NC} $fail_count"
    echo ""
    for r in "${results[@]}"; do
        echo -e "  $r"
    done
}

# Quick test - full offer of the main scrapers, match counts only
quick_test() {
    local league="${1:-$DEFAULT_LEAGUE}"

    print_section "Quick test - listing ($league)"

    cd "$BACKEND_DIR" || exit 1

    timeout 600 npx tsx scripts/scraper-check.ts --quick --league "$league" 2>&1

    cd - > /dev/null
}

# Compare odds from scrapers
compare_odds() {
    local match_filter="$1"
    local league="${2:-$DEFAULT_LEAGUE}"

    if [ -z "$match_filter" ]; then
        print_error "Podaj nazwę drużyny, np: $0 compare Chelsea"
        return 1
    fi

    print_section "Porównanie kursów: $match_filter ($league)"

    cd "$BACKEND_DIR" || exit 1

    timeout 600 npx tsx scripts/scraper-check.ts --compare "$match_filter" --league "$league" 2>&1

    cd - > /dev/null
}

list_scrapers() {
    print_section "Dostępne scrapery"
    for key in $(echo "${SCRAPERS[@]}" | tr ' ' '\n' | sort); do
        echo -e "  ${CYAN}•${NC} $key"
    done
}

show_help() {
    echo -e "${BOLD}AITyper Scraper Tester${NC}\n"
    echo "Użycie: $0 [komenda] [opcje]"
    echo ""
    echo -e "${BOLD}Komendy (via API):${NC}"
    echo "  status              Pokaż status backendu i bookmakerów"
    echo "  odds [league]       Pobierz aktualne kursy"
    echo "  scrape [league]     Uruchom scraping przez API"
    echo ""
    echo -e "${BOLD}Komendy (direct):${NC}"
    echo "  test NAME [league] [match]   Test pojedynczego scrapera"
    echo "  test-all [league] [match]    Test wszystkich scraperów"
    echo "  quick [league]               Szybki test (tylko listing)"
    echo "  compare TEAM [league]        Porównaj kursy z różnych scraperów"
    echo "  list                         Lista dostępnych scraperów"
    echo ""
    echo -e "${BOLD}Opcje:${NC}"
    echo "  league:  ekstraklasa (domyślnie), premier-league, la-liga, etc."
    echo "  match:   filtr meczu (np. 'Chelsea', 'Burnley')"
    echo ""
    echo -e "${BOLD}Przykłady:${NC}"
    echo "  $0 test betcris                    # Test Betcris (Ekstraklasa)"
    echo "  $0 test fortuna premier-league     # Test Fortuna (Premier League)"
    echo "  $0 test lvbet premier-league Chelsea  # Test LVBet, mecz Chelsea"
    echo "  $0 quick premier-league            # Szybki test wszystkich"
    echo "  $0 compare Chelsea premier-league  # Porównaj kursy na Chelsea"
    echo "  $0 test-all premier-league         # Pełny test wszystkich"
    echo ""
    echo -e "${BOLD}Dostępne scrapery:${NC}"
    echo "  ${SCRAPERS[*]}" | fold -s -w 60 | sed 's/^/  /'
}

# Main
print_header "AITyper Scraper Tester"

case "${1:-help}" in
    status)
        check_backend && show_bookmaker_status
        ;;
    odds)
        check_backend && get_odds "${2:-ekstraklasa}"
        ;;
    odds-pl)
        check_backend && get_odds "premier-league"
        ;;
    scrape)
        check_backend && trigger_scrape "${2:-ekstraklasa}"
        ;;
    scrape-pl)
        check_backend && trigger_scrape "premier-league"
        ;;
    test)
        if [ -z "$2" ]; then
            print_error "Podaj nazwę scrapera"
            list_scrapers
            exit 1
        fi
        test_single_scraper "$2" "${3:-$DEFAULT_LEAGUE}" "$4"
        ;;
    test-all)
        test_all_scrapers "${2:-$DEFAULT_LEAGUE}" "$3"
        ;;
    quick)
        quick_test "${2:-$DEFAULT_LEAGUE}"
        ;;
    compare)
        compare_odds "$2" "${3:-$DEFAULT_LEAGUE}"
        ;;
    list)
        list_scrapers
        ;;
    all)
        check_backend || exit 1
        show_bookmaker_status
        echo ""
        trigger_scrape "ekstraklasa"
        echo ""
        get_odds "ekstraklasa"
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        print_error "Nieznana komenda: $1"
        show_help
        exit 1
        ;;
esac

echo ""
