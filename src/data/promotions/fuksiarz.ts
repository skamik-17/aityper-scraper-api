import type { Promotion } from "../../types/promotions.js";

// Entries come from the research files and the live terms.
// Terms are Fuksiarz CMS pages (fuksiarz.pl/rest/cms/pages/{slug}/content, the UI
// pages are an SPA shell). termsHash = sha256 of `data.title + " " + text(data.html)`,
// whitespace collapsed. The regulations page also holds archived versions; every
// quote below is from the current one.

const cms = (slug: string) => `https://fuksiarz.pl/rest/cms/pages/${slug}/content`;
// Human-readable page for the UI "Regulamin" link (termsUrl is the CMS endpoint).
const REGULAMINY_PUBLIC = "https://fuksiarz.pl/regulaminy-promocji";

const review = (): Promotion["review"] => ({
  status: "verified",
  verifiedAt: "2026-11-07T01:20:00+01:00",
  verifiedBy: "research-agent",
});

const REGULAMINY_HASH = "671997759a121ff20ed9bf54559cf9853477e28ae67a184edfdf99000c4ebaf5";
const REGULAMINY_FETCHED_AT = "2026-11-07T00:09:02Z";
const WELCOME_STACKING =
  "Promocja nie łączy się z innymi promocjami oferowanymi przez Organizatora, z wyłączeniem Promocji „FUKS Liga” w czasie jej trwania oraz Promocji „FREEBET 10 PLN za weryfikację konta”.";
const WELCOME_VALID_FROM = "Promocja „Oferta Powitalna” obowiązuje od godz. 00:00 dnia 05.11.2025 r. do odwołania";

const zwrotDo1000: Promotion = {
  id: "fuksiarz-zwrot-do-1000",
  bookmaker: "fuksiarz",
  name: "Zwrot do 1000 zł w gotówce bez obrotu",
  audience: "new_customer",
  recurrence: { kind: "one_time" },
  validFrom: "2025-11-05T00:00:00+01:00",
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["accumulator"],
    minLegs: 3,
    minStakePln: 50,
    fundsSource: "own_money_only",
    requiresConfirmation: [
      { key: "fuksiarz_deposit_50", label: "Wpłaciłem łącznie co najmniej 50 zł w Fuksiarz", expires: "never" },
    ],
    notes: [
      "Liczy się tylko pierwszy kupon postawiony za wpłacone środki; jeśli nie spełnia warunków, promocja przepada.",
      "Brak wymogu kursu (ani łącznego, ani pojedynczych zdarzeń).",
      "Nie dotyczy zakładów systemowych, specjalnych, BOOST, sportów wirtualnych, gier karcianych i Cashout.",
      "Zwrot trafia na saldo cashback; trzeba go przenieść na saldo główne.",
      "Regulamin podaje limit 1000 zł przed potrąceniem 12 % – wypłata może wynieść do 880 zł.",
    ],
  },
  effects: [
    {
      effect: {
        type: "REFUND_ON_LOSS",
        percent: 50,
        base: "net_stake",
        capPln: 1000,
        paidAs: { kind: "cash" },
        firstCouponOnly: true,
      },
      // Day 0 = registration day; the window ends at 23:59 of the 14th following day.
      extraEligibility: { accountAgeDays: { to: 15 } },
      // The terms do not say whether the 1000 PLN cap applies before or after the 12 % cut.
      valuation: "display_only",
    },
  ],
  stacking: { combinableWith: ["fuksiarz-freebet-10-za-weryfikacje"] },
  source: {
    promoUrl: "https://fuksiarz.pl/zaklad-bez-ryzyka",
    termsUrl: cms("regulaminy-promocji"),
    publicTermsUrl: REGULAMINY_PUBLIC,
    termsHash: REGULAMINY_HASH,
    fetchedAt: REGULAMINY_FETCHED_AT,
    evidence: {
      audience:
        "Promocja „Zwrot do 1000 zł w gotówce bez obrotu” przeznaczona jest dla nowo zarejestrowanych Graczy na stronie internetowej www.fuksiarz.pl oraz w aplikacji mobilnej Fuksiarz",
      recurrence:
        "Promocja „Zwrot do 1000 zł w gotówce bez obrotu” jest jednorazowa i dotyczy wyłącznie pierwszego kuponu zagranego za wpłacone środki.",
      validFrom: WELCOME_VALID_FROM,
      "eligibility.minLegs": "a) Kupon AKO z min. 3 zdarzeniami b) Stawka min. 50 zł c) Oferta przedmeczowa / LIVE",
      "eligibility.minStakePln": "a) Kupon AKO z min. 3 zdarzeniami b) Stawka min. 50 zł c) Oferta przedmeczowa / LIVE",
      "eligibility.notes[1]":
        "Zakład Bonusowy nie posiada warunku kursowego dotyczącego min. kursu całkowitego kuponu, ani warunku kursowego dotyczącego min. kursu poszczególnych zdarzeń.",
      "eligibility.fundsSource": "zawrzeć pierwszy za wpłacone środki kupon („Zakład Bonusowy”) z Salda Głównego",
      "eligibility.requiresConfirmation": "Gracz musi dokonać łącznej wpłaty w wysokości minimum 50 zł",
      "effects[0].effect.percent":
        "Organizator przyznaje Graczowi zwrot środków w wysokości 50% stawki Zakładu Bonusowego („Środki Promocyjne”) jeśli zakład ten spełni warunki Promocji i okaże się przegrany.",
      "effects[0].effect.capPln": "Maksymalna wartość Środków Promocyjnych wynosi 1000 zł.",
      "eligibility.notes[4]": "7. Środki Promocyjne pomniejszone zostają o 12% podatku od gier",
      "effects[0].effect.base": "Środki Promocyjne pomniejszone zostają o 12% podatku od gier",
      "effects[0].effect.paidAs":
        "Środki Promocyjne mogą zostać przeznaczone na zawarcie kolejnych zakładów wzajemnych u Organizatora lub do bezpośredniej wypłaty, przez co rozumie się zwrot w gotówce.",
      "effects[0].effect.firstCouponOnly":
        "Jeśli taki kupon nie spełni warunków Promocji, nie będzie możliwości aby skorzystać z Promocji na kolejnym kuponie.",
      "effects[0].extraEligibility.accountAgeDays.to":
        "Okres 14 dni jest liczony od momentu rejestracji i upływa o godzinie 23:59 czternastego dnia następującego po dniu rejestracji.",
      "stacking.combinableWith": WELCOME_STACKING,
    },
  },
  review: review(),
  version: 1,
};

