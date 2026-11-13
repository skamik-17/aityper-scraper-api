import type { FreebetTerms, Promotion, PromotionEffectEntry } from "../../types/promotions.js";

// Entries come from the research files and the live terms.
//
// Sources (fetched 2026-11-07):
// - Regulamins: server-rendered HTML on pomoc.lebull.pl / lebull.kb.help.
// - Promo pages without a regulamin (ByczeKombi, ByczaPrzewaga): the public CMS JSON
//   https://www.lebull.pl/share/promotions/{slug}, fetched with the header `X-Locale: pl`
//   (without it the text comes back in English). termsHash = sha256 of the text fields
//   (title, text_short, text_full, show_to) after HTML stripping and whitespace collapse.
// - The ByczeKombi tier table lives only in https://www.lebull.pl/share/translate/pl
//   (keys promotion_cb_bycze-kombi_*); its evidence quotes are raw JSON fragments.
// - Freebets: win = odds x 0.88 x FB - FB x 0.88 (stake not returned), stated in every regulamin.
// - The KnowledgeBase pages show "ostatnia aktualizacja : 08.20.2026" (MM.DD.YYYY), read as 2026-08-20.
// - The general betting rules page on pomoc.lebull.pl is archived ("obowiązywał do 30.12.2025"),
//   so it is not used as a source.

const VERIFIED = {
  status: "verified",
  verifiedAt: "2026-11-07T00:19:23Z",
  verifiedBy: "research-agent",
} as const;

/** Le Bull freebet: profit only, 12 % taken off the freebet stake. */
function lebullFreebet(over: Partial<FreebetTerms> = {}): FreebetTerms {
  return { winFactor: 0.88, stakeDeduction: 0.88, ...over };
}

const FREEBET_FORMULA_QUOTE =
  "Wygrana kwota = [kurs (kurs całkowity) x wskaźnik (0,88) x stawka (wartość Freebetu)] – stawka x wskaźnik (0,88)";

/**
 * One ByczaSeria streak tier. display_only: rewards are cut pro rata once the monthly
 * prize pool (500 000 zł) is exceeded, so the amount is not guaranteed.
 */
function seriaTier(days: number, rewardPln: number): PromotionEffectEntry {
  return {
    effect: {
      type: "TASK_REWARD",
      task: `Kwalifikujący kupon ${days} dni z rzędu`,
      rewardPln,
      paidAs: { kind: "freebet", terms: lebullFreebet({ validDays: 4, maxWinPln: rewardPln * 5 }) },
    },
    valuation: "display_only",
  };
}

