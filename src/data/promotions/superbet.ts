import type { FreebetTerms, Promotion } from "../../types/promotions.js";

// Entries come from the research files and the live terms.
// Terms fetched 2026-11-07 from the wiki JSON (termsUrl, Editor.js blocks) behind the public
// page superbet.pl/wiki/<slug> (publicTermsUrl); quotes are verbatim from the normalized text.
// Superbonus tiers are quoted from the public app config.

const VERIFIED = {
  status: "verified",
  verifiedAt: "2026-11-07T01:30:21+01:00",
  verifiedBy: "research-agent",
} as const;

const OUR_LEAGUES = ["ekstraklasa", "premier-league", "laliga", "serie-a", "ligue-1", "world-cup-2026"];

// Komunikat 01/2022: the company covers the freebet stake and its tax; the win is reduced by the freebet.
function freebet(validDays: number): FreebetTerms {
  return { winFactor: 1, stakeDeduction: 1, validDays };
}

const FREEBET_TAX_QUOTE =
  "zawarcie zakładu bez ponoszenia przez nich kosztu za stawkę, wartość której, wraz z należnym podatkiem, pokryta zostanie ze środków Spółki.";

export const superbetPromotions: Promotion[] = [
  {
    id: "superbet-bonus-powitalny",
    bookmaker: "superbet",
    name: "Bonus powitalny",
    audience: "new_customer",
    recurrence: { kind: "one_time" },
    activation: { kind: "join_button" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      fundsSource: "any",
      requiresConfirmation: [],
      notes: [
        "Pierwszą wpłatę trzeba wykonać w ciągu 14 dni od akceptacji bonusu powitalnego.",
        "Zlecenie wypłaty przed wykorzystaniem freebetu anuluje freebet.",
        "Kod promocyjny przy rejestracji daje dodatkowy freebet 35 zł (osobna pozycja).",
      ],
    },
    effects: [
      {
        effect: {
          type: "DEPOSIT_BONUS",
          depositIndex: 1,
          percent: 100,
          capPln: 200,
          minDepositPln: 20,
          paidAs: { kind: "freebet", terms: freebet(10) },
        },
        // Amount formula is clear; the freebet tax treatment rests on komunikat 01/2022 wording only.
        valuation: "display_only",
      },
      {
        effect: {
          type: "FREEBET_GRANT",
          amountPln: 20,
          trigger: "Pierwszy zakład za środki gotówkowe w aplikacji Superbet w ciągu 7 dni od pierwszej wpłaty (wpłata co najmniej 20 zł)",
          terms: freebet(10),
        },
        valuation: "display_only",
      },
    ],
    stacking: { combinableWith: ["superbet-extra-freebet-35"] },
    source: {
      promoUrl: "https://superbet.pl/wiki/freebet-za-rejestracje-superbet",
      termsUrl: "https://superbet-content.freetls.fastly.net/cached-superbet/wiki/pl/reg-bonusow-powitalnych-122025",
      publicTermsUrl: "https://superbet.pl/wiki/reg-bonusow-powitalnych-122025",
      termsHash: "163b665179bd34d3ddaad568cc31bd97d9c6ebd0810f73595048420579578ba8",
      fetchedAt: "2026-11-07T01:05:19+01:00",
      evidence: {
        // From the public campaign list (getLoggedOutCampaigns, "BONUS POWITALNY").
        audience:
          "Dołącz do Superbet i odbierz: podwojenie pierwszej wpłaty do 200 PLN, Freebet 35 PLN i dodatkowe 20 PLN za zakład w apce!",
        activation: "Freebet zostanie przyznany tylko za pierwszy depozyt klienta po akceptacji bonusu powitalnego.",
        recurrence: "Każdy Gracz może skorzystać z freebetu tylko raz.",
        "eligibility.notes[0]":
          "Klient ma 14 dni na wykonanie pierwszego depozytu od momentu akceptacji freebetu powitalnego.",
        "eligibility.notes[1]": "Jeżeli Gracz zleci polecenie wypłaty środków zanim wykorzysta Freebet, zostanie on anulowany.",
        "effects[0].effect.percent": "Wysokość freebetu to 100% wartości pierwszego depozytu.",
        "effects[0].effect.capPln": "Maksymalna wysokość przyznanej kwoty freebetu to 200 PLN.",
        "effects[0].effect.minDepositPln":
          "Jeśli kwota pierwszego depozytu jest niższa niż 20 PLN, freebet nie zostanie przyznany.",
        "effects[0].effect.paidAs.terms.validDays":
          "Freebet będzie aktywny przez okres 10 dni od momentu otrzymania go przez Gracza.",
        "effects[0].effect.paidAs.terms.stakeDeduction":
          "Freebet nie wymaga żadnego obrotu, niemniej ewentualna wygrana pochodząca z zakładu postawionego za freebet będzie pomniejszona o stawkę freebet i zostanie automatycznie dodana do salda depozytowego.",
        // From komunikat 01/2022 (superbet.pl/wiki/oficjalny-komunikat-nr-012022-z-dnia-010322).
        "effects[0].effect.paidAs.terms.winFactor": FREEBET_TAX_QUOTE,
        "effects[1].effect.amountPln": "„Freebet za zakład w aplikacji”, w którym wysokość bonusu to 20 PLN.",
        "effects[1].effect.trigger":
          "Klient ma 7 dni na pobranie i postawienie zakładu (z oferty sportowej) w aplikacji mobilnej Superbet od momentu wykonania pierwszego depozytu.",
        "effects[1].effect.terms.validDays": "Freebet będzie aktywny przez okres 10 dni.",
        // From the public campaign list (getLoggedOutCampaigns, "BONUS POWITALNY").
        "stacking.combinableWith":
          "Dołącz do Superbet i odbierz: podwojenie pierwszej wpłaty do 200 PLN, Freebet 35 PLN i dodatkowe 20 PLN za zakład w apce!",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "superbet-extra-freebet-35",
    bookmaker: "superbet",
    name: "Extra Freebet 35 PLN",
    audience: "new_customer",
    recurrence: { kind: "one_time" },
    activation: { kind: "registration_code", code: "SUPERBET" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      fundsSource: "any",
      requiresConfirmation: [],
      notes: [
        "Kod partnera może dawać inną kwotę; bukmacher publikuje też wariant regulaminu z freebetem 50 zł.",
      ],
    },
    effects: [
      {
        effect: {
          type: "FREEBET_GRANT",
          amountPln: 35,
          trigger: "Rejestracja z kodem promocyjnym i pierwsza wpłata co najmniej 50 zł; freebet do 48 godzin od wpłaty",
          terms: freebet(3),
        },
        valuation: "display_only",
      },
    ],
    stacking: { combinableWith: ["superbet-bonus-powitalny"] },
    source: {
      promoUrl: "https://superbet.pl/wiki/freebet-za-rejestracje-superbet",
      termsUrl: "https://superbet-content.freetls.fastly.net/cached-superbet/wiki/pl/reg-bonusow-powitalnych-122025",
      publicTermsUrl: "https://superbet.pl/wiki/reg-bonusow-powitalnych-122025",
      termsHash: "163b665179bd34d3ddaad568cc31bd97d9c6ebd0810f73595048420579578ba8",
      fetchedAt: "2026-11-07T01:05:19+01:00",
      evidence: {
        audience:
          "„Extra freebet 35 PLN”, który gracza otrzymuje jeśli podczas procesu rejestracji wpisze specjalny kod i spełni wszystkie warunki.",
        "activation.code":
          "Aby otrzymać Freebet klient musi się zarejestrować z kodem SUPERBET lub innym kodem, który każdorazowo zostanie podany przez partnera Spółki.",
        recurrence: "Każdy Gracz może skorzystać z Freebetu tylko raz.",
        // From the partner-code variant (superbet.pl/wiki/regulamin-bonusow-powitalnych-50).
        "eligibility.notes[0]": "Wysokość Freebetu to 50 PLN.",
        "effects[0].effect.amountPln": "Wysokość Freebetu to 35 PLN.",
        "effects[0].effect.trigger":
          "Freebet przysługuje graczom, którzy dokonali pierwszego depozytu na minimalną kwotę 50 PLN.",
        "effects[0].effect.terms.validDays":
          "Freebet będzie aktywny przez okres 3 dni od momentu otrzymania go przez Gracza.",
        "effects[0].effect.terms.winFactor": FREEBET_TAX_QUOTE,
        // From the public campaign list (getLoggedOutCampaigns, "BONUS POWITALNY").
        "stacking.combinableWith":
          "Dołącz do Superbet i odbierz: podwojenie pierwszej wpłaty do 200 PLN, Freebet 35 PLN i dodatkowe 20 PLN za zakład w apce!",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "superbet-superbonus",
    bookmaker: "superbet",
    name: "Superbonus",
    audience: "everyone",
    recurrence: { kind: "always_on" },
    validFrom: "2026-09-01T00:00:00+02:00",
    activation: { kind: "automatic" },
    eligibility: {
      betTypes: ["accumulator"],
      minLegs: 2,
      fundsSource: "any",
      requiresConfirmation: [],
      notes: [
        "Zdarzenia z kursem poniżej 1.35 nie wykluczają kuponu, ale Superbonus liczony jest wtedy tylko od zdarzeń z kursem co najmniej 1.35; takiego kuponu nie wyceniamy.",
        "Kupon wygrany dzięki Superprzewadze lub Super Zmianie nie dostaje Superbonusu.",
        "Zdarzenia z oferty Boosty nie podnoszą procentu Superbonusu.",
        "Nie dotyczy kuponów systemowych.",
        "Maksymalna wygrana z kuponu z Superbonusem: 2 000 000 zł.",
      ],
    },
    effects: [
      {
        effect: {
          type: "ACCA_BONUS",
          base: "profit",
          tiers: [
            { minLegs: 2, percent: 2 },
            { minLegs: 3, percent: 3 },
            { minLegs: 4, percent: 4 },
            { minLegs: 5, percent: 5 },
            { minLegs: 6, percent: 7 },
            { minLegs: 7, percent: 10 },
            { minLegs: 8, percent: 15 },
            { minLegs: 9, percent: 20 },
            { minLegs: 10, percent: 25 },
            { minLegs: 11, percent: 30 },
            { minLegs: 12, percent: 35 },
            { minLegs: 13, percent: 40 },
            { minLegs: 14, percent: 45 },
            { minLegs: 15, percent: 50 },
            { minLegs: 16, percent: 55 },
            { minLegs: 17, percent: 60 },
            { minLegs: 18, percent: 65 },
            { minLegs: 19, percent: 70 },
            { minLegs: 20, percent: 75 },
            { minLegs: 21, percent: 80 },
            { minLegs: 22, percent: 85 },
            { minLegs: 23, percent: 90 },
            { minLegs: 24, percent: 95 },
            { minLegs: 25, percent: 100 },
          ],
          qualifyingLegMinOdds: 1.35,
          paidAs: { kind: "cash" },
        },
        // Valued only when every leg qualifies: with legs below 1.35 the amount uses qualifying legs only.
        extraEligibility: { odds: { everyLegMin: 1.35 } },
        valuation: "full",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://lp.superbet.pl/lp/new-superbonus-onsite",
      termsUrl: "https://superbet-content.freetls.fastly.net/cached-superbet/wiki/pl/oficjalny_komunikat_superobonus0220211",
      publicTermsUrl: "https://superbet.pl/wiki/oficjalny_komunikat_superobonus0220211",
      termsVersionDate: "2026-11-02",
      termsHash: "00cbe180247c95966471507041b680847d41ecc3499fb18959016ad101dca98c",
      fetchedAt: "2026-11-07T01:05:18+01:00",
      evidence: {
        audience:
          "spółka oferuje swoim Klientom zwiększenie wygranej poprzez zaoferowanie produkt „Superbonus”.",
        recurrence: "Produkt jest dostępny dla wszystkich zakładów przedmeczowych oraz live.",
        validFrom:
          "Postanowienia Oficjalnego Komunikatu wchodzą w życie z dniem 01.09.2026 r., po ogłoszeniu ich na stronie internetowej Spółki.",
        // From the Superbonus wiki page (superbet.pl/wiki/super-bonus).
        "eligibility.minLegs": "Kupon musi zawierać minimum 2 zdarzenia z oferty przedmeczowej lub live.",
        "eligibility.notes[0]":
          "Zdarzenia z kursem poniżej 1.35 nie zwiększają procentu Superbonusu, ale również go nie wykluczają.",
        "eligibility.notes[1]":
          "Jeżeli kupon zostanie rozliczony jako wygrany dzięki \"Superprzewadze\", to nie będzie kwalifikował się do otrzymania Superbonusu;",
        "eligibility.notes[3]": "Zwiększanie wygranej nie nastąpi w przypadku: • Kuponów systemowych;",
        "eligibility.notes[4]": "Maksymalna wygrana na kuponie z uwzględnieniem Superbonusu wynosi 2 000 000 PLN.",
        "effects[0].effect.base":
          "Superbonus to produkt umożliwiający procentowe zwiększenie części wygranych netto (po odjęciu stawki) od 2% do 100% w zależności od liczby kwalifikujących się zdarzeń na kuponie.",
        // From the general regulamin (Regulamin zakładów wzajemnych przez sieć internet, PDF).
        "effects[0].effect":
          "Wysokość wygranej dla poszczególnego Zakładu obliczana jest jako iloczyn wpłaconej stawki, współczynnika określanego przez Spółkę oraz iloczynu Kursów Zdarzeń.",
        // From the app config (superbet.pl/static/js/fetchConfig/app); the wiki shows the same table as an image.
        "effects[0].effect.tiers":
          '"superBonusBreakpoints":"2_0.02|3_0.03|4_0.04|5_0.05|6_0.07|7_0.10|8_0.15|9_0.20|10_0.25|11_0.30|12_0.35|13_0.40|14_0.45|15_0.50|16_0.55|17_0.60|18_0.65|19_0.70|20_0.75|21_0.80|22_0.85|23_0.90|24_0.95|25_1.00"',
        "effects[0].effect.qualifyingLegMinOdds": "Do obliczania Superbonusu uwzględniane są jedynie zdarzenia z kursem min. 1.35.",
        "effects[0].extraEligibility.odds.everyLegMin": "Kwota Superbonusu jest naliczana wyłącznie dla kwalifikujących się zdarzeń.",
        "stacking.combinableWith": "Superprzewaga nie łączy się z SuperBonusem.",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "superbet-superprzewaga",
    bookmaker: "superbet",
    name: "Superprzewaga",
    audience: "everyone",
    recurrence: { kind: "always_on" },
    validFrom: "2026-10-23T00:00:00+02:00",
    activation: { kind: "automatic" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      fundsSource: "any",
      leagues: OUR_LEAGUES,
      requiresConfirmation: [],
      notes: [
        "Dotyczy typu na zwycięstwo gospodarzy lub gości w rynku «Mecz», tylko w zakładach przedmeczowych; remis nie jest objęty.",
        "Kupon wygrany dzięki Superprzewadze nie dostaje Superbonusu.",
        "Nie dotyczy zakładów z podwyższonym kursem Super Boosty.",
      ],
    },
    effects: [
      {
        effect: { type: "EARLY_WIN", rule: "two_goal_lead", markets: ["MATCH_WINNER"] },
        valuation: "full",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://superbet.pl/lp/superprzewaga",
      termsUrl: "https://superbet-content.freetls.fastly.net/cached-superbet/wiki/pl/reg-promocji-super-przewaga",
      publicTermsUrl: "https://superbet.pl/wiki/reg-promocji-super-przewaga",
      termsVersionDate: "2026-10-23",
      termsHash: "e317164d812cd1450872b517485fcb2e3f0c141086ede371d0117b1c2cdb585b",
      fetchedAt: "2026-11-07T01:05:18+01:00",
      evidence: {
        audience:
          "Uczestnikami Promocji mogą być wyłącznie osoby pełnoletnie, mające pełną zdolność do czynności prawnych, zamieszkałe na terenie Rzeczpospolitej Polskiej",
        recurrence: "Wystarczy, że postawisz kupon przedmeczowy na wyszczególnione powyżej rynki, w okresie jej trwania.",
        validFrom: "Regulamin i Promocja nim objęta obowiązuje od 23.10.2026 roku aż do odwołania.",
        "eligibility.betTypes":
          "Do oferty kwalifikują się zakłady typu singiel, zakłady akumulowane, a także zakłady systemowe.",
        "eligibility.leagues[0]": "Polska: Ekstraklasa - wszystkie mecze",
        "eligibility.leagues[1]": "Anglia - Premier League - wszystkie mecze",
        "eligibility.leagues[2]": "Hiszpania - LaLiga - wszystkie mecze",
        "eligibility.leagues[3]": "Włochy - Serie A - wszystkie mecze",
        "eligibility.leagues[4]": "Francja - Ligue 1 - wszystkie mecze",
        "eligibility.leagues[5]": "Mistrzostwa Świata 2026 - wszystkie mecze",
        "eligibility.notes[1]":
          "Jeśli kupon zostanie wygrany dzięki Superprzewadze, to nie będzie kwalifikował się do otrzymania SuperBonusu.",
        "eligibility.notes[2]": "Superprzewaga nie obowiązuje w przypadku zakładów z podwyższonym kursem \"Super Boosty\".",
        "effects[0].effect.rule": "Piłka nożna – dwubramkowej przewagi, niezależnie od wyniku końcowego meczu.",
        "effects[0].effect.markets":
          "Piłka nożna - Objęte promocją podgry zakładów to: „Mecz” (1,2) z oferty regularnej oraz BetBuilder",
        "stacking.combinableWith": "Superprzewaga nie łączy się z SuperBonusem.",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "superbet-super-zmiana",
    bookmaker: "superbet",
    name: "Super Zmiana",
    audience: "everyone",
    recurrence: { kind: "always_on" },
    validFrom: "2025-12-17T00:00:00+01:00",
    activation: { kind: "automatic" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      fundsSource: "any",
      requiresConfirmation: [],
      notes: [
        "Tylko zakłady na statystyki zawodników oznaczone ikoną Super Zmiana; nie dotyczy typów «Poniżej».",
        "Kupon wygrany dzięki Super Zmianie nie dostaje Superbonusu.",
      ],
    },
    effects: [
      {
        effect: {
          type: "OTHER",
          description:
            "Gdy zawodnik z zakładu na jego statystyki zejdzie z boiska w regulaminowym czasie gry, zakład przechodzi na zmiennika.",
        },
        valuation: "display_only",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://lp.superbet.pl/lp/super-zmiana",
      termsUrl: "https://superbet-content.freetls.fastly.net/cached-superbet/wiki/pl/regulamin-super-zmiana",
      publicTermsUrl: "https://superbet.pl/wiki/regulamin-super-zmiana",
      termsVersionDate: "2026-08-28",
      termsHash: "f7cef2b055a2acd62a62d0e3fc6976ca4a9e0a614ba2f04172c7eba26e5ec483",
      fetchedAt: "2026-11-07T01:05:19+01:00",
      evidence: {
        audience: "Promocja jest kierowana dla graczy posiadających aktywne konta gracza na stronie internetowej.",
        recurrence: "Regulamin i Promocja nim objęta obowiązuje od 17.12.2025 do odwołania.",
        validFrom: "Regulamin i Promocja nim objęta obowiązuje od 17.12.2025 do odwołania.",
        "effects[0].effect.description":
          "jeśli wybrany przez Ciebie zawodnik zostanie zmieniony, zakład automatycznie przenosi się na jego zastępcę i pozostaje aktywny, o ile wynik nie został jeszcze rozstrzygnięty.",
        "eligibility.notes[0]": "Super Zmiana nie ma zastosowania do zakładów typu „Poniżej” w zakładach dotyczących zawodników.",
        "eligibility.notes[1]": "Kupony rozliczone jako wygrane dzięki Super Zmianie nie kwalifikują się do otrzymania SuperBonusu.",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "superbet-boosty",
    bookmaker: "superbet",
    name: "Boosty",
    audience: "everyone",
    recurrence: { kind: "always_on" },
    validFrom: "2026-06-01T00:00:00+02:00",
    activation: { kind: "automatic" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      fundsSource: "any",
      requiresConfirmation: [],
      notes: [
        "Boosty nie podnoszą procentu Superbonusu i nie są objęte Superprzewagą; są objęte Super Zmianą.",
        "Podwyższonych kursów z Boostów nie porównujemy.",
      ],
    },
    effects: [
      {
        effect: {
          type: "OTHER",
          description: "Codzienne podwyższone kursy na wybrane zdarzenia, przed meczem i na żywo.",
        },
        valuation: "display_only",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://superbet.pl/lp/superboosty",
      termsUrl: "https://superbet-content.freetls.fastly.net/cached-superbet/wiki/pl/oficjalny-komunikat-412026",
      publicTermsUrl: "https://superbet.pl/wiki/oficjalny-komunikat-412026",
      termsVersionDate: "2026-06-01",
      termsHash: "619e65ca0a5c891fc236d9c8cc901a2c836dd1f44502f9a7d58706e12c48b547",
      fetchedAt: "2026-11-07T01:08:06+01:00",
      evidence: {
        validFrom: "Postanowienia Oficjalnego Komunikatu wchodzą w życie z dniem 01.06.2026 r., po ogłoszeniu ich na stronie internetowej Spółki.",
        // From the public campaign list (getLoggedOutCampaigns).
        recurrence:
          "Codziennie podwyższone kursy na topowe zdarzenia sportowe w różnych dyscyplinach – zarówno przedmeczowo, jak i live.",
        "eligibility.notes[0]": "„Boosty” nie zwiększają wartości „SuperBonusu”.",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "superbet-super-coins",
    bookmaker: "superbet",
    name: "Program lojalnościowy Super Coins",
    audience: "everyone",
    loyaltyProgram: true,
    recurrence: { kind: "always_on" },
    activation: { kind: "join_button" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      fundsSource: "any",
      requiresConfirmation: [
        { key: "superbet_verified_account", label: "Mam zweryfikowane konto w Superbet", expires: "never" },
        { key: "superbet_marketing_consents", label: "Mam włączone zgody marketingowe w Superbet", expires: "never" },
      ],
      notes: [
        "Program jest w fazie testowej: Super Coins za aktywność w zakładach dostaje tylko grupa graczy wybrana przez Superbet.",
        "Super Coins nie mają terminu ważności.",
      ],
    },
    effects: [
      {
        effect: {
          type: "OTHER",
          description: "Super Coins za Misje i Super Spin, wymieniane w Sklepie z Nagrodami m.in. na freebety.",
        },
        valuation: "display_only",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://lp.superbet.pl/lp/super-coins",
      termsUrl: "https://superbet-content.freetls.fastly.net/cached-superbet/wiki/pl/program-lojalnosciowy-supercoins-012026",
      publicTermsUrl: "https://superbet.pl/wiki/program-lojalnosciowy-supercoins-012026",
      termsVersionDate: "2026-05-13",
      termsHash: "0b81d2615577fa7b597a8bec8443aa4338f6b0d2b7e0a1f007b5328a9f1979df",
      fetchedAt: "2026-11-07T01:08:25+01:00",
      evidence: {
        audience: "posiadać zweryfikowane i aktywne konto użytkownika na stronie superbet.pl.",
        activation: "Poprzez przystąpienie do Programu Lojalnościowego Super Coins Uczestnik potwierdza i zgadza się",
        recurrence: "Grasz jak zawsze, zgarniasz więcej. Wykonuj Misje, zbieraj Super Coins i wymieniaj je na nagrody!",
        "eligibility.requiresConfirmation[1]":
          "Zgoda marketingowa: wyrazić wyraźną zgodę na otrzymywanie komunikacji promocyjnej od Spółki.",
        "eligibility.notes[0]":
          "Przyznawanie Super Coins w trakcie Fazy Testowej odbywa się w ograniczonym zakresie i jest dostępne wyłącznie dla określonego procentu Użytkowników, według wyłącznego uznania Superbet.",
        "eligibility.notes[1]":
          "O ile nie wskazano inaczej w niniejszym Regulaminie, Super Coins zachowują ważność bezterminowo.",
        "effects[0].effect.description":
          "Super Coins mogą być wymieniane wyłącznie w Sklepie z Nagrodami Superbet na wyznaczone nagrody",
      },
    },
    review: VERIFIED,
    version: 1,
  },
];