const freebet10: Promotion = {
  id: "fuksiarz-freebet-10-za-weryfikacje",
  bookmaker: "fuksiarz",
  name: "FREEBET 10 PLN za weryfikację konta",
  audience: "everyone",
  recurrence: { kind: "one_time" },
  validFrom: "2025-11-05T00:00:00+01:00",
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["accumulator"],
    fundsSource: "any",
    requiresConfirmation: [
      {
        key: "fuksiarz_not_verified",
        label: "Nie mam jeszcze zweryfikowanego konta stałego w Fuksiarz",
        expires: "never",
      },
    ],
    notes: [
      "Freebet jest przyznawany po weryfikacji konta stałego i jest ważny 72 godziny.",
      "Przy wygranej na saldo główne trafia wygrana minus stawka freebetu.",
      "Freebetu nie można użyć na zakłady BOOST, specjalne, sporty wirtualne i gry karciane.",
      "Regulamin nie mówi, czy wygrana z freebetu jest pomniejszana o podatek 12 %.",
    ],
  },
  effects: [
    {
      // The terms only say "wygrana minus stawka", so winFactor 1 / stakeDeduction 1;
      // whether the 12 % tax reduces the win is not stated (see the note).
      effect: {
        type: "FREEBET_GRANT",
        amountPln: 10,
        trigger: "Pozytywna weryfikacja konta stałego",
        terms: {
          winFactor: 1,
          stakeDeduction: 1,
          odds: { everyLegMin: 1.6 },
          minLegs: 3,
          validDays: 3,
          maxWinPln: 2279,
        },
      },
      valuation: "display_only",
    },
  ],
  stacking: { combinableWith: ["fuksiarz-zwrot-do-1000"] },
  source: {
    promoUrl: "https://fuksiarz.pl/freebet",
    termsUrl: cms("regulaminy-promocji"),
    publicTermsUrl: REGULAMINY_PUBLIC,
    termsHash: REGULAMINY_HASH,
    fetchedAt: REGULAMINY_FETCHED_AT,
    evidence: {
      audience:
        "Promocja „FREEBET 10 PLN za weryfikację konta” przeznaczona jest dla wszystkich Graczy którzy do tej pory nie dokonali weryfikacji Konta Stałego i dokonają jej w trakcie obowiązywania Promocji.",
      recurrence: "Każdy Gracz może skorzystać z tej oferty tylko raz.",
      validFrom: WELCOME_VALID_FROM,
      "eligibility.requiresConfirmation":
        "przeznaczona jest dla wszystkich Graczy którzy do tej pory nie dokonali weryfikacji Konta Stałego i dokonają jej w trakcie obowiązywania Promocji.",
      "effects[0].effect.amountPln":
        "„FREEBET 10 PLN za weryfikację konta” – możliwa do otrzymania w dowolnym momencie trwania Promocji, po pozytywnej weryfikacji konta stałego",
      "effects[0].effect.trigger":
        "Freebet za weryfikację konta (zwany dalej: „Freebet”) zostanie przypisany do Konta Gracza po poprawnej i zaakceptowanej przez Organizatora weryfikacji Konta Stałego",
      "effects[0].effect.terms.validDays": "Freebet za weryfikację jest ważny przez 72 godziny od momentu przyznania.",
      "effects[0].effect.terms.minLegs":
        "Gracz może wykorzystać otrzymany Freebet na kupon AKO z min. 3 zdarzeniami oraz z kursem min. 1.60 na każde ze zdarzeń zawartych na kuponie.",
      "effects[0].effect.terms.odds.everyLegMin":
        "Gracz może wykorzystać otrzymany Freebet na kupon AKO z min. 3 zdarzeniami oraz z kursem min. 1.60 na każde ze zdarzeń zawartych na kuponie.",
      "effects[0].effect.terms.winFactor":
        "Wygrana z zakładu zawartego za „Freebet” doliczana jest do salda głównego jako zysk z zawartego zakładu (wygrana minus stawka).",
      "effects[0].effect.terms.stakeDeduction":
        "Wygrana z zakładu zawartego za „Freebet” doliczana jest do salda głównego jako zysk z zawartego zakładu (wygrana minus stawka).",
      "effects[0].effect.terms.maxWinPln": "Maksymalna wygrana za Freebet to 2279 zł.",
      "stacking.combinableWith": WELCOME_STACKING,
    },
  },
  review: review(),
  version: 1,
};

