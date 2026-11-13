import type { Promotion } from "../../types/promotions.js";

// Entries come from the research files and the live terms.
// Regulaminy live on betters.kb.help; `termsHash` is the sha256 of the page's <article>
// element converted to plain text with whitespace collapsed. komfortBET has no regulamin
// there, so its terms are the promotion detail JSON (`/share/promotions/{slug}`,
// field `text_full`, header `X-Locale: pl`).

const VERIFIED_AT = "2026-11-07T00:18:05Z";
const REVIEW: Promotion["review"] = {
  status: "verified",
  verifiedAt: VERIFIED_AT,
  verifiedBy: "research-agent",
};

const WELCOME_ID = "betters-1200-pln-na-start";
const FREEBET_ID = "betters-freebet-10-pln-na-start";
const WELCOME_PROMO_URL = "https://www.betters.pl/promocje-bukmacherskie/zaloz-konto-bukmacher-betters";
const WELCOME_AUDIENCE_QUOTE =
  "3.1. Uczestnikiem Promocji może zostać wyłącznie Klient zarejestrowany w trakcie jej trwania, lub Klient zarejestrowany przed rozpoczęciem Promocji, który nie wykonał depozytu po 24.02.25 r.";
const STAGE_ONE_OPT_IN_QUOTE =
  "Uczestnik powinien w trakcie wpłaty zaznaczyć pole „1200 PLN na start – etap 1”, aby wziąć udział w Promocji.";
const OLD_ACCOUNT_NOTE = "Konto założone wcześniej kwalifikuje się, jeśli nie było na nim wpłaty po 24.02.2025.";

