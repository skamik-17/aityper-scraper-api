import type { Promotion, PromotionEffectEntry } from "../../types/promotions.js";

// Entries come from the research files and the live terms.
// Terms are BETFAN regulation PDFs (storage.betfan.pl). termsHash = sha256 of
// `pdftotext <pdf> -` output, whitespace collapsed.

const review = (): Promotion["review"] => ({
  status: "verified",
  verifiedAt: "2026-11-07T01:20:00+01:00",
  verifiedBy: "research-agent",
});

const promo = (slug: string) => `https://betfan.pl/zaklady-bukmacherskie/promocje/${slug}`;

// Shared by both welcome regulations (v3 and the freebet 300 variant).
const Q_DEPOSIT_PERCENT =
  "uzyskuje możliwość otrzymania trzech nagród w postaci bonusu w wysokości 100% od każdej z trzech pierwszych wpłat spełniających warunki Promocji dokonanych na koncie Gracza do maksymalnej kwoty 200 zł";
const Q_MIN_DEPOSIT = "o ile wartość każdego z pierwszych trzech depozytów wyniesie co najmniej 50 zł.";
const Q_WAGERING =
  "Gracz musi dokonać 1-krotnego obrotu bonusem, tj. zawrzeć kupony za łączną stawkę odpowiadającą 1-krotności otrzymanej kwoty Bonusu powitalnego.";
const Q_WAGERING_ODDS =
  "Każdy kupon zawarty w ramach obrotu opisanego w pkt 1 musi być kuponem z co najmniej 2 zdarzeniami o łącznym kursie kuponu na minimum 3.0 lub wyższym w momencie rozliczenia kuponu.";
const Q_WAGERING_DAYS = "Termin ważności Bonusu powitalnego wynosi 10 dni";
const Q_AUDIENCE =
  "Promocja skierowana jest wyłącznie do pełnoletnich osób fizycznych uprawnionych do udziału w zakładach wzajemnych urządzanych na terytorium RP, które w okresie trwania Promocji utworzyły konto gracza na Stronie";
const Q_ONCE = "Każdy Klient ma prawo wziąć udział w Promocji jednokrotnie";
const Q_CONSENTS =
  "posiadanie aktywnych zgód na otrzymywanie treści marketingowych w formie SMS oraz e-mail. Zgody muszą zostać udzielone przez Gracza najpóźniej do momentu dokonania przez niego pierwszego depozytu.";

const depositBonus = (depositIndex: number): PromotionEffectEntry => ({
  effect: {
    type: "DEPOSIT_BONUS",
    depositIndex,
    percent: 100,
    capPln: 200,
    minDepositPln: 50,
    paidAs: {
      kind: "bonus_funds",
      wagering: { multiplier: 1, of: "bonus", ownFundsOnly: false, odds: { totalMin: 3.0 }, minLegs: 2, days: 10 },
    },
  },
  // Not "full": the deposit must be wagered first, a single bonus-coupon win is capped
  // at 2280 PLN and the transfer to the main balance at 5000 PLN; the types carry none of it.
  valuation: "display_only",
});

const depositEvidence = (i: number): Record<string, string> => ({
  [`effects[${i}].effect.percent`]: Q_DEPOSIT_PERCENT,
  [`effects[${i}].effect.capPln`]: Q_DEPOSIT_PERCENT,
  [`effects[${i}].effect.minDepositPln`]: Q_MIN_DEPOSIT,
  [`effects[${i}].effect.paidAs.wagering.multiplier`]: Q_WAGERING,
  [`effects[${i}].effect.paidAs.wagering.odds.totalMin`]: Q_WAGERING_ODDS,
  [`effects[${i}].effect.paidAs.wagering.minLegs`]: Q_WAGERING_ODDS,
  [`effects[${i}].effect.paidAs.wagering.days`]: Q_WAGERING_DAYS,
});

// §1.5 of each welcome regulation (v3 also excludes virtual sports, the freebet 300 one does not).
const Q_EXCLUSIONS_V3 =
  "Promocją objęta jest oferta zakładów bukmacherskich z wyłączeniem zakładów systemowych, zakładów na symulowane gry karciane, zakładów w zakładce „Sporty Wirtualne” (m.in. GG League i NBA GG League) oraz zakładów typu Boost.";
