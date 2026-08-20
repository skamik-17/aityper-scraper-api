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

# Available scrapers (class name : display name)
declare -A SCRAPERS=(
    ["betclic"]="BetclicPlaywrightScraper"
    ["betcris"]="BetcrisPlaywrightScraper"
    ["betfan"]="BetfanPlaywrightScraper"
    ["betters"]="BettersPlaywrightScraper"
    ["etoto"]="EtotoPlaywrightScraper"
    ["forbet"]="ForbetPlaywrightScraper"
    ["fortuna"]="FortunaPlaywrightScraper"
    ["fuksiarz"]="FuksiarzPlaywrightScraper"
    ["lebull"]="LebullPlaywrightScraper"
    ["lvbet"]="LVBetPlaywrightScraper"
    ["pzbuk"]="PzbukPlaywrightScraper"
    ["sts"]="STSScraper"
    ["superbet"]="SuperbetPlaywrightScraper"
    ["totalbet"]="TotalbetPlaywrightScraper"
)

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

# Test single scraper with full details
test_single_scraper() {
    local scraper_key="$1"
    local league="${2:-$DEFAULT_LEAGUE}"
    local match_filter="${3:-}"

    # Find scraper class name
    local scraper_class="${SCRAPERS[$scraper_key]}"
    if [ -z "$scraper_class" ]; then
        print_error "Nieznany scraper: $scraper_key"
        echo -e "Dostępne: ${!SCRAPERS[*]}"
        return 1
    fi

    print_section "Test: $scraper_key ($league)"

    cd "$BACKEND_DIR" || exit 1

    timeout 120 npx tsx -e "
import { $scraper_class } from './src/scrapers/bookmakers/index.ts';

(async () => {
    const scraper = new $scraper_class();
    const matchFilter = '$match_filter'.toLowerCase();

    console.log('\\n\x1b[36m▸ Scraping listing...\x1b[0m');
    const listStart = Date.now();
    const result = await scraper.scrapeLeague('$league');
    const listDuration = Date.now() - listStart;

    if (result.status !== 'success' || !result.data?.length) {
        console.log('\x1b[31m✗ Listing failed:\x1b[0m', result.status);
        process.exit(1);
    }

    console.log('\x1b[32m✓ Listing:\x1b[0m', result.data.length, 'matches', '(\x1b[2m' + listDuration + 'ms\x1b[0m)');

    // Find match
    let match = result.data[0];
    if (matchFilter) {
        const filtered = result.data.find(m =>
            m.homeTeam?.toLowerCase().includes(matchFilter) ||
            m.awayTeam?.toLowerCase().includes(matchFilter)
        );
        if (filtered) match = filtered;
        else console.log('\x1b[33m⚠ Match filter not found, using first match\x1b[0m');
    }

    console.log('\x1b[36m▸ Testing:\x1b[0m', match.homeTeam, 'vs', match.awayTeam);

    if (!match.eventUrl) {
        console.log('\x1b[33m⚠ No eventUrl, skipping details\x1b[0m');
        process.exit(0);
    }

    console.log('\x1b[36m▸ Scraping match details...\x1b[0m');
    const detailStart = Date.now();
    const detail = await scraper.scrapeMatchDetails(match.eventUrl);
    const detailDuration = Date.now() - detailStart;

    if (detail.status !== 'success' || !detail.data) {
        console.log('\x1b[31m✗ Details failed:\x1b[0m', detail.status);
        process.exit(1);
    }

    const d = detail.data;
    console.log('\x1b[32m✓ Details:\x1b[0m', '(\x1b[2m' + detailDuration + 'ms\x1b[0m)');

    // Print markets
    if (d.market1X2) {
        console.log('  \x1b[32m✓\x1b[0m 1X2:', d.market1X2.home, '/', d.market1X2.draw, '/', d.market1X2.away);
    }

    if (d.marketBTTS) {
        console.log('  \x1b[32m✓\x1b[0m BTTS: Yes', d.marketBTTS.yes, '/ No', d.marketBTTS.no);
    } else {
        console.log('  \x1b[31m✗\x1b[0m BTTS: brak');
    }

    if (d.marketOverUnder) {
        const lines = Object.keys(d.marketOverUnder).sort((a,b) => parseFloat(a) - parseFloat(b));
        const ou25 = d.marketOverUnder['2.5'];
        if (ou25) {
            console.log('  \x1b[32m✓\x1b[0m O/U 2.5: Over', ou25.over, '/ Under', ou25.under, '\x1b[2m(' + lines.length + ' lines)\x1b[0m');
        } else {
            console.log('  \x1b[32m✓\x1b[0m O/U:', lines.join(', '));
        }
    } else {
        console.log('  \x1b[31m✗\x1b[0m O/U: brak');
    }

    if (d.marketDoubleChance) {
        console.log('  \x1b[32m✓\x1b[0m DC: 1X', d.marketDoubleChance.homeOrDraw, '/ X2', d.marketDoubleChance.drawOrAway, '/ 12', d.marketDoubleChance.homeOrAway);
    }

    console.log('');
    process.exit(0);
})();
" 2>&1

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

    for scraper_key in "${!SCRAPERS[@]}"; do
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

# Quick test - just listing, no details
quick_test() {
    local league="${1:-$DEFAULT_LEAGUE}"

    print_section "Quick test - listing ($league)"

    cd "$BACKEND_DIR" || exit 1

    timeout 300 npx tsx -e "
import * as scrapers from './src/scrapers/bookmakers/index.ts';

(async () => {
    const SCRAPERS = {
        betclic: scrapers.BetclicPlaywrightScraper,
        betcris: scrapers.BetcrisPlaywrightScraper,
        fortuna: scrapers.FortunaPlaywrightScraper,
        lvbet: scrapers.LVBetPlaywrightScraper,
        sts: scrapers.STSScraper,
        superbet: scrapers.SuperbetPlaywrightScraper,
        fuksiarz: scrapers.FuksiarzPlaywrightScraper,
    };

    console.log('Testing', Object.keys(SCRAPERS).length, 'main scrapers...\\n');

    for (const [name, Scraper] of Object.entries(SCRAPERS)) {
        try {
            const scraper = new Scraper();
            const start = Date.now();
            const result = await scraper.scrapeLeague('$league');
            const duration = Date.now() - start;

            if (result.status === 'success' && result.data?.length) {
                console.log('\x1b[32m✓\x1b[0m', name.padEnd(12), result.data.length, 'matches', '\x1b[2m(' + duration + 'ms)\x1b[0m');
            } else {
                console.log('\x1b[31m✗\x1b[0m', name.padEnd(12), result.status);
            }
        } catch (e) {
            console.log('\x1b[31m✗\x1b[0m', name.padEnd(12), 'error:', e.message?.substring(0, 50));
        }
    }

    console.log('');
    process.exit(0);
})();
" 2>&1

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

    timeout 300 npx tsx -e "
import * as scrapers from './src/scrapers/bookmakers/index.ts';

(async () => {
    const SCRAPERS = {
        betclic: scrapers.BetclicPlaywrightScraper,
        betcris: scrapers.BetcrisPlaywrightScraper,
        fortuna: scrapers.FortunaPlaywrightScraper,
        lvbet: scrapers.LVBetPlaywrightScraper,
        sts: scrapers.STSScraper,
        superbet: scrapers.SuperbetPlaywrightScraper,
    };

    const filter = '$match_filter'.toLowerCase();
    const results = [];

    for (const [name, Scraper] of Object.entries(SCRAPERS)) {
        try {
            const scraper = new Scraper();
            const listResult = await scraper.scrapeLeague('$league');

            if (listResult.status !== 'success') continue;

            const match = listResult.data?.find(m =>
                m.homeTeam?.toLowerCase().includes(filter) ||
                m.awayTeam?.toLowerCase().includes(filter)
            );

            if (!match?.eventUrl) continue;

            const detail = await scraper.scrapeMatchDetails(match.eventUrl);
            if (detail.status !== 'success') continue;

            results.push({
                name,
                match: match.homeTeam + ' vs ' + match.awayTeam,
                home: detail.data?.market1X2?.home,
                draw: detail.data?.market1X2?.draw,
                away: detail.data?.market1X2?.away,
                bttsYes: detail.data?.marketBTTS?.yes,
                bttsNo: detail.data?.marketBTTS?.no,
                ou25Over: detail.data?.marketOverUnder?.['2.5']?.over,
                ou25Under: detail.data?.marketOverUnder?.['2.5']?.under,
            });
        } catch (e) {
            // skip
        }
    }

    if (results.length === 0) {
        console.log('\x1b[31mNie znaleziono meczu\x1b[0m');
        process.exit(1);
    }

    console.log('\x1b[36mMecz:\x1b[0m', results[0].match);
    console.log('');

    // 1X2 comparison
    console.log('\x1b[1m1X2:\x1b[0m');
    console.log('Bookmaker'.padEnd(12), '1'.padStart(6), 'X'.padStart(6), '2'.padStart(6));
    console.log('-'.repeat(36));
    for (const r of results) {
        if (r.home) {
            console.log(r.name.padEnd(12), String(r.home).padStart(6), String(r.draw).padStart(6), String(r.away).padStart(6));
        }
    }

    // BTTS comparison
    console.log('');
    console.log('\x1b[1mBTTS:\x1b[0m');
    console.log('Bookmaker'.padEnd(12), 'Yes'.padStart(6), 'No'.padStart(6));
    console.log('-'.repeat(24));
    for (const r of results) {
        if (r.bttsYes) {
            console.log(r.name.padEnd(12), String(r.bttsYes).padStart(6), String(r.bttsNo).padStart(6));
        }
    }

    // O/U 2.5 comparison
    console.log('');
    console.log('\x1b[1mO/U 2.5:\x1b[0m');
    console.log('Bookmaker'.padEnd(12), 'Over'.padStart(6), 'Under'.padStart(6));
    console.log('-'.repeat(24));
    for (const r of results) {
        if (r.ou25Over) {
            console.log(r.name.padEnd(12), String(r.ou25Over).padStart(6), String(r.ou25Under).padStart(6));
        }
    }

    console.log('');
    process.exit(0);
})();
" 2>&1

    cd - > /dev/null
}

list_scrapers() {
    print_section "Dostępne scrapery"
    for key in $(echo "${!SCRAPERS[@]}" | tr ' ' '\n' | sort); do
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
    echo "  ${!SCRAPERS[*]}" | fold -s -w 60 | sed 's/^/  /'
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