const welcome: Promotion = {
  id: WELCOME_ID,
  bookmaker: "betters",
  name: "1 200 PLN NA START",
  audience: "new_customer",
  recurrence: { kind: "one_time" },
  validFrom: "2026-11-06T09:00:00+01:00",
  activation: { kind: "choose_at_deposit" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    fundsSource: "any",
    requiresConfirmation: [],
    notes: [
      OLD_ACCOUNT_NOTE,
      "Przy wpłacie trzeba wybrać „1200 PLN na start – Etap I” albo „Etap II”; bez tego bonus nie zostanie przyznany.",
      "Etapy mogą dotyczyć dowolnych dwóch wpłat, niekoniecznie kolejnych.",
    ],
  },
  effects: [
    {
      effect: {
        type: "DEPOSIT_BONUS",
        depositIndex: 1,
        percent: 100,
        capPln: 200,
        minDepositPln: 10,
        paidAs: {
          kind: "bonus_funds",
          wagering: {
            multiplier: 5,
            of: "deposit",
            ownFundsOnly: false,
            odds: { anyLegMin: 2.1 },
            days: 7,
            baseCapPln: 200,
          },
        },
      },
      extraEligibility: {
        notes: [
          "Z bonusu można po obrocie wypłacić najwyżej 10-krotność bonusu.",
          "Środkami bonusowymi grasz dopiero wtedy, gdy saldo główne wynosi 0 zł.",
          "Selekcje z Betbuildera nie spełniają wymogu kursu 2.10.",
        ],
      },
      valuation: "full",
    },
    {
      effect: {
        type: "DEPOSIT_BONUS",
        depositIndex: 2,
        percent: 50,
        capPln: 1000,
        minDepositPln: 10,
        paidAs: {
          kind: "bonus_funds",
          wagering: {
            multiplier: 4,
            of: "deposit",
            ownFundsOnly: true,
            odds: { anyLegMin: 2.1 },
            days: 14,
            baseCapPln: 2000,
          },
        },
      },
      extraEligibility: {
        notes: [
          "Etap II wymaga wcześniejszego odebrania etapu I.",
          "Bonus z etapu II trafia na saldo główne dopiero po obrocie 4× wpłata, wykonanym środkami z salda głównego.",
        ],
      },
      // The bonus is credited only after the turnover; Wagering cannot express that.
      valuation: "display_only",
    },
  ],
  stacking: { combinableWith: [FREEBET_ID] },
  source: {
    promoUrl: WELCOME_PROMO_URL,
    termsUrl: "https://betters.kb.help/regulamin-promocji-1-200-pln-na-start-061126/",
    termsVersionDate: "2026-11-06",
    termsHash: "62dfa9220dec6e0206a1d0c0fc152580127b2d44bcb4110cee51c83e3cfe3ccc",
    fetchedAt: "2026-11-07T00:11:38Z",
    evidence: {
      audience: WELCOME_AUDIENCE_QUOTE,
      recurrence: "3.2. Promocją zostaną objęte dwa dowolne depozyty, wykonane po założeniu konta.",
      validFrom: "1.4. Promocja obowiązuje od dnia 06.11.2026 r. od godziny 09:00 do odwołania.",
      "source.termsVersionDate": "1.4. Promocja obowiązuje od dnia 06.11.2026 r. od godziny 09:00 do odwołania.",
      activation:
        "Aby depozyt został objęty Promocją, Uczestnik powinien w procesie wpłaty zaznaczyć chęć skorzystania z Promocji poprzez kliknięcie przycisku „1200 PLN na start – Etap I”.",
      "eligibility.notes":
        "Odbiór obu etapów nie musi nastąpić za dwa kolejne depozyty (Uczestnik może odebrać promocję np. po czwartym i siódmym depozycie).",
      "stacking.combinableWith": STAGE_ONE_OPT_IN_QUOTE,
      "effects[0].effect.minDepositPln": "3.3.1. Warunkiem udziału w Promocji jest dokonanie depozytu w kwocie minimum 10 PLN.",
      "effects[0].effect.percent": "otrzyma bonus w wysokości 100% wartości depozytu, jednak nie więcej niż 200 PLN.",
      "effects[0].effect.capPln": "otrzyma bonus w wysokości 100% wartości depozytu, jednak nie więcej niż 200 PLN.",
      "effects[0].effect.paidAs.wagering":
        "Uczestnik musi zawrzeć zakłady o łącznej wartości równej pięciokrotności wpłaconego depozytu (dla depozytu większego niż 200 PLN, wymagany obrót wynosi 1 000 PLN).",
      "effects[0].effect.paidAs.wagering.odds":
        "Do wymaganego obrotu wliczają się wyłącznie zakłady sportowe typu SINGIEL, KOMBI lub SYSTEM, w których co najmniej jedna selekcja ma kurs minimalny 2.1.",
      "effects[0].effect.paidAs.wagering.ownFundsOnly": "Zakłady mogą być zawierane zarówno ze środków głównych, jak i bonusowych.",
      "effects[0].effect.paidAs.wagering.days":
        "3.3.7. Uczestnik ma 7 dni (licząc od momentu przyznania bonusu) na spełnienie wymaganego obrotu.",
      "effects[0].extraEligibility.notes":
        "3.3.11. Maksymalna możliwa do uzyskania kwota z bonusu po ukończeniu obrotu jest równa dziesięciokrotności otrzymanego bonusu.",
      "effects[1].effect.depositIndex":
        "3.4.1. Warunkiem koniecznym wzięcia udziału w Promocji jest wcześniejsze odebranie etapu pierwszego, opisanego w podpunkcie 3.3.",
      "effects[1].effect.minDepositPln": "3.4.2. Warunkiem udziału w Promocji jest dokonanie depozytu w kwocie minimum 10 PLN.",
      "effects[1].effect.percent": "otrzyma bonus w wysokości 50% wartości depozytu, jednak nie więcej niż 1 000 PLN.",
      "effects[1].effect.capPln": "otrzyma bonus w wysokości 50% wartości depozytu, jednak nie więcej niż 1 000 PLN.",
      "effects[1].effect.paidAs.wagering":
        "W celu odblokowania Bonusu Uczestnik musi wykonać obrót zakładami sportowymi o łącznej wartości równej czterokrotności wartości wpłaconego depozytu (dla depozytu większego niż 2 000 PLN, wymagany obrót wynosi 8 000 PLN).",
      "effects[1].effect.paidAs.wagering.ownFundsOnly":
        "Do wymaganego obrotu zaliczają się wyłącznie zakłady zawarte ze środków z salda głównego.",
      "effects[1].effect.paidAs.wagering.odds":
        "zawarte ze środków z salda głównego, zawierające co najmniej jedną selekcję o kursie nie niższym niż 2.1.",
      "effects[1].effect.paidAs.wagering.days":
        "3.4.7. Uczestnik ma 14 dni na wykonanie wymaganego obrotu, licząc od momentu przyznania Bonusu.",
      "effects[1].extraEligibility.notes":
        "3.4.10. Po spełnieniu warunku obrotu Bonus zostanie w całości odblokowany i przyznany na saldo główne Uczestnika.",
    },
  },
  review: REVIEW,
  version: 1,
};