const Q_EXCLUSIONS_FB300 =
  "Promocją objęta jest oferta zakładów bukmacherskich z wyłączeniem zakładów systemowych, zakładów na symulowane gry karciane oraz zakładów typu Boost.";

const welcomeEligibility = (exclusionsNote: string): Promotion["eligibility"] => ({
  betTypes: ["single", "accumulator"],
  fundsSource: "any",
  requiresConfirmation: [
    {
      key: "betfan_marketing_consents",
      label: "Mam włączone zgody marketingowe SMS i e-mail w BETFAN (najpóźniej od pierwszej wpłaty)",
      expires: "never",
    },
  ],
  notes: [
    "Dotyczy też starszych kont bez pierwszej, drugiej lub trzeciej wpłaty.",
    "Bonus można wykorzystać dopiero po postawieniu z salda głównego kuponów za kwotę wpłaty.",
    "Wypłata z salda głównego przed końcem obrotu oznacza utratę bonusu.",
    "Pojedyncza wygrana z kuponu za bonus to maksymalnie 2280 zł.",
    "Na saldo główne można przenieść z bonusu maksymalnie 5000 zł.",
    exclusionsNote,
  ],
});

const welcomeNotesEvidence = (exclusionsQuote: string): Record<string, string> => ({
  "eligibility.requiresConfirmation": Q_CONSENTS,
  "eligibility.notes[1]":
    "Aby móc skorzystać z Bonusu powitalnego, Gracz musi wykorzystać w dowolny sposób równowartość wpłaconego depozytu lub kilku depozytów poprzez zawarcie kuponów z salda głównego.",
  "eligibility.notes[2]": "Zlecenie wypłaty z salda głównego przed zakończeniem obrotu Bonusem powitalnym skutkuje jego utratą.",
  "eligibility.notes[3]":
    "Pojedyncza wygrana z kuponu zawartego za Bonus powitalny nie może wynosić więcej niż 2280 PLN.",
  "eligibility.notes[4]": "Maksymalna kwota możliwa do przeniesienia na saldo główne jest ograniczona do 5000 PLN.",
  "eligibility.notes[5]": exclusionsQuote,
});

const bonusPowitalny: Promotion = {
  id: "betfan-bonus-powitalny",
  bookmaker: "betfan",
  name: "BONUS POWITALNY 3x100% do 200zł",
  audience: "new_customer",
  recurrence: { kind: "one_time" },
  validFrom: "2026-01-12T00:00:00+01:00",
  // Code source: BETFAN's promo-code page https://betfan.pl/kod-promocyjny-betfan
  // (API GET /api/v1/cms/custom-page/kod-promocyjny-betfan: "BETFAN kod promocyjny to:
  // PROMO2026"). The regulation itself only requires the "Kod rejestracyjny" field to be
  // filled and names no code.
  activation: { kind: "registration_code", code: "PROMO2026" },
  eligibility: welcomeEligibility(
    "Nie dotyczy zakładów systemowych, gier karcianych, sportów wirtualnych (m.in. GG League) i zakładów Boost."
  ),
  effects: [depositBonus(1), depositBonus(2), depositBonus(3)],
  stacking: { exclusiveGroup: "betfan-oferta-powitalna", combinableWith: [] },
  source: {
    promoUrl: promo("oferta-powitalna"),
    termsUrl: "https://storage.betfan.pl/regulations/2026_STYCZEN/akw/BONUSPOWITALNY100DO200ODTRZECHWPLATregulaminv3.pdf",
    termsVersionDate: "2026-01-12",
    termsHash: "1ac6c6f82129f545d35beb3af691b399f0f7f584c17bf2051a16bd7cdfe59365",
    fetchedAt: "2026-11-07T00:11:46Z",
    evidence: {
      audience: Q_AUDIENCE,
      recurrence: Q_ONCE,
      validFrom: "Promocja obowiązuje od dnia 12.01.2026 r. do odwołania.",
      "activation.kind":
        'Warunkiem uczestnictwa w Promocji jest uzupełnienie pola "Kod rejestracyjny" podczas wypełniania formularzu rejestracyjnego na Stronie',
      "eligibility.notes[0]":
        "oraz osób, które utworzyły Konto Gracza przed datą rozpoczęcia Promocji i nie dokonały pierwszego, drugiego lub trzeciego depozytu",
      ...welcomeNotesEvidence(Q_EXCLUSIONS_V3),
      ...depositEvidence(0),
      ...depositEvidence(1),
      ...depositEvidence(2),
    },
  },
  review: review(),
  version: 1,
};