const FUKS_TIERS_QUOTE =
  "3 zdarzenia – 1% 4 zdarzenia – 2% 5 zdarzeń – 3% 6 zdarzeń – 4% 7 zdarzeń – 5% 8 zdarzeń – 7% 9 zdarzeń – 10% 10 zdarzeń – 12% 11 zdarzeń – 15% 12 zdarzeń – 20% 13-15 zdarzeń – 30% 16-19 zdarzeń – 50% 20 i więcej zdarzeń – 100%";
const FUKS_TIERS = [
  { minLegs: 3, percent: 1 },
  { minLegs: 4, percent: 2 },
  { minLegs: 5, percent: 3 },
  { minLegs: 6, percent: 4 },
  { minLegs: 7, percent: 5 },
  { minLegs: 8, percent: 7 },
  { minLegs: 9, percent: 10 },
  { minLegs: 10, percent: 12 },
  { minLegs: 11, percent: 15 },
  { minLegs: 12, percent: 20 },
  { minLegs: 13, percent: 30 },
  { minLegs: 16, percent: 50 },
  { minLegs: 20, percent: 100 },
];

const fuksBonus: Promotion = {
  id: "fuksiarz-fuks-bonus",
  bookmaker: "fuksiarz",
  name: "Fuks Bonus",
  audience: "everyone",
  recurrence: { kind: "always_on" },
  validFrom: "2026-06-08T12:00:00+02:00",
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["accumulator"],
    minLegs: 3,
    fundsSource: "own_money_only",
    requiresConfirmation: [],
    notes: [
      "Do progu liczą się tylko zdarzenia z kursem co najmniej 1.40.",
      "Anulowane zdarzenie zmniejsza liczbę zdarzeń; bonus przepada, gdy zostaną mniej niż 3 zdarzenia z kursem co najmniej 1.40.",
      "Nie dotyczy zakładów systemowych, specjalnych, sportów wirtualnych, gier karcianych i Cashout.",
    ],
  },
  effects: [
    {
      // Exact when every leg qualifies: bonus = percent x stake x total odds (before the 12 % tax).
      effect: {
        type: "ACCA_BONUS",
        base: "gross_win",
        tiers: FUKS_TIERS,
        qualifyingLegMinOdds: 1.4,
        capPln: 30000,
        paidAs: { kind: "cash" },
      },
      extraEligibility: { odds: { everyLegMin: 1.4 } },
      valuation: "full",
    },
    {
      // With lower legs the bonus counts only the win from the qualifying legs,
      // which the engine cannot compute yet.
      effect: {
        type: "ACCA_BONUS",
        base: "gross_win",
        tiers: FUKS_TIERS,
        qualifyingLegMinOdds: 1.4,
        capPln: 30000,
        paidAs: { kind: "cash" },
      },
      extraEligibility: {
        notes: [
          "Gdy na kuponie są zdarzenia z kursem poniżej 1.40, bonus liczy się tylko od wygranej ze zdarzeń z kursem co najmniej 1.40.",
        ],
      },
      valuation: "display_only",
    },
  ],
  stacking: { combinableWith: ["fuksiarz-mega-kursy-boost"] },
  source: {
    promoUrl: "https://fuksiarz.pl/fuks-bonus",
    termsUrl: cms("fuks-bonus"),
    publicTermsUrl: "https://fuksiarz.pl/fuks-bonus",
    termsVersionDate: "2026-06-08",
    termsHash: "38ebccc299b2efc6d1557893c215fcb58caf2b64fd7e06c45516ba7af864dccd",
    fetchedAt: "2026-11-07T00:09:02Z",
    evidence: {
      audience:
        "Promocja przeznaczona jest dla osób, które posiadają Konto tymczasowe lub Konto stałe w serwisie Fuksiarz.pl",
      recurrence: "Gracz może postawić dowolną liczbę Zakładów bonusowych spełniających warunki Promocji.",
      validFrom: "Promocja obowiązuje od godz. 12:00 dnia 08.06.2026 r. do odwołania.",
      "eligibility.minLegs":
        "a) Kupon AKO z min. 3 zdarzeniami b) Min. 3 zdarzenia na kuponie muszą mieć kurs min. 1.40 c) Oferta przedmeczowa i/lub LIVE (na żywo)",
      "eligibility.fundsSource":
        "Promocją nie są objęte zakłady, w których stawka opłacona została środkami bonusowymi przyznanymi w ramach innych Promocji.",
      "effects[0].effect.base":
        "Bonus naliczany jest od wygranej brutto wynikającej z kwalifikujących się zdarzeń (przed potrąceniem podatku od gier).",
      "effects[0].effect.tiers": FUKS_TIERS_QUOTE,
      "effects[0].effect.qualifyingLegMinOdds":
        'Wysokość "Fuks Bonusu" zostaje obliczona wyłącznie na podstawie zdarzeń z kursem min. 1.40.',
      "effects[0].effect.capPln":
        "Maksymalna wartość „Fuks Bonus” przyznanego za pojedynczy kupon nie może przekroczyć 30 000 zł.",
      "effects[0].effect.paidAs":
        "Środki bonusowe mogą zostać przeznaczone na zawarcie zakładów wzajemnych u Organizatora lub do bezpośredniej wypłaty.",
      "effects[0].extraEligibility.odds.everyLegMin":
        "Przykładowo, jeżeli na kuponie znajduje się 10 zdarzeń, lecz tylko 3 z nich mają kurs co najmniej 1.40, procentowa wysokość „Fuks Bonusu” zwiększa wygraną wynikającą jedynie z tych trzech zdarzeń.",
      "effects[1].effect.tiers": FUKS_TIERS_QUOTE,
      "effects[1].extraEligibility.notes":
        "Pozostałe zdarzenia (z niższymi kursami) zwiększą ogólną wygraną całego kuponu, ale bonus nie zostanie od nich naliczony.",
      "stacking.combinableWith":
        "Promocja łączy się z innymi promocjami oferowanymi przez Organizatora tj. jeśli zakład bonusowy biorący udział w niniejszej Promocji spełni również warunki innej, równolegle dostępnej u Organizatora Promocji",
    },
  },
  review: review(),
  version: 1,
};