const freebet10: Promotion = {
  id: FREEBET_ID,
  bookmaker: "betters",
  name: "FREEBET 10 PLN NA START",
  audience: "new_customer",
  recurrence: { kind: "one_time" },
  validFrom: "2026-02-09T12:00:00+01:00",
  // Freebet must be accepted by 30.12.2026.
  validTo: "2026-12-31T00:00:00+01:00",
  activation: { kind: "choose_at_deposit" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    fundsSource: "any",
    requiresConfirmation: [],
    notes: [
      OLD_ACCOUNT_NOTE,
      "Freebet jest przyznawany po tym samym wyborze przy wpłacie co etap I promocji „1 200 PLN NA START”.",
      "Wykluczeni są gracze, którzy wcześniej odebrali freebet 10 PLN z kodem promocyjnym albo freebet z promocji „FREEBET 15 PLN NA START”.",
      "Freebet trzeba zaakceptować do 30.12.2026 i zagrać w ciągu 72 godzin; zwrot po kursie 1.0 kasuje freebet.",
    ],
  },
  effects: [
    {
      effect: {
        type: "FREEBET_GRANT",
        amountPln: 10,
        trigger: "Wpłata co najmniej 10 zł z wybraną promocją „1200 PLN na start – Etap I”",
        terms: {
          winFactor: 0.88,
          stakeDeduction: 0.88,
          odds: { totalMin: 1.14, totalMax: 20 },
          validDays: 3,
        },
      },
      valuation: "full",
    },
  ],
  stacking: { combinableWith: [WELCOME_ID] },
  source: {
    promoUrl: WELCOME_PROMO_URL,
    termsUrl: "https://betters.kb.help/regulamin-promocji-freebet-10-pln-na-start-iii/",
    termsHash: "fe2bcaaf2187e694f5cf26e551afbaf442e50aa05cca44cd24b20065c58f064b",
    fetchedAt: "2026-11-07T00:11:39Z",
    evidence: {
      audience: WELCOME_AUDIENCE_QUOTE,
      recurrence: "3.5. Każdy Uczestnik może odebrać dokładnie jeden Freebet.",
      validFrom: "1.4. Promocja obowiązuje od dnia 09.02.2026 r. od godziny 12:00 do odwołania.",
      validTo: "Freebet należy zaakceptować do 30.12.26 r.",
      activation: STAGE_ONE_OPT_IN_QUOTE,
      "stacking.combinableWith": STAGE_ONE_OPT_IN_QUOTE,
      "eligibility.notes":
        '3.4. Z Promocji zostaną wykluczeni gracze którzy skorzystali z Promocji "FREEBET 10 PLN Z KODEM BETTERS10" lub "FREEBET 15 PLN NA START".',
      "effects[0].effect.amountPln":
        "3.3. Nagrodą w Promocji jest jednorazowy darmowy zakład (zwany dalej „Freebetem”) w kwocie 10 PLN.",
      "effects[0].effect.trigger": "3.2. Warunkiem wzięcia udziału w Promocji jest wpłata depozytu w kwocie minimum 10 PLN.",
      "effects[0].effect.terms.odds.totalMin":
        "3.7. Freebet należy wykorzystać na zawarcie zakładu SINGIEL lub KOMBI (z oferty przedmeczowej lub live) z minimalnym kursem całkowitym 1.14.",
      "effects[0].effect.terms.odds.totalMax": "3.8. Maksymalny kurs całkowity zakładu zawartego za Freebet wynosi 20.0.",
      "effects[0].effect.terms.validDays":
        "Zawarcie zakładu za Freebet musi nastąpić w terminie 72 godzin od momentu jego zaakceptowania.",
      "effects[0].effect.terms.winFactor":
        "Wygrana kwota = [kurs (kurs całkowity) x wskaźnik (0,88) x stawka (wartość Freebetu)] – stawka x wskaźnik (0,88)",
      "effects[0].effect.terms.stakeDeduction":
        "od wygranej odejmowana jest kwota Freebetu pomnożona przez współczynnik 0,88",
    },
  },
  review: REVIEW,
  version: 1,
};