const bonusPowitalnyFreebet300: Promotion = {
  id: "betfan-bonus-powitalny-freebet-300",
  bookmaker: "betfan",
  name: "BONUS POWITALNY 3x100% do 200zł + freebet 300 zł",
  audience: "new_customer",
  recurrence: { kind: "one_time" },
  validFrom: "2026-11-02T00:00:00+01:00",
  // validTo source: BETFAN's promo list API (POST https://betfan.pl/api/v1/cms/promotions,
  // body {}), card "wplacasz-500-zl-grasz-za-1000-zl", dateTill 2026-11-27T12:00:00.000Z.
  // The regulation (termsUrl) itself says "do odwołania".
  validTo: "2026-11-27T13:00:00+01:00",
  activation: { kind: "registration_code", code: "VIP500" },
  eligibility: welcomeEligibility("Nie dotyczy zakładów systemowych, gier karcianych i zakładów Boost."),
  effects: [
    depositBonus(1),
    depositBonus(2),
    depositBonus(3),
    {
      // The terms only say "wygrana minus stawka", so winFactor 1 / stakeDeduction 1;
      // whether the 12 % tax reduces the win is not stated (see the note).
      effect: {
        type: "FREEBET_GRANT",
        amountPln: 300,
        trigger: "Pierwsza wpłata co najmniej 500 zł",
        terms: { winFactor: 1, stakeDeduction: 1, validDays: 2, maxWinPln: 2000 },
      },
      extraEligibility: { notes: ["Regulamin nie mówi, czy wygrana z freebetu jest pomniejszana o podatek 12 %."] },
      valuation: "display_only",
    },
  ],
  stacking: { exclusiveGroup: "betfan-oferta-powitalna", combinableWith: [] },
  source: {
    promoUrl: promo("wplacasz-500-zl-grasz-za-1000-zl"),
    termsUrl:
      "https://storage.betfan.pl/regulations/AKW/2026/Pa%C5%BAdziernik/OFERTAPOWITALNAFREEBET300Zregulaminv2.pdf",
    termsVersionDate: "2026-11-02",
    termsHash: "044bfe29a0c7b3bc1f4b42aea7ff21235853c67ad24a1fce9a37b714e4ddc97b",
    fetchedAt: "2026-11-07T00:11:47Z",
    evidence: {
      audience: Q_AUDIENCE,
      recurrence: Q_ONCE,
      validFrom: "Promocja obowiązuje od dnia 02.11.2026 r. do odwołania.",
      // Second source: the promo list API (POST https://betfan.pl/api/v1/cms/promotions), not the PDF.
      validTo: '"dateTill":"2026-11-27T12:00:00.000Z"',
      "activation.code":
        'Warunkiem uczestnictwa w Promocji jest uzupełnienie pola "Kod rejestracyjny" kodem: VIP500 lub VIPFB500',
      "eligibility.notes[0]":
        "oraz osób, które utworzyły Konto Gracza przed datą rozpoczęcia Promocji i nie dokonały pierwszego, drugiego lub trzeciego depozytu",
      ...welcomeNotesEvidence(Q_EXCLUSIONS_FB300),
      ...depositEvidence(0),
      ...depositEvidence(1),
      ...depositEvidence(2),
      "effects[3].effect.amountPln":
        "Wszystkim Graczom zarejestrowanym z kodami rejestracyjnymi: VIP500 lub VIPFB500 po dokonaniu pierwszej wpłaty w kwocie minimum 500 PLN przysługuje również „Freebet” o wysokości 300 PLN.",
      "effects[3].effect.terms.validDays": "Termin ważności „Freebetu” wynosi 48 godzin i jest liczony od momentu przyznania.",
      "effects[3].effect.terms.maxWinPln": "Maksymalna wygrana z „Freebetu” wynosi 2000zł.",
      "effects[3].effect.terms.winFactor":
        "Wygrana z zakładu zawartego za „Freebet” doliczana jest do salda głównego jako zysk z zawartego zakładu (wygrana minus stawka).",
      "effects[3].effect.terms.stakeDeduction":
        "Wygrana z zakładu zawartego za „Freebet” doliczana jest do salda głównego jako zysk z zawartego zakładu (wygrana minus stawka).",
    },
  },
  review: review(),
  version: 1,
};