const megaKursyBoost: Promotion = {
  id: "fuksiarz-mega-kursy-boost",
  bookmaker: "fuksiarz",
  name: "Mega Kursy Boost",
  audience: "everyone",
  recurrence: { kind: "always_on" },
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    fundsSource: "any",
    requiresConfirmation: [],
    notes: [
      "Podwyższone kursy w zakładce Boost; sekcja Mega Boost jest odświeżana codziennie o 12:00.",
      "Bez limitu stawki.",
      "Zakłady BOOST nie liczą się do zwrotu z oferty powitalnej ani do freebetu 10 zł.",
    ],
  },
  effects: [
    {
      effect: { type: "OTHER", description: "Codziennie podwyższone kursy na wybrane wydarzenia (zakładka Boost)" },
      valuation: "display_only",
    },
  ],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: "https://fuksiarz.pl/mega-kursy-boost",
    termsUrl: cms("mega-kursy-boost"),
    publicTermsUrl: "https://fuksiarz.pl/mega-kursy-boost",
    termsHash: "e22795e52ff44e0d81f38a4cfde20c52bb07ad1ad21f3bfab1e2158c878853a3",
    fetchedAt: "2026-11-07T00:09:03Z",
    evidence: {
      recurrence: "codziennie o 12:00 odwiedź naszą zakładkę Mega Boost z najwyższymi kursami na rynku",
      "eligibility.notes":
        "Promocja nie jest objęta limitem stawki, więc Mega Kursy Boost zagrasz za dowolną kwotę",
      "effects[0].effect.description": "Znajdziesz tam podwyższone kursy na popularne wydarzenia sportowe",
    },
  },
  review: review(),
  version: 1,
};

export const fuksiarzPromotions: Promotion[] = [zwrotDo1000, freebet10, fuksBonus, megaKursyBoost];