export const lebullPromotions: Promotion[] = [
  {
    id: "lebull-byczystart",
    bookmaker: "lebull",
    name: "Bonus Powitalny – 950 PLN",
    audience: "new_customer",
    recurrence: { kind: "one_time" },
    validFrom: "2025-07-21T12:00:00+02:00",
    activation: { kind: "choose_at_deposit" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      fundsSource: "any",
      requiresConfirmation: [],
      notes: [
        "Na stronie Le Bull pakiet nazywa się ByczyStart.",
        "Pakiet ma trzy części, które wybierasz przy wpłacie w stałej kolejności (1., 2., 3.). Nie muszą to być kolejne wpłaty.",
        "Do obrotu liczą się kupony SINGIEL i KOMBI z co najmniej jednym zdarzeniem po kursie 1.95 lub wyższym, postawione z salda głównego. Zwroty i cashout się nie liczą.",
        "Środkami bonusowymi grasz dopiero, gdy saldo główne wynosi 0 zł. Zlecenie wypłaty przed końcem obrotu anuluje bonus.",
        "Z bonusu po obrocie można wypłacić najwyżej 15-krotność bonusu.",
        "Freebety: dowolny zakład przedmeczowy lub na żywo, bez obrotu i bez wymogu kursu, ważne 24 godziny, wygrana do 5-krotności freebeta.",
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
          paidAs: {
            kind: "bonus_funds",
            wagering: {
              multiplier: 3,
              of: "deposit",
              ownFundsOnly: true,
              odds: { anyLegMin: 1.95 },
              days: 4,
              baseCapPln: 200,
              depositLocked: true,
            },
          },
        },
        valuation: "full",
      },
      {
        effect: {
          type: "FREEBET_GRANT",
          amountPln: 20,
          trigger: "Wpłata z wybraną 1. częścią pakietu",
          terms: lebullFreebet({ validDays: 1, maxWinPln: 100 }),
        },
        valuation: "full",
      },
      {
        effect: {
          type: "DEPOSIT_BONUS",
          depositIndex: 2,
          percent: 50,
          capPln: 300,
          minDepositPln: 20,
          paidAs: {
            kind: "bonus_funds",
            wagering: {
              multiplier: 3,
              of: "deposit",
              ownFundsOnly: true,
              odds: { anyLegMin: 1.95 },
              days: 4,
              baseCapPln: 600,
              depositLocked: true,
            },
          },
        },
        valuation: "full",
      },
      {
        effect: {
          type: "FREEBET_GRANT",
          amountPln: 20,
          trigger: "Wpłata z wybraną 2. częścią pakietu",
          terms: lebullFreebet({ validDays: 1, maxWinPln: 100 }),
        },
        valuation: "full",
      },
      {
        effect: {
          type: "DEPOSIT_BONUS",
          depositIndex: 3,
          percent: 50,
          capPln: 400,
          minDepositPln: 20,
          paidAs: {
            kind: "bonus_funds",
            wagering: {
              multiplier: 3,
              of: "deposit",
              ownFundsOnly: true,
              odds: { anyLegMin: 1.95 },
              days: 4,
              baseCapPln: 800,
              depositLocked: true,
            },
          },
        },
        valuation: "full",
      },
      {
        effect: {
          type: "FREEBET_GRANT",
          amountPln: 10,
          trigger: "Wpłata z wybraną 3. częścią pakietu",
          terms: lebullFreebet({ validDays: 1, maxWinPln: 50 }),
        },
        valuation: "full",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://www.lebull.pl/pl/promocje-bukmacherskie/bonus-powitalny",
      termsUrl: "https://pomoc.lebull.pl/regulamin-promocji-bonus-powitalny-950-pln-2107/",
      termsVersionDate: "2026-08-20",
      termsHash: "33b091a55b9b6b264795c6b577853c25e5513493feb9c49cf92eaa8f82581607",
      fetchedAt: "2026-11-07T00:04:34Z",
      evidence: {
        "source.termsVersionDate": "ostatnia aktualizacja : 08.20.2026",
        audience:
          "W Promocji mogą uczestniczyć wyłącznie Klienci, którzy nie skorzystali z wcześniej dostępnych bonusów powitalnych.",
        validFrom: "Promocja obowiązuje od dnia 21.07.2025 r. od godziny 12:00 do odwołania.",
        recurrence:
          "Promocja startowa składa się z trzech oddzielnych Nagród. Każdy Uczestnik promocji ma możliwość skorzystania z:",
        activation:
          "W trakcie realizacji każdego z promocyjnych depozytów, przed potwierdzeniem wpłaty należy wybrać Nagrodę aby móc skorzystać z oferty promocyjnej.",
        "effects[0].effect.percent":
          "a) Pierwszej Nagrody w postaci Bonusu udostępnionego do gry o równowartości 100% depozytu, jednak nie więcej niż 200 PLN, a także Freebetu (darmowego zakładu) 20 PLN,",
        "effects[0].effect.minDepositPln":
          "należy dokonać wpłaty depozytu w kwocie co najmniej 20 PLN (na warunkach określonych w punkcie 3.1). Maksymalna kwota Bonusu, którą można otrzymać, wynosi 200 PLN.",
        "effects[0].effect.paidAs.wagering.multiplier":
          "Aby wypłacić środki bonusowe, Uczestnik musi wykonać trzykrotny obrót depozytem, wyzwalającym Bonus. W przypadku gdy kwota wpłaty przekracza 200 zł, do obliczania wymaganego obrotu uwzględniana jest kwota maksymalnie 200 zł.",
        "effects[0].effect.paidAs.wagering.odds.anyLegMin":
          "Do obrotu zaliczają się wyłącznie zakłady SINGIEL lub KOMBI, które zawierają przynajmniej jedno zdarzenie z minimalnym kursem 1.95 (nie chodzi o łączny kurs zakładu, lecz o minimalny kurs jednego ze zdarzeń).",
        "effects[0].effect.paidAs.wagering.ownFundsOnly":
          "Zakłady zaliczane do obrotu muszą być zawierane wyłącznie z salda głównego (saldo „Twoje środki”).",
        "effects[0].effect.paidAs.wagering.days":
          "należy postawić zakład/y w okresie 4 dni od momentu przyznania Bonusu",
        "effects[0].effect.paidAs.wagering.depositLocked":
          "Do czasu zrealizowania wymaganego obrotu (w celu uwolnienia Bonusu) możliwość wypłat z konta depozytowego jest zablokowana.",
        "effects[1].effect.amountPln":
          "Freebet 20 PLN zostanie przypisany do konta natychmiastowo po wykonaniu depozytu, o którym mowa w punkcie 3.2.1.",
        "effects[1].effect.terms.winFactor": FREEBET_FORMULA_QUOTE,
        "effects[1].effect.terms.validDays":
          "Zawarcie zakładu za Freebet musi nastąpić najpóźniej w terminie 24 godzin od momentu jego aktywacji.",
        "effects[1].effect.terms.maxWinPln":
          "Maksymalna wygrana w zakładzie zawartym za Freebet ograniczona jest do pięciokrotności wartości Freebetu",
        "effects[2].effect.percent":
          "b) Drugiej Nagrody w postaci Bonusu udostępnionego do gry o równowartości 50% depozytu, jednak nie więcej niż 300 PLN, a także Freebetu (darmowego zakładu) 20 PLN,",
        "effects[2].effect.paidAs.wagering.baseCapPln":
          "W przypadku gdy kwota wpłaty przekracza 600 zł, do obliczania wymaganego obrotu uwzględniana jest kwota maksymalnie 600 zł.",
        "effects[3].effect.amountPln":
          "Freebet 20 PLN zostanie przypisany do konta natychmiastowo po wykonaniu depozytu, o którym mowa w punkcie 3.3.1.",
        "effects[4].effect.percent":
          "c) Trzeciej Nagrody w postaci Bonusu udostępnionego do gry o równowartości 50% depozytu, jednak nie więcej niż 400 PLN, a także Freebetu (darmowego zakładu) 10 PLN.",
        "effects[4].effect.paidAs.wagering.baseCapPln":
          "W przypadku gdy kwota wpłaty przekracza 800 zł, do obliczania wymaganego obrotu uwzględniana jest kwota maksymalnie 800 zł.",
        "effects[5].effect.amountPln":
          "Freebet 10 PLN zostanie przypisany do konta natychmiastowo po wykonaniu depozytu, o którym mowa w punkcie 3.4.1.",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "lebull-przetestuj-10-pln",
    bookmaker: "lebull",
    name: "10 PLN za darmo – przetestuj Lebull",
    audience: "new_customer",
    recurrence: { kind: "one_time" },
    validFrom: "2025-07-21T12:00:00+02:00",
    activation: { kind: "registration_code", code: "EXTRA10" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      fundsSource: "own_money_only",
      accountAgeDays: { to: 3 },
      requiresConfirmation: [
        {
          key: "lebull_kyc_within_3_days",
          label: "Zweryfikowałem konto w Le Bull w ciągu 3 dni od rejestracji",
          expires: "never",
        },
        {
          key: "lebull_marketing_consents",
          label: "Mam włączone zgody marketingowe w Le Bull",
          expires: "never",
        },
      ],
      notes: [
        "Po spełnieniu warunków Le Bull wysyła w ciągu 48 godzin e-mail z kodem, który wpisujesz w profilu.",
        "Bonus 10 zł wymaga obrotu 50 zł środkami własnymi (potrzebna wpłata) w ciągu 2 dni, kupony SINGIEL lub KOMBI z co najmniej jednym zdarzeniem po kursie 1.95 lub wyższym.",
        "Z bonusu po obrocie można wypłacić najwyżej 25-krotność bonusu. Zlecenie wypłaty anuluje aktywny bonus.",
      ],
    },
    effects: [
      {
        effect: {
          type: "TASK_REWARD",
          task: "Rejestracja, pełna weryfikacja konta w ciągu 3 dni i zgody marketingowe",
          rewardPln: 10,
          paidAs: {
            kind: "bonus_funds",
            wagering: {
              multiplier: 5,
              of: "bonus",
              ownFundsOnly: true,
              odds: { anyLegMin: 1.95 },
              days: 2,
            },
          },
        },
        valuation: "full",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://www.lebull.pl/pl/promocje-bukmacherskie/przetestuj-za-darmo",
      termsUrl: "https://lebull.kb.help/regulamin-promocji-10-pln-za-darmo-przetestuj-lebull/",
      termsVersionDate: "2026-08-20",
      termsHash: "3c310983df9e74b6279480efba51d11920b47f54d045584f726ac6d5d0ca56b4",
      fetchedAt: "2026-11-07T00:04:35Z",
      evidence: {
        "source.termsVersionDate": "ostatnia aktualizacja : 08.20.2026",
        audience:
          "ma możliwość skorzystania z Bonusu 10 PLN w ciągu 3 dni od rejestracji (z zastrzeżeniem postanowień punktu 4.), pod warunkiem:",
        validFrom: "Promocja obowiązuje od 21.07.2025 r. od godziny 12:00 do odwołania.",
        // The code itself is on the promo page JSON (/share/promotions/przetestuj-za-darmo), not in the regulamin.
        "activation.code": "Załóż konto z kodem EXTRA10",
        "eligibility.accountAgeDays.to": "Pełnej weryfikacji konta w okresie do 3 dni od momentu rejestracji;",
        "eligibility.requiresConfirmation": "Wyrażenia zgód marketingowych.",
        "effects[0].effect.rewardPln":
          "ma możliwość skorzystania z Bonusu 10 PLN w ciągu 3 dni od rejestracji (z zastrzeżeniem postanowień punktu 4.), pod warunkiem:",
        "effects[0].effect.paidAs.wagering.multiplier":
          "Aby wypłacić środki bonusowe, Uczestnik musi zrealizować obrót w kwocie równej pięciokrotności kwoty Bonusu",
        "effects[0].effect.paidAs.wagering.odds.anyLegMin":
          "Do obrotu zaliczają się wyłącznie zakłady SINGIEL lub KOMBI, które zawierają przynajmniej jedno zdarzenie z minimalnym kursem 1.95 (chodzi o minimalny kurs pojedynczej selekcji a nie o łączny kurs zakładu).",
        "effects[0].effect.paidAs.wagering.ownFundsOnly":
          "Zakłady zaliczane do obrotu muszą być zawierane wyłącznie z salda głównego (saldo „Twoje środki”).",
        "effects[0].effect.paidAs.wagering.days":
          "Uczestnik ma 2 dni (licząc od momentu przyznania Bonusu), aby spełnić warunki promocji.",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "lebull-bycze-kombi",
    bookmaker: "lebull",
    name: "ByczeKombi",
    audience: "everyone",
    recurrence: { kind: "always_on" },
    activation: { kind: "automatic" },
    eligibility: {
      betTypes: ["accumulator"],
      fundsSource: "any",
      requiresConfirmation: [],
      notes: [
        "Do progu liczą się tylko zdarzenia z kursem 1.25 lub wyższym. Bonus zaczyna się od 5 takich zdarzeń.",
        "Le Bull nie publikuje regulaminu ByczeKombi. Tabela progów pochodzi z tekstów strony bukmachera.",
      ],
    },
    effects: [
      {
        effect: {
          type: "ACCA_BONUS",
          base: "total_odds",
          tiers: [
            { minLegs: 5, percent: 5 },
            { minLegs: 6, percent: 10 },
            { minLegs: 7, percent: 12 },
            { minLegs: 8, percent: 15 },
            { minLegs: 9, percent: 20 },
            { minLegs: 10, percent: 25 },
            { minLegs: 11, percent: 30 },
            { minLegs: 12, percent: 40 },
            { minLegs: 13, percent: 50 },
            { minLegs: 14, percent: 60 },
            { minLegs: 15, percent: 70 },
            { minLegs: 16, percent: 80 },
            { minLegs: 17, percent: 90 },
            { minLegs: 18, percent: 100 },
            { minLegs: 19, percent: 125 },
            { minLegs: 20, percent: 150 },
          ],
          qualifyingLegMinOdds: 1.25,
          paidAs: { kind: "cash" },
        },
        // No regulamin: the base (multiplier on total odds vs. on winnings) and the minimum
        // stake are not stated in any terms document.
        valuation: "display_only",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://www.lebull.pl/pl/promocje-bukmacherskie/bycze-kombi",
      termsUrl: "https://www.lebull.pl/share/promotions/bycze-kombi",
      publicTermsUrl: "https://www.lebull.pl/pl/promocje-bukmacherskie/bycze-kombi",
      termsHash: "56ed28aad765a9098af8a973d37543e2dfac44dc33b232c7c0a6093fb02fcd3f",
      fetchedAt: "2026-11-07T00:03:29Z",
      evidence: {
        audience: "Promocja może objąć każdy Twój kupon.",
        recurrence: "Promocja nigdy się nie kończy, trwa 24h na dobę.",
        "effects[0].effect.qualifyingLegMinOdds": "Liczymy każde zdarzenie z kursem min. 1.25",
        "effects[0].effect.base":
          "Bazując na ilości zdarzeń, automatycznie dodamy kurs do kuponu zwiększając Twoją wygraną.",
        // Raw fragments of https://www.lebull.pl/share/translate/pl (fetched 2026-11-07T00:03:38Z).
        "effects[0].effect.tiers[0]": '"promotion_cb_bycze-kombi_odds_5":"1.05"',
        "effects[0].effect.tiers[0].percent": '"promotion_cb_bycze-kombi_percent_5":"+ 5%"',
        "effects[0].effect.tiers[15]": '"promotion_cb_bycze-kombi_odds_20":"2.50"',
        "effects[0].effect.tiers[15].percent": '"promotion_cb_bycze-kombi_percent_20":"+ 150%"',
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "lebull-bycza-przewaga",
    bookmaker: "lebull",
    name: "ByczaPrzewaga",
    audience: "everyone",
    recurrence: { kind: "always_on" },
    activation: { kind: "automatic" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      fundsSource: "any",
      requiresConfirmation: [],
      notes: [
        "Działa też w ByczymBuilderze oraz w innych rozgrywkach, m.in. Lidze Mistrzów, Lidze Europy, Lidze Konferencji, Bundeslidze, 1. i 2. Lidze oraz Pucharze Polski.",
      ],
    },
    effects: [
      {
        effect: { type: "EARLY_WIN", rule: "two_goal_lead", markets: ["MATCH_WINNER"] },
        // The restriction applies per bet (selections with the badge), so the coupon can mix
        // covered and uncovered legs.
        extraEligibility: {
          leagues: ["world-cup-2026", "ekstraklasa", "premier-league", "laliga", "serie-a", "ligue-1"],
          markets: ["MATCH_WINNER"],
          notes: [
            "Tylko zakłady przedmeczowe na zwycięstwo drużyny (1 lub 2 w 1X2) oznaczone plakietką «ByczaPrzewaga».",
          ],
        },
        // Coverage depends on the bookmaker's per-bet badge, which we do not scrape.
        valuation: "display_only",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://www.lebull.pl/pl/promocje-bukmacherskie/bycza-przewaga",
      termsUrl: "https://www.lebull.pl/share/promotions/p-bycza-przewaga",
      publicTermsUrl: "https://www.lebull.pl/pl/promocje-bukmacherskie/bycza-przewaga",
      termsHash: "285e2c2a535f77632a184ec501922a24a4a86b0ffec7207f78083676e83ddc2f",
      fetchedAt: "2026-11-07T00:07:04Z",
      evidence: {
        audience:
          "Promocja trwa 24 godziny na dobę, 7 dni w tygodniu i obejmuje każdy kupon spełniający jej warunki.",
        recurrence:
          "Promocja trwa 24 godziny na dobę, 7 dni w tygodniu i obejmuje każdy kupon spełniający jej warunki.",
        "effects[0].extraEligibility.markets":
          "Promocja obejmuje oznaczone plakietką „ByczaPrzewaga” zakłady na zwycięstwo drużyny w rynku 1X2.",
        "eligibility.betTypes":
          "Kwalifikują się kupony SINGLE, KOMBI oraz ByczyBuilder zawarte przed rozpoczęciem meczu.",
        "effects[0].extraEligibility.leagues":
          "DZIAŁA W TOPOWYCH LIGACH 🌍 Mistrzostwa Świata 🏅 Liga Narodów 🏆 Liga Mistrzów (+ kw.) 🏆 Liga Europy (+ kw.) 🏆 Liga Konferencji 🌍 Kwalifikacje do MŚ 🇵🇱 Ekstraklasa",
        "effects[0].extraEligibility.leagues[2]": "🇬🇧 Premier League 🇩🇪 Bundesliga 🇪🇸 LaLiga 🇮🇹 Serie A 🇫🇷 Ligue 1",
        "effects[0].effect.rule":
          "Jeśli postawisz na zwycięstwo drużyny, a ta w trakcie meczu obejmie prowadzenie różnicą dwóch goli, Twój zakład zostaje rozliczony jako wygrany — niezależnie od tego, jak zakończy się mecz.",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "lebull-bycza-gotowka",
    bookmaker: "lebull",
    name: "Gotówka za kupony",
    audience: "everyone",
    recurrence: { kind: "per_period", period: "week" },
    validFrom: "2025-02-10T00:00:00+01:00",
    activation: { kind: "choose_at_deposit" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      odds: { anyLegMin: 1.95 },
      fundsSource: "own_money_only",
      requiresConfirmation: [
        {
          key: "lebull_no_active_bonus",
          label: "Nie mam w Le Bull aktywnego ani oczekującego bonusu",
          expires: "end_of_day",
        },
      ],
      notes: [
        "Na stronie Le Bull promocja nazywa się ByczaGotówka.",
        "Poziom nagrody wybierasz przy wpłacie, tylko w poniedziałek lub wtorek. Na postawienie kuponów masz 48 godzin od przyznania nagrody.",
        "Wynik kuponów nie ma znaczenia. Zwroty i cashout nie liczą się do sumy stawek.",
        "Nagroda trafia na saldo główne po rozliczeniu kuponów. Zlecenie wypłaty przed czasem anuluje nagrodę.",
      ],
    },
    effects: [
      {
        effect: {
          type: "TASK_REWARD",
          task: "Kupony za łącznie 250 zł w 48 godzin",
          rewardPln: 25,
          paidAs: { kind: "cash" },
        },
        valuation: "full",
      },
      {
        effect: {
          type: "TASK_REWARD",
          task: "Kupony za łącznie 450 zł w 48 godzin",
          rewardPln: 50,
          paidAs: { kind: "cash" },
        },
        valuation: "full",
      },
      {
        effect: {
          type: "TASK_REWARD",
          task: "Kupony za łącznie 600 zł w 48 godzin",
          rewardPln: 75,
          paidAs: { kind: "cash" },
        },
        valuation: "full",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://www.lebull.pl/pl/promocje-bukmacherskie/25-50-75",
      termsUrl: "https://lebull.kb.help/regulamin-promocji-gotowka-za-kupony/",
      termsVersionDate: "2026-08-20",
      termsHash: "4b3351fb3eb0db78c53c8e2af66d1b1d8c3ed02c642ed9bd8c45b485aaef2b22",
      fetchedAt: "2026-11-07T00:04:36Z",
      evidence: {
        "source.termsVersionDate": "ostatnia aktualizacja : 08.20.2026",
        audience:
          "Każdy Uczestnik Promocji, który w okresie jej trwania wpłaci na konto LEBULL dowolny depozyt, otrzyma do wyboru jedną z dostępnych nagród w postaci środków na konto główne w kwocie: 25, 50 lub 75 zł",
        validFrom: "Promocja obowiązuje w każdy poniedziałek i wtorek, od 10.02.2025 r. od godziny 00:00 do odwołania.",
        // From the promo page JSON (/share/promotions/25-50-75).
        recurrence:
          "Promocja jest cykliczna i wraca co tydzień. W każdym tygodniu możesz wybrać jeden poziom nagrody, jeśli spełniasz warunki promocji.",
        "eligibility.requiresConfirmation":
          "Uczestnictwo w promocji jest możliwe wyłącznie dla osób, które nie posiadają aktywnych lub oczekujących bonusów.",
        "eligibility.odds.anyLegMin":
          "Do promocji zaliczają się zakłady SINGIEL lub KOMBI, które zawierają przynajmniej jedno zdarzenie z minimalnym kursem 1.95.",
        "eligibility.fundsSource": "Uczestnik musi postawić kupony z konta depozytowego na łączną sumę:",
        "effects[0].effect.rewardPln": "250 zł (w przypadku wyboru Nagrody w kwocie 25 zł)",
        "effects[0].effect.paidAs":
          "Nagroda zostanie wypłacona na konto depozytowe Uczestnika natychmiastowo po rozliczeniu kuponów na łączną sumę stawek, o której mowa w ust. 3.4.",
        "effects[1].effect.rewardPln": "450 zł (w przypadku wyboru Nagrody w kwocie 50 zł)",
        "effects[2].effect.rewardPln":
          "600 zł (w przypadku wyboru Nagrody w kwocie 75 zł), w okresie 48 godzin od momentu przyznania Nagrody.",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "lebull-bycza-seria",
    bookmaker: "lebull",
    name: "ByczaSeria – aktywni wygrywają więcej",
    audience: "everyone",
    recurrence: { kind: "per_period", period: "month" },
    validFrom: "2025-06-01T00:00:00+02:00",
    activation: { kind: "automatic" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      odds: { totalMin: 1.95 },
      minStakePln: 25,
      fundsSource: "own_money_only",
      requiresConfirmation: [],
      notes: [
        "Każdego dnia z rzędu jeden kupon za co najmniej 25 zł po kursie łącznym 1.95 lub wyższym, postawiony i rozliczony tego samego dnia. Wynik nie ma znaczenia.",
        "Jeden dzień przerwy kończy serię. W miesiącu można mieć tylko jedną serię. Zwroty i cashout się nie liczą.",
        "Freebet przychodzi do 4 dni po końcu miesiąca, jest ważny 96 godzin, bez wymogu kursu, wygrana do 5-krotności freebeta.",
        "Pula nagród w miesiącu to 500 000 zł. Po jej przekroczeniu nagrody są proporcjonalnie obniżane.",
      ],
    },
    effects: [
      seriaTier(7, 25),
      seriaTier(8, 30),
      seriaTier(9, 35),
      seriaTier(10, 50),
      seriaTier(11, 55),
      seriaTier(12, 60),
      seriaTier(13, 65),
      seriaTier(14, 70),
      seriaTier(15, 100),
      seriaTier(16, 110),
      seriaTier(17, 120),
      seriaTier(18, 130),
      seriaTier(19, 140),
      seriaTier(20, 200),
      {
        effect: {
          type: "TASK_REWARD",
          task: "Kwalifikujący kupon każdego dnia miesiąca (200 zł za serię i 200 zł dodatkowo)",
          rewardPln: 400,
          paidAs: { kind: "freebet", terms: lebullFreebet({ validDays: 4, maxWinPln: 1000 }) },
        },
        valuation: "display_only",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://www.lebull.pl/pl/promocje-bukmacherskie/bycza-seria",
      termsUrl: "https://pomoc.lebull.pl/regulamin-promocji-byczaseria-aktywni-wygrywaja-wiecej/",
      termsVersionDate: "2026-08-20",
      termsHash: "69899207bee9187d3721e77c7e2d34d1cc62de1a898dc4aee611aa9a50dbaf40",
      fetchedAt: "2026-11-07T00:04:38Z",
      evidence: {
        "source.termsVersionDate": "ostatnia aktualizacja : 08.20.2026",
        audience:
          "Każdy Uczestnik, który zawrze za środki własne zakład (SINGIEL lub KOMBI) za kwotę min. 25 PLN z minimalnym kursem 1.95 całego kuponu przez co najmniej 7 dni z rzędu w danym miesiącu, otrzyma Freebet.",
        validFrom: "Promocja obowiązuje od 01.06.2025 r. do odwołania.",
        recurrence:
          "Promocja rozgrywana jest cyklicznie, osobno w każdym miesiącu kalendarzowym (zwanym dalej „Cyklem”).",
        "eligibility.minStakePln":
          "Każdy Uczestnik, który zawrze za środki własne zakład (SINGIEL lub KOMBI) za kwotę min. 25 PLN z minimalnym kursem 1.95 całego kuponu przez co najmniej 7 dni z rzędu w danym miesiącu, otrzyma Freebet.",
        "eligibility.notes":
          "Maksymalna pula nagród w promocji wynosi 500 000 zł w danym Cyklu. W przypadku przekroczenia puli nagród, pojedyncze nagrody będą obniżane proporcjonalnie do przekroczenia łącznej sumy.",
        "effects[0].effect.rewardPln": "zakład 7 dni z rzędu – Freebet 25 PLN",
        "effects[0].effect.paidAs.terms.winFactor": FREEBET_FORMULA_QUOTE,
        "effects[0].effect.paidAs.terms.validDays":
          "Zawarcie zakładu za Freebet musi nastąpić w terminie 96 godzin od momentu jego przyznania.",
        "effects[0].effect.paidAs.terms.maxWinPln":
          "Maksymalna możliwa do uzyskania kwota z Freebetu wygrana to 5-cio krotność kwoty przyznanego Freebetu.",
        "effects[1].effect.rewardPln": "zakład 8 dni z rzędu – Freebet 30 PLN",
        "effects[2].effect.rewardPln": "zakład 9 dni z rzędu – Freebet 35 PLN",
        "effects[3].effect.rewardPln": "zakład 10 dni z rzędu – Freebet 50 PLN",
        "effects[4].effect.rewardPln": "zakład 11 dni z rzędu – Freebet 55 PLN",
        "effects[5].effect.rewardPln": "zakład 12 dni z rzędu – Freebet 60 PLN",
        "effects[6].effect.rewardPln": "zakład 13 dni z rzędu – Freebet 65 PLN",
        "effects[7].effect.rewardPln": "zakład 14 dni z rzędu – Freebet 70 PLN",
        "effects[8].effect.rewardPln": "zakład 15 dni z rzędu – Freebet 100 PLN",
        "effects[9].effect.rewardPln": "zakład 16 dni z rzędu – Freebet 110 PLN",
        "effects[10].effect.rewardPln": "zakład 17 dni z rzędu – Freebet 120 PLN",
        "effects[11].effect.rewardPln": "zakład 18 dni z rzędu – Freebet 130 PLN",
        "effects[12].effect.rewardPln": "zakład 19 dni z rzędu – Freebet 140 PLN",
        "effects[13].effect.rewardPln": "zakład 20 dni z rzędu – Freebet 200 PLN",
        "effects[14].effect.rewardPln":
          "mają możliwość uzyskania nagrody dodatkowej w kwocie 200 PLN w przypadku postawienia zakładu (zgodny z wymogami punktu 3.2) w każdym dniu miesiąca danego Cyklu.",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "lebull-byczy-pakiet",
    bookmaker: "lebull",
    name: "ByczyPakiet – Freebety na weekend",
    audience: "everyone",
    recurrence: { kind: "always_on" },
    validFrom: "2026-07-10T08:00:00+02:00",
    activation: { kind: "automatic" },
    eligibility: {
      betTypes: ["accumulator"],
      odds: { totalMin: 1.95 },
      minStakePln: 49.99,
      maxStakePln: 49.99,
      fundsSource: "own_money_only",
      requiresConfirmation: [],
      notes: [
        "Kupon KOMBI za dokładnie 49,99 zł, kurs łączny 1.95 lub wyższy, rozliczony do czwartku 23:59 (tydzień liczy się od piątku do czwartku). Wynik nie ma znaczenia.",
        "Liczy się tylko pierwszy taki kupon w cyklu. Kolejny pakiet można uruchomić po wykorzystaniu wszystkich 5 freebetów.",
        "Zwrot, cashout albo spadek kursu łącznego poniżej 1.95 po zwrotach zdarzeń odbiera pakiet. Wirtualne i gry karciane się nie liczą.",
        "Nagroda to 5 freebetów po 10 zł (łącznie 50 zł), po jednym w 5 kolejnych piątków. Każdy jest ważny 24 godziny (najdłużej do końca niedzieli), bez obrotu i bez wymogu kursu, wygrana z każdego do 50 zł (5-krotność freebeta).",
      ],
    },
    effects: [
      {
        effect: {
          type: "TASK_REWARD",
          task: "Kupon KOMBI za dokładnie 49,99 zł po kursie łącznym co najmniej 1.95",
          // Total of five 10 zł freebets; terms describe one of them (24 h, max win 5 x 10 zł).
          rewardPln: 50,
          paidAs: { kind: "freebet", terms: lebullFreebet({ validDays: 1, maxWinPln: 50 }) },
        },
        // The type cannot express five weekly 24-hour freebets of 10 zł, so this is not valued.
        valuation: "display_only",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://www.lebull.pl/pl/promocje-bukmacherskie/byczy-pakiet",
      termsUrl: "https://pomoc.lebull.pl/regulamin-promocji-byczypakiet-freebety-na-weekend-13102025/",
      termsVersionDate: "2026-08-20",
      termsHash: "57a8371b2efcc619b24eb390133c16de8abf6d8d40f29e1429e3cc5c7ed2ce1a",
      fetchedAt: "2026-11-07T00:04:39Z",
      evidence: {
        "source.termsVersionDate": "ostatnia aktualizacja : 08.20.2026",
        audience:
          "zawrzeć za środki własne zakład wielozdarzeniowy (KOMBI) za dokładną stawkę 49.99 PLN z kursem minimalnym całego kuponu 1.95 z oferty LEBULL.",
        validFrom: "Promocja obowiązuje od 10.07.2026 r. od godziny 08:00 do odwołania.",
        recurrence:
          "Klient może skorzystać z Promocji wielokrotnie, jednak dopiero po wykorzystaniu i rozliczeniu wszystkich Freebetów z danego pakietu",
        "eligibility.minStakePln":
          "zawrzeć za środki własne zakład wielozdarzeniowy (KOMBI) za dokładną stawkę 49.99 PLN z kursem minimalnym całego kuponu 1.95 z oferty LEBULL.",
        "effects[0].effect.rewardPln":
          "otrzyma pakiet pięciu Freebetów po 10 PLN każdy (5 x 10 PLN), które będą przypisywane do konta Uczestnika, po jednym Freebecie w każdy kolejny piątek, przez 5 kolejnych Tygodni Rozliczeniowych.",
        "effects[0].effect.paidAs.terms.winFactor": FREEBET_FORMULA_QUOTE,
        "effects[0].effect.paidAs.terms.validDays":
          "Każdy aktywowany Freebet jest ważny przez 24 godziny, jednak nie później niż do końca niedzieli danego Tygodnia Rozliczeniowego",
        "effects[0].effect.paidAs.terms.maxWinPln":
          "Maksymalna możliwa do uzyskania kwota z Freebetu to pięciokrotność kwoty przyznanego Freebetu.",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "lebull-bycza-arena",
    bookmaker: "lebull",
    name: "ByczaArena",
    audience: "everyone",
    loyaltyProgram: true,
    recurrence: { kind: "always_on" },
    validFrom: "2025-12-17T00:00:00+01:00",
    activation: { kind: "automatic" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      fundsSource: "any",
      requiresConfirmation: [],
      notes: [
        "Bullcoiny za rozliczone zakłady (bez systemowych i rozliczonych po kursie 1.00), misje i funkcję ByczyZysk. Stawki naliczania podaje bukmacher w komunikatach.",
        "Bullcoiny wymieniasz w katalogu nagród na freebety (ważne 96 godzin, wygrana do 10-krotności) i bonusy z obrotem (5 dni).",
        "Bullcoiny wygasają po 12 miesiącach bez aktywności.",
      ],
    },
    effects: [
      {
        effect: {
          type: "OTHER",
          description: "Program lojalnościowy: Bullcoiny za zakłady i misje, wymiana na freebety i bonusy",
        },
        valuation: "display_only",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://www.lebull.pl/pl/promocje-bukmacherskie/bycza-arena",
      termsUrl: "https://pomoc.lebull.pl/regulamin-programu-lojalnosciowego-byczaarena/",
      termsVersionDate: "2026-08-20",
      termsHash: "cd77a53b9dae6e3470057eca2ff6f4e1e623e599d55228aa8fffbbca30249976",
      fetchedAt: "2026-11-07T00:04:41Z",
      evidence: {
        "source.termsVersionDate": "ostatnia aktualizacja : 08.20.2026",
        audience: "Uczestnikami Programu mogą być wyłącznie osoby pełnoletnie, będące klientami LEBULL.",
        validFrom: "Program obowiązuje od dnia 17 grudnia 2025 roku aż do odwołania.",
        "effects[0].effect.description": "Bullcoiny przyznawane za każdy rozliczony Zakład;",
        "eligibility.notes":
          "Bullcoins są ważne przez 12 miesięcy od daty ostatniej aktywności (pod rygorem ich anulowania przez LEBULL).",
      },
    },
    review: VERIFIED,
    version: 1,
  },
];