const akoBooster: Promotion = {
  id: "betfan-ako-booster",
  bookmaker: "betfan",
  name: "AKO BOOSTER",
  audience: "everyone",
  recurrence: { kind: "always_on" },
  validFrom: "2023-07-31T00:00:00+02:00",
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["accumulator"],
    minLegs: 5,
    fundsSource: "own_money_only",
    requiresConfirmation: [],
    notes: [
      "Do progu liczą się tylko zdarzenia z kursem co najmniej 1.40; nagroda liczy się od kursu łącznego tych zdarzeń, nie całego kuponu.",
      "Zdarzenie z kursem co najmniej 1.40 rozliczone jako zwrot obniża próg; gdy zostanie mniej niż 5 takich zdarzeń, nagroda przepada.",
      "Cashout anuluje nagrodę.",
      "Nie dotyczy zakładów systemowych, gier karcianych oraz kategorii Promocje i Rozrywka.",
    ],
  },
  effects: [
    {
      // "Nagroda = Stawka x Kurs x Mnożnik": the terms do not say whether the stake is
      // before or after the 12 % tax, so the effect is only displayed.
      effect: {
        type: "ACCA_BONUS",
        base: "gross_win",
        tiers: [
          { minLegs: 5, percent: 10 },
          { minLegs: 6, percent: 12 },
          { minLegs: 7, percent: 15 },
          { minLegs: 8, percent: 20 },
          { minLegs: 9, percent: 25 },
          { minLegs: 10, percent: 30 },
          { minLegs: 11, percent: 35 },
          { minLegs: 12, percent: 40 },
          { minLegs: 13, percent: 45 },
          { minLegs: 14, percent: 50 },
          { minLegs: 15, percent: 60 },
          { minLegs: 16, percent: 70 },
          { minLegs: 17, percent: 80 },
          { minLegs: 18, percent: 100 },
          { minLegs: 19, percent: 120 },
          { minLegs: 20, percent: 150 },
        ],
        qualifyingLegMinOdds: 1.4,
        capPln: 10000,
        paidAs: { kind: "cash" },
      },
      valuation: "display_only",
    },
  ],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: promo("ako-booster"),
    termsUrl: "https://storage.betfan.pl/regulations/AKOBOOSTERonlinev1.pdf",
    termsVersionDate: "2023-07-31",
    termsHash: "b8be4119f33e78d47aad77f2423b815cd8e31b96614e694a13b70ef69e0fc118",
    fetchedAt: "2026-11-07T00:11:47Z",
    evidence: {
      audience:
        "Promocja skierowana jest wyłącznie do pełnoletnich osób fizycznych uprawnionych do udziału w zakładach wzajemnych urządzanych na terytorium RP.",
      recurrence: "Promocja obowiązuje od dnia 31.07.2023 r. do odwołania.",
      validFrom: "Promocja obowiązuje od dnia 31.07.2023 r. do odwołania.",
      "eligibility.minLegs":
        "a) zawarty za środki własne, tj. środki pochodzące z salda depozytowego Gracza, b) rodzaj kuponu: AKO, c) zawierający min. 5 zdarzeń o kursie min. 1.40",
      "eligibility.fundsSource":
        "a) zawarty za środki własne, tj. środki pochodzące z salda depozytowego Gracza, b) rodzaj kuponu: AKO",
      "eligibility.notes[2]": "Kupony zamknięte za pomocą funkcji cashout nie są uwzględniane w Promocji.",
      "effects[0].effect.base": "Nagroda = Stawka x Kurs x Mnożnik = 100 zł x 10.0 x 10% = 100 zł",
      "eligibility.notes[0]":
        "(uwaga! wliczają się wyłącznie zdarzenia, które spełniają warunki promocji; nie kurs całkowity kuponu)",
      "eligibility.notes[1]":
        "jeżeli było to zdarzenie spełniające warunki Promocji dot. kursu, Nagroda przysługuje w ramach odpowiednio pomniejszonego mnożnika;",
      "effects[0].effect.tiers":
        "Liczba zdarzeń* 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20+ 10% 12% 15% 20% 25% 30% 35% 40% 45% 50% 60% 70% 80% 100% 120% 150% Mnożnik wygranej**",
      "effects[0].effect.qualifyingLegMinOdds":
        "Liczba zdarzeń - oznacza liczbę zdarzeń na kuponie spełniających warunki Promocji, tj. zdarzeń o kursie min. 1.40;",
      "effects[0].effect.capPln":
        "Maksymalna kwota Nagrody przysługującej w ramach jednego kuponu promocyjnego wynosi 10 000 zł.",
      "effects[0].effect.paidAs":
        "przyznawane jest automatycznie w formie środków przypisywanych na saldo depozytowe bez konieczności ich obrotu.",
    },
  },
  review: review(),
  version: 1,
};