const RAISEBET_ELIGIBILITY_QUOTE =
  "3.1. Warunkami niniejszej Promocji objęte zostają wszystkie zakłady KOMBI (z zastrzeżeniem postanowień podpunktów 3.3. - 3.5.) z minimalną stawką 2 PLN, zawierające co najmniej 4 zdarzenia, każde zdarzenie z minimalnym kursem selekcji wynoszącym 1.25";

const raiseBet: Promotion = {
  id: "betters-raisebet",
  bookmaker: "betters",
  name: "raiseBET",
  audience: "everyone",
  recurrence: { kind: "always_on" },
  validFrom: "2026-10-01T13:00:00+02:00",
  validTo: "2028-01-01T00:00:00+01:00",
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["accumulator"],
    minLegs: 4,
    // §3.1 requires every leg >= 1.25 (its own example and the promo page allow lower legs);
    // the stricter rule is kept so the bonus is never overstated.
    odds: { everyLegMin: 1.25 },
    minStakePln: 2,
    fundsSource: "own_money_only",
    requiresConfirmation: [],
    notes: [
      "Do progu liczą się tylko zdarzenia z kursem co najmniej 1.35.",
      "Nie działa z lepszyBET, Boostem, betterBET, freebetem ani ze środkami bonusowymi.",
      "Zdarzenie rozliczone po kursie 1.0 obniża próg o jedno zdarzenie; pełny cashout wyłącza raiseBET.",
    ],
  },
  effects: [
    {
      effect: {
        type: "ACCA_BONUS",
        base: "total_odds",
        tiers: [
          { minLegs: 4, percent: 3 },
          { minLegs: 5, percent: 6 },
          { minLegs: 6, percent: 9 },
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
        qualifyingLegMinOdds: 1.35,
        paidAs: { kind: "cash" },
      },
      valuation: "full",
    },
  ],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: "https://www.betters.pl/promocje-bukmacherskie/raisebet",
    termsUrl: "https://betters.kb.help/regulamin-promocji-raisebet-iv/",
    termsHash: "1930288f80c64116367ded38f7d5da053188e01b06acfc4cef3fb9cd29103341",
    fetchedAt: "2026-11-07T00:11:40Z",
    evidence: {
      audience: RAISEBET_ELIGIBILITY_QUOTE,
      recurrence: RAISEBET_ELIGIBILITY_QUOTE,
      validFrom: "1.4. Promocja obowiązuje od dnia 01.10.2026 r. od godziny 13:00 do 01.01.2028 r. do godziny 00:00",
      validTo: "1.4. Promocja obowiązuje od dnia 01.10.2026 r. od godziny 13:00 do 01.01.2028 r. do godziny 00:00",
      activation:
        "3.2. Uczestnik spełniający warunki Promocji otrzyma mnożnik kursowy (zwaną dalej „Boostem”), którego wartość zależy od ilości wybranych selekcji w danym zakładzie.",
      "eligibility.minLegs": RAISEBET_ELIGIBILITY_QUOTE,
      "eligibility.minStakePln": RAISEBET_ELIGIBILITY_QUOTE,
      "eligibility.odds.everyLegMin": RAISEBET_ELIGIBILITY_QUOTE,
      "eligibility.fundsSource":
        "3.7. Mnożnik kursowy nie jest naliczany od zakładów zawartym z wykorzystaniem funkcji lepszyBET, zawartych z salda bonusowego oraz za Freebet.",
      "eligibility.notes":
        "3.8. Do promocji nie zaliczają się selekcje z podwyższonymi kursami, oznaczone w ofercie jako betterBET, lub Boost.",
      "effects[0].effect.base":
        "Jeżeli zakład spełniający warunki Promocji określone w podpunkcie 3.1. okaże się zwycięski, to kurs całkowity tego zakładu zostanie powiększony zgodnie z poniższą tabelą.",
      // Second source: this quote is from https://www.betters.pl/share/promotions/raisebet
      // (promotion detail JSON, fetched 2026-11-07T00:11:35Z), not from termsUrl - the
      // regulamin's "poniższa tabela" slot is empty, so termsHash does not cover the table.
      "effects[0].effect.tiers":
        "Tabela: Liczba zdarzeń BOOST (%) 4 3% 5 6% 6 9% 7 12% 8 15% 9 20% 10 25% 11 30% 12 40% 13 50% 14 60% 15 70% 16 80% 17 90% 18 100% 19 125% 20+ 150%",
      "effects[0].effect.qualifyingLegMinOdds":
        "jeżeli kursy jakichś selekcji danego zakładu będą wynosiły poniżej 1.35, to nie zostaną one uwzględnione w obliczaniu ilości selekcji uprawniającej do otrzymania mnożnika kursowego",
      "effects[0].effect.paidAs":
        "Wypłacona kwota = (wygrana + kwota powiększająca wygraną) – 10% x (wygrana + kwota powiększająca wygraną)",
    },
  },
  review: REVIEW,
  version: 1,
};