const urodzinowyFreebet: Promotion = {
  id: "betfan-urodzinowy-freebet",
  bookmaker: "betfan",
  name: "URODZINOWY FREEBET 10 ZŁ ZA LOGOWANIE",
  audience: "existing_customer",
  recurrence: { kind: "always_on" },
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    fundsSource: "any",
    requiresConfirmation: [
      {
        key: "betfan_marketing_consents",
        label: "Mam włączone zgody marketingowe SMS i e-mail w BETFAN",
        expires: "never",
      },
      {
        key: "betfan_deposit_6_months_before_birthday",
        label: "Wpłaciłem pieniądze na konto BETFAN w ciągu 6 miesięcy przed dniem urodzin",
        expires: "never",
      },
    ],
    notes: [
      "Freebet 10 zł dostajesz po zalogowaniu w dniu urodzin; jest ważny 48 godzin, a zdarzenia muszą się zacząć w tym czasie.",
      "Przy wygranej na saldo główne trafia wygrana minus stawka freebetu, maksymalnie 2000 zł.",
      "Freebetu nie można użyć na zakłady systemowe, gry karciane i BOOST.",
      "Regulamin nie mówi, czy wygrana z freebetu jest pomniejszana o podatek 12 %.",
    ],
  },
  effects: [
    {
      // The terms only say the win is "pomniejszona o stawkę", so winFactor 1 /
      // stakeDeduction 1; whether the 12 % tax reduces the win is not stated (see the note).
      effect: {
        type: "FREEBET_GRANT",
        amountPln: 10,
        trigger: "Logowanie w dniu urodzin",
        terms: { winFactor: 1, stakeDeduction: 1, validDays: 2, maxWinPln: 2000 },
      },
      valuation: "display_only",
    },
  ],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: promo("urodzinowy-freebet-10-zl"),
    termsUrl: "https://storage.betfan.pl/regulations/2025_CZERWIEC/REGULAMINPROMOCJIurodzinowyfreebet.pdf",
    termsHash: "39906795e992f8ad4f62670cd9ce59bf5894196de598242bab7eb43a601b0219",
    fetchedAt: "2026-11-07T00:11:47Z",
    evidence: {
      audience:
        "Promocja dotyczy wszystkich Klientów, którzy w ciągu 6 miesięcy poprzedzających dzień urodzin przynajmniej raz dokonali depozytu w BETFAN.",
      recurrence: "ma charakter bezterminowy i trwa do odwołania",
      "activation.kind": "Freebet zostanie dopisany do Konta Gracza do 5 minut po zalogowaniu w czasie trwania Promocji.",
      "eligibility.requiresConfirmation[0]":
        "Aby wziąć udział w Promocji, Klient musi posiadać aktywne zgody na otrzymywanie treści marketingowych – SMS oraz e-mail.",
      "eligibility.requiresConfirmation[1]":
        "Promocja dotyczy wszystkich Klientów, którzy w ciągu 6 miesięcy poprzedzających dzień urodzin przynajmniej raz dokonali depozytu w BETFAN.",
      "effects[0].effect.amountPln":
        "Gracz uzyskuje możliwość otrzymania freebetu 10 zł, o ile w dniu swoich urodzin zaloguje się na swoje Konto Gracza.",
      "effects[0].effect.terms.validDays": "Termin ważności freebetu wynosi 48 godzin i jest liczony od momentu przyznania.",
      "effects[0].effect.terms.maxWinPln": "Maksymalna wygrana za freebet wynosi 2 000 zł.",
      "effects[0].effect.terms.winFactor":
        "Jeżeli zagrasz za freebet i wygrasz, na saldzie głównym pojawi się kwota wygranej pomniejszona o stawkę wykorzystanego freebetu.",
      "effects[0].effect.terms.stakeDeduction":
        "Jeżeli zagrasz za freebet i wygrasz, na saldzie głównym pojawi się kwota wygranej pomniejszona o stawkę wykorzystanego freebetu.",
    },
  },
  review: review(),
  version: 1,
};