const komfortBet: Promotion = {
  id: "betters-komfortbet",
  bookmaker: "betters",
  name: "komfortBET",
  audience: "everyone",
  recurrence: { kind: "always_on" },
  validFrom: "2025-03-21T00:00:00+01:00",
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    fundsSource: "any",
    leagues: ["ekstraklasa", "premier-league", "serie-a", "laliga", "ligue-1"],
    markets: ["MATCH_WINNER"],
    requiresConfirmation: [],
    notes: [
      "Tylko zakład przedmeczowy „Wynik meczu” (1X2); nie dotyczy zakładów za freebet.",
      "Obejmuje też m.in. I ligę, Bundesligę, Ligę Mistrzów, Ligę Europy, Ligę Konferencji i Ligę Narodów; mistrzostw świata nie ma na liście.",
      "Zakład z komfortBET ma przy kursie oznaczenie „Wcześniejsza Wypłata” albo „Early payout”.",
    ],
  },
  effects: [
    {
      effect: { type: "EARLY_WIN", rule: "two_goal_lead", markets: ["MATCH_WINNER"] },
      // Valuing an early payout needs an in-play goal model (spec 4.2).
      valuation: "display_only",
    },
  ],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: "https://www.betters.pl/promocje-bukmacherskie/komfortbet",
    termsUrl: "https://www.betters.pl/share/promotions/komfortbet",
    publicTermsUrl: "https://www.betters.pl/promocje-bukmacherskie/komfortbet",
    termsHash: "d3e54162d49d62ec0bf929638a4e897737d42e179d556253b76bad8500c87d60",
    fetchedAt: "2026-11-07T00:11:36Z",
    evidence: {
      audience:
        "Skorzystaj z nowego rodzaju zakładu - KomfortBET, dzięki któremu możesz wygrać zakład nawet, gdy Twoja drużyna przegra.",
      recurrence: "komfortBET obowiązuje od 21.03.2025 r. do odwołania",
      validFrom: "komfortBET obowiązuje od 21.03.2025 r. do odwołania",
      "eligibility.leagues":
        "komfortBET aktualnie obowiązuje na następujące rozgrywki piłkarskie: Ekstraklasa (1. Polska), I Liga (2. Polska), Premier League (1. Anglia), Serie A (1. Włochy), La Liga (1. Hiszpania), Ligue 1 (1. Francja), Bundesliga (1. Niemcy)",
      "eligibility.markets": "komfortBET obowiazuje wyłącznie na przedmeczowy zakład „Wynik meczu” (inaczej „1x2”).",
      "eligibility.notes": "komfortBET nie będzie oferowany na zakładach zawieranych za Freebet",
      "effects[0].effect.rule":
        "Zasada jest prosta - gdy wybrany przez Ciebie zwycięzca prowadzi przynajmniej dwoma golami - zakład jest rozliczany na Twoją korzyść, nawet jeśli ten zespół ostatecznie meczu nie wygra.",
    },
  },
  review: REVIEW,
  version: 1,
};

export const bettersPromotions: Promotion[] = [welcome, freebet10, raiseBet, komfortBet];