const boost: Promotion = {
  id: "betfan-boost",
  bookmaker: "betfan",
  name: "BOOST, BOOST LIVE i PUSH BOOST",
  audience: "everyone",
  recurrence: { kind: "always_on" },
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    fundsSource: "own_money_only",
    requiresConfirmation: [],
    notes: [
      "Wybrane zdarzenia po kursie wyższym niż w standardowej ofercie, tylko online.",
      "BOOST i PUSH BOOST mają łączny limit stawki ustalany przez BETFAN.",
      "BOOST LIVE nie ma limitu stawki.",
      "PUSH BOOST jest tylko dla części graczy (powiadomienie push).",
      "Zakłady BOOST nie liczą się do obrotu bonusem powitalnym ani do freebetów.",
    ],
  },
  effects: [
    {
      effect: { type: "OTHER", description: "Podwyższone kursy na wybrane zdarzenia" },
      valuation: "display_only",
    },
  ],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: "https://betfan.pl/zaklady-bukmacherskie/promocje",
    termsUrl: "https://storage.betfan.pl/regulations/regulaminboost.pdf",
    termsHash: "2eb39c1f38160c7cf23e1526ae09bab0e529f5e7e9eccd35ea72778d7472a001",
    fetchedAt: "2026-11-07T00:11:47Z",
    evidence: {
      audience:
        "skierowana jest do pełnoletnich, zarejestrowanych użytkowników Strony Internetowej posiadających konto Gracza",
      recurrence: "Organizator zastrzega sobie prawo wstrzymania lub zakończenia promocji w dowolnym momencie.",
      "effects[0].effect.description":
        "W ramach Promocji, Gracz zyskuje możliwość zagrania wybranego zdarzenia po wyższym niż w standardowej ofercie kursem, w przypadku spełnienia warunków określonych przez Organizatora.",
      "eligibility.fundsSource": "Promocyjny zakład można zagrać tylko za środki z salda głównego.",
      "eligibility.betTypes": "Kupon z promocyjnym zakładem może być zagrany SOLO lub AKO.",
      "eligibility.notes[1]":
        "Promocyjny zakład „Boost” lub „Push Boost” można zagrać na kilku kuponach ale łączna stawka nie może przekraczać tej określonej przez Organizatora.",
      "eligibility.notes[0]":
        "Kupon zawierający zakład typu „Boost” musi zostać zawarty wyłącznie w formie online na stronie internetowej lub aplikacji BETFAN.",
      "eligibility.notes[2]": "Zakład „LIVE Boost” nie ma ograniczonej maksymalnej stawki.",
      "eligibility.notes[3]": "Zakład „Push Boost” jest przeznaczony tylko dla ograniczonej liczby Graczy",
    },
  },
  review: review(),
  version: 1,
};

export const betfanPromotions: Promotion[] = [
  bonusPowitalny,
  bonusPowitalnyFreebet300,
  akoBooster,
  urodzinowyFreebet,
  boost,
];
