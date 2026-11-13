import type { Promotion } from "../../types/promotions.js";

// Entries come from the research files and the live terms.
// Terms are LV BET CMS JSON documents (cms.lvbet.pl). termsHash = sha256 of the
// document's text fields (every string leaf except presentation keys: type,
// style, icon, image, payload, state, kind, themeClass), HTML stripped,
// whitespace collapsed.

const CMS_PARAMS = "productType=sportsbook&device=web&locale=pl&country=pl&enabledJsonHtml=1";
const single = (slug: string) => `https://cms.lvbet.pl/api/statics-promotions-single/${slug}?${CMS_PARAMS}`;
// Human-readable page for the UI "Regulamin" link (termsUrl is the CMS endpoint).
const publicPage = (slug: string) => `https://lvbet.pl/pl/promocje/${slug}`;

const review = (): Promotion["review"] => ({
  status: "verified",
  verifiedAt: "2026-11-07T01:20:00+01:00",
  verifiedBy: "research-agent",
});

// Welcome package landing (cms.lvbet.pl/api/lp/pakiet-powitalny-lv-bet)
const PAKIET_WAGERING_ODDS =
  "Czy są minimalne kursy poszczególnych selekcji? W tym przypadku nie ma żadnych ograniczeń! Jedynie kurs całkowity kuponu musi wynieść minimum 1.75.";
const PAKIET_DEPOSIT_LOCKED =
  "Skorzystanie z bonusu oznacza, iż po wpłacie środki z depozytu wraz z bonusem będą znajdować się w saldzie środków bonusowych opisanych w punkcie nr 14 jako (Y).";
const PAKIET_MIN_DEPOSIT = "Wpłata minimalna pozwalająca na skorzystanie z Bonusu to 10 PLN.";
const wageringQuote = (times: number) =>
  `Saldo bonusowe (otrzymane środki bonusowe oraz wpłacony depozyt przeniesiony na saldo bonusowe) podlegają ${times}-krotnemu wymogowi obrotu po minimalnym kursie 1.75, tylko i wyłącznie w ofercie sportowej.`;

const depositEvidence = (
  i: number,
  q: { percent: string; days: string; times: number; baseCap: string }
): Record<string, string> => ({
  [`effects[${i}].effect.percent`]: q.percent,
  [`effects[${i}].effect.capPln`]: q.percent,
  [`effects[${i}].effect.minDepositPln`]: PAKIET_MIN_DEPOSIT,
  [`effects[${i}].effect.paidAs.wagering.multiplier`]: wageringQuote(q.times),
  [`effects[${i}].effect.paidAs.wagering.of`]: wageringQuote(q.times),
  [`effects[${i}].effect.paidAs.wagering.odds.totalMin`]: PAKIET_WAGERING_ODDS,
  [`effects[${i}].effect.paidAs.wagering.days`]: q.days,
  [`effects[${i}].effect.paidAs.wagering.baseCapPln`]: q.baseCap,
  [`effects[${i}].effect.paidAs.wagering.depositLocked`]: PAKIET_DEPOSIT_LOCKED,
});

const pakietPowitalny: Promotion = {
  id: "lvbet-pakiet-powitalny",
  bookmaker: "lvbet",
  name: "Pakiet Powitalny 4321 PLN",
  audience: "new_customer",
  recurrence: { kind: "one_time" },
  validFrom: "2026-02-11T12:00:00+01:00",
  activation: { kind: "choose_at_deposit" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    fundsSource: "any",
    requiresConfirmation: [],
    notes: [
      "Bonus trzeba zaznaczyć przed wpłatą (Wpłata → Dostępne Bonusy).",
      "Wpłata i bonus trafiają razem na saldo bonusowe; obrót liczy się od ich sumy.",
      "Do obrotu liczą się zakłady sportowe z kursem łącznym co najmniej 1.75; zakłady systemowe, MultiSingiel, Cash-Out, sporty wirtualne, Player Bets, LV Jackpot i gry się nie liczą.",
      "Do skorzystania z pakietu wystarczy konto tymczasowe.",
    ],
  },
  effects: [
    {
      effect: {
        type: "DEPOSIT_BONUS",
        depositIndex: 1,
        percent: 100,
        capPln: 600,
        minDepositPln: 10,
        paidAs: {
          kind: "bonus_funds",
          wagering: {
            multiplier: 4,
            of: "deposit_plus_bonus",
            ownFundsOnly: false,
            odds: { totalMin: 1.75 },
            days: 30,
            baseCapPln: 1200,
            depositLocked: true,
          },
        },
      },
      valuation: "full",
    },
    {
      effect: {
        type: "DEPOSIT_BONUS",
        depositIndex: 2,
        percent: 50,
        capPln: 1400,
        minDepositPln: 10,
        paidAs: {
          kind: "bonus_funds",
          wagering: {
            multiplier: 3,
            of: "deposit_plus_bonus",
            ownFundsOnly: false,
            odds: { totalMin: 1.75 },
            days: 30,
            baseCapPln: 4200,
            depositLocked: true,
          },
        },
      },
      valuation: "full",
    },
    {
      effect: {
        type: "DEPOSIT_BONUS",
        depositIndex: 3,
        percent: 30,
        capPln: 2000,
        minDepositPln: 10,
        paidAs: {
          kind: "bonus_funds",
          wagering: {
            multiplier: 2,
            of: "deposit_plus_bonus",
            ownFundsOnly: false,
            odds: { totalMin: 1.75 },
            days: 30,
            baseCapPln: 8667,
            depositLocked: true,
          },
        },
      },
      valuation: "full",
    },
    {
      // Paid as a bonus with an x5 odds multiplier, which no payout form represents.
      effect: {
        type: "OTHER",
        description:
          "Cashback od czwartej wpłaty: gdy pierwszy zakład po tej wpłacie przegra, zwrot 50% stawki (od 10 do 321 zł) jako bonus z mnożnikiem kursu ×5, np. 321 zł = bonus 64,20 zł × 5",
      },
      extraEligibility: {
        fundsSource: "own_money_only",
        minStakePln: 20,
        requiresConfirmation: [
          {
            key: "lvbet_fourth_deposit_first_bet",
            label: "Wpłaciłem czwarty depozyt w LV BET (co najmniej 20 zł) i to mój pierwszy kupon po tej wpłacie",
            expires: "never",
          },
        ],
        notes: [
          "Zwrot jest wypłacany jako bonus z mnożnikiem kursu ×5: 321 zł zwrotu to bonus 64,20 zł × 5.",
          "Bonus ×5 można użyć na AKO z co najmniej 3 zdarzeniami, kursem łącznym co najmniej 2.50 i każdym zdarzeniem co najmniej 1.25; jest ważny 30 dni.",
          "Stawka kuponu nie może przekraczać kwoty czwartej wpłaty; promocja jest aktywna 14 dni od tej wpłaty.",
        ],
      },
      valuation: "display_only",
    },
  ],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: "https://lvbet.pl/pl/lp/pakiet-powitalny-lv-bet",
    termsUrl: `https://cms.lvbet.pl/api/lp/pakiet-powitalny-lv-bet?${CMS_PARAMS}`,
    publicTermsUrl: "https://lvbet.pl/pl/lp/pakiet-powitalny-lv-bet",
    termsVersionDate: "2026-02-11",
    termsHash: "8f98d3455a6327bcb72e63331832c0902567cfd7b16100eeca86a96934485636",
    fetchedAt: "2026-11-07T00:05:22Z",
    evidence: {
      audience: "Bonus Powitalny jest dostępny przy pierwszej wpłacie oraz będzie aktywny 30 dni od momentu pojawienia się na saldzie bonusowym.",
      recurrence:
        "Na jedno konto gracza w LV BET przysługuje jeden Bonus Powitalny, co oznacza nie więcej niż jeden bonus na użytkownika",
      validFrom: "Powyższy regulamin jest ważny od 11.02.2026 12:00 CET.",
      "activation.kind": "Bonus Powitalny należy zaznaczyć przed pobraniem w zakładce Wpłata, Dostępne Bonusy.",
      ...depositEvidence(0, {
        percent: "Wysokość bonusu to 100% od depozytu, maksymalnie do 600 PLN.",
        days: "Bonus Powitalny jest dostępny przy pierwszej wpłacie oraz będzie aktywny 30 dni od momentu pojawienia się na saldzie bonusowym.",
        times: 4,
        baseCap:
          "Przy wpłacie większej niż 600 PLN (np. 1000 PLN) kwota 400 PLN (nadpłata) zostanie dodana do salda z funduszami realnymi (X) opisanymi w punkcie nr 14.",
      }),
      ...depositEvidence(1, {
        percent: "Wysokość bonusu to 50% od depozytu, maksymalnie do 1400 PLN.",
        days: "Bonus 1400 PLN jest dostępny tylko przy drugiej wpłacie na konto gracza oraz będzie aktywny 30 dni od momentu pojawienia się na saldzie bonusowym.",
        times: 3,
        baseCap:
          "Przy wpłacie większej niż 2800 PLN (np. 3000 PLN) kwota 200 PLN (nadpłata) zostanie dodana do salda z funduszami realnymi (X) opisanymi w punkcie nr 14.",
      }),
      ...depositEvidence(2, {
        percent: "Wysokość bonusu to 30% od depozytu, maksymalnie do 2000 PLN.",
        days: "Bonus 2000 PLN jest dostępny tylko przy trzeciej wpłacie na konto gracza oraz będzie aktywny 30 dni od momentu pojawienia się na saldzie bonusowym.",
        times: 2,
        baseCap:
          "Przy wpłacie większej niż 6667 PLN (np. 7000 PLN) kwota 333 PLN (nadpłata) zostanie dodana do salda z funduszami realnymi (X) opisanymi w punkcie nr 14.",
      }),
      "effects[3].effect.description":
        "Wysokość cashbacku to 50% od zagranej stawki, minimalna kwota cashbacku to 10 PLN (przy stawce zakładu 20 PLN), maksymalna kwota cashbacku to 321 PLN (przy stawce zakładu 642 PLN lub większej).",
      "effects[3].extraEligibility.notes[0]":
        "Cashback będzie wypłacany w bonusie z mnożnikiem kursu x5 (przykładowo: Cashback 10 PLN = bonus 2 PLN z mnożnikiem x5; Cashback 321 PLN = bonus 64,20 PLN z mnożnikiem x5)",
      "effects[3].extraEligibility.notes[1]":
        "Wykorzystanie bonusu z mnożnikiem kursu „x5” będzie możliwe tylko przy zakładach kombi składających się z minimum 3 zdarzeń, o łącznym kursie kuponu minimum 2.50 oraz minimalnym kursie każdego zdarzenia wynoszącym 1.25.",
      "effects[3].extraEligibility.notes[2]":
        "Cashback będzie liczony od pierwszego zakładu po czwartym depozycie, kwota zakładu nie może być większa niż sam depozyt",
      "effects[3].extraEligibility.requiresConfirmation[0].label": "Cashback będzie liczony od pierwszego zakładu po czwartym depozycie",
      "effects[3].extraEligibility.minStakePln":
        "minimalna kwota cashbacku to 10 PLN (przy stawce zakładu 20 PLN)",
      "effects[3].extraEligibility.fundsSource":
        "W promocji nie biorą udziału: zakłady postawione za środki bonusowe, wygrane zakłady, zakłady systemowe",
      "effects[3].extraEligibility.requiresConfirmation[0]":
        "Cashback 321 PLN jest dostępny tylko po czwartej wpłacie na konto gracza oraz będzie aktywny przez 14 dni. Wpłata minimalna pozwalająca na skorzystanie z Bonusu to 20 PLN.",
    },
  },
  review: review(),
  version: 1,
};

const bezPodatkuPoRejestracji: Promotion = {
  id: "lvbet-bez-podatku-po-rejestracji",
  bookmaker: "lvbet",
  name: "Graj bez podatku po rejestracji",
  audience: "new_customer",
  recurrence: { kind: "always_on" },
  validFrom: "2024-05-29T10:00:00+02:00",
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["accumulator"],
    minLegs: 2,
    odds: { totalMin: 1.75 },
    fundsSource: "own_money_only",
    couponAction: "Jeśli kupon LV BET pozwala wybrać między grą bez podatku a LV Kombi Boost, wybierz «Gra bez podatku»",
    requiresConfirmation: [],
    notes: [
      "Zdarzenie rozliczone jako zwrot (kurs 1.00) obniża kurs kuponu i może odebrać kuponowi promocję.",
      "Nie dotyczy zakładów pojedynczych, MultiSingiel, Cash-Out, sportów wirtualnych, Player Bets i gier.",
    ],
  },
  effects: [
    {
      effect: { type: "TAX_RELIEF", relief: { kind: "stake_factor", factor: 1.0 } },
      extraEligibility: { accountAgeDays: { to: 45 } },
      valuation: "full",
    },
  ],
  stacking: {
    exclusiveGroup: "lvbet-bez-podatku-lub-kombi-boost",
    combinableWith: ["lvbet-pakiet-powitalny"],
  },
  source: {
    promoUrl: "https://lvbet.pl/pl/promocje/bez-podatku-po-rejestracji",
    termsUrl: single("bez-podatku-po-rejestracji"),
    publicTermsUrl: publicPage("bez-podatku-po-rejestracji"),
    termsHash: "75238ad86a2206a544182764916c55bcb62f0100f46ccb25fb10b80a8d1ae921",
    fetchedAt: "2026-11-07T00:05:22Z",
    evidence: {
      audience:
        "Promocja przysługuje nowo zarejestrowanym graczom LV BET od 29.05.2024 (od godziny 10:00) do odwołania.",
      recurrence: "Promocja “Graj bez podatku po rejestracji” obowiązuje przez 45 dni od pierwszej rejestracji.",
      validFrom:
        "Promocja przysługuje nowo zarejestrowanym graczom LV BET od 29.05.2024 (od godziny 10:00) do odwołania.",
      "eligibility.betTypes":
        "W promocji nie biorą udziału: zakłady postawione za środki bonusowe, zakłady pojedyncze, zakłady rozliczone przez opcję Cash-Out",
      "eligibility.minLegs":
        "W przypadku zakładów kombinacyjnych zbudowanych z minimum 2 selekcji, z kursem całkowitym minimum 1.75",
      "eligibility.odds.totalMin":
        "W przypadku zakładów kombinacyjnych zbudowanych z minimum 2 selekcji, z kursem całkowitym minimum 1.75",
      "eligibility.fundsSource": "Tylko zakłady postawione za środki własne biorą udział w promocji.",
      "effects[0].effect.relief.factor":
        "odpowiednie parametry zakładu zostaną podwyższone w taki sposób, że typowy wskaźnik 0,88 ulegnie podwyższeniu do 1,00 - przykładowo, stawiając zakład za 200 PLN, stawka zakładu po przemnożeniu przez omawiany wskaźnik wynosić będzie 200 PLN.",
      "effects[0].extraEligibility.accountAgeDays.to":
        "Promocja “Graj bez podatku po rejestracji” obowiązuje przez 45 dni od pierwszej rejestracji.",
      "stacking.combinableWith": "Element oferty Pakiet Powitalny 4321 PLN",
    },
  },
  review: review(),
  version: 1,
};

const startApp20: Promotion = {
  id: "lvbet-start-app-20",
  bookmaker: "lvbet",
  name: "Bonus Start App 20 PLN",
  audience: "new_customer",
  recurrence: { kind: "one_time" },
  validFrom: "2023-02-14T12:00:00+01:00",
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    odds: { totalMin: 1.75 },
    minStakePln: 20,
    fundsSource: "own_money_only",
    requiresConfirmation: [
      { key: "lvbet_deposit_20", label: "Wpłaciłem co najmniej 20 zł na konto LV BET", expires: "never" },
      { key: "lvbet_first_bet_in_app", label: "Pierwszy zakład po rejestracji stawiam w aplikacji LV BET", expires: "never" },
    ],
    notes: [
      "Aplikacja PWA (dodana z przeglądarki do ekranu głównego) też się liczy; pierwszy zakład na stronie w przeglądarce wyklucza promocję.",
      "Zdarzenie rozliczone jako zwrot (kurs 1.00) obniża kurs łączny kuponu.",
      "Zwrot trafia na konto w poniedziałek, środę lub piątek do 17:00.",
    ],
  },
  effects: [
    {
      effect: {
        type: "REFUND_ON_LOSS",
        percent: 100,
        base: "gross_stake",
        capPln: 20,
        paidAs: {
          kind: "bonus_funds",
          wagering: { multiplier: 3, of: "bonus", ownFundsOnly: false, odds: { totalMin: 1.75 }, days: 30 },
        },
        firstCouponOnly: true,
      },
      valuation: "full",
    },
  ],
  stacking: { combinableWith: ["lvbet-bez-podatku-po-rejestracji", "lvbet-pakiet-powitalny"] },
  source: {
    promoUrl: "https://lvbet.pl/pl/promocje/app-20pln",
    termsUrl: single("app-20pln"),
    publicTermsUrl: publicPage("app-20pln"),
    termsHash: "8edda730960c343f18f094b4eb3b770d25117c0f7a7f65037271fc0d66f5c6e3",
    fetchedAt: "2026-11-07T00:05:23Z",
    evidence: {
      audience:
        "Bonus Start App 20 PLN jest dostępny tylko dla nowo zarejestrowanych graczy od 14.02.2023 (od 12:00), aż do odwołania.",
      recurrence: "Na jedno konto gracza w LV BET przysługuje jeden zwrot w ramach promocji Bonus Start App 20 PLN",
      validFrom:
        "Bonus Start App 20 PLN jest dostępny tylko dla nowo zarejestrowanych graczy od 14.02.2023 (od 12:00), aż do odwołania.",
      "eligibility.minStakePln":
        "Do promocji kwalifikuje się zakład o stawce minimalnej 20 PLN (brutto) oraz kursie minimalnym 1.75 postawiony za środki własne, który po rozliczeniu okazał się przegrany.",
      "eligibility.odds.totalMin":
        "Do promocji kwalifikuje się zakład o stawce minimalnej 20 PLN (brutto) oraz kursie minimalnym 1.75 postawiony za środki własne, który po rozliczeniu okazał się przegrany.",
      "eligibility.fundsSource": "Zakłady postawione za środki bonusowe nie kwalifikują się do promocji.",
      "eligibility.requiresConfirmation[0]": "Aby skorzystać z promocji należy dokonać wpłaty na konto gracza za minimum 20 PLN.",
      "eligibility.requiresConfirmation[1]":
        "Gracz może otrzymać jednorazowo maksymalnie 20 PLN za pierwszy zakład postawiony po rejestracji w aplikacji mobilnej lub aplikacji PWA (dodanej z przeglądarki do ekranu głównego).",
      "eligibility.notes[0]":
        "lub gracz postawił pierwszy zakład za środki własne na stronie mobilnej lvbet.pl lub sprzęcie komputerowym (PC / laptop).",
      "effects[0].effect.percent": "Zwrot stawki w ramach promocji",
      "effects[0].effect.capPln":
        "Gracz może otrzymać jednorazowo maksymalnie 20 PLN za pierwszy zakład postawiony po rejestracji w aplikacji mobilnej lub aplikacji PWA (dodanej z przeglądarki do ekranu głównego).",
      "effects[0].effect.base": "o stawce minimalnej 20 PLN (brutto)",
      "effects[0].effect.paidAs.wagering":
        "Bonus podlega 3-krotnemu wymogowi obrotu po minimalnym kursie 1.75 oraz będzie dostępny przez 30 dni od momentu jego zakredytowania na koncie gracza.",
      "effects[0].effect.firstCouponOnly":
        "Gracz nie bierze udziału w promocji, jeśli pierwszy zakład w aplikacji mobilnej PWA okazał się wygrany lub gracz postawił pierwszy zakład za środki własne na stronie mobilnej lvbet.pl lub sprzęcie komputerowym (PC / laptop).",
      "stacking.combinableWith[0]":
        "Do promocji kwalifikują się zakłady objęte promocją Zbijamy podatek po rejestracji (gra bez podatku).",
      "stacking.combinableWith[1]":
        "Gracz może odebrać zwrot za zakład postawiony w aplikacji mobilnej lub aplikacji PWA pomimo wcześniejszego wykorzystania bonusu od pierwszego depozytu (100% do 600 PLN)",
    },
  },
  review: review(),
  version: 1,
};

const kombiBoost: Promotion = {
  id: "lvbet-kombi-boost",
  bookmaker: "lvbet",
  name: "LV Kombi Boost",
  audience: "everyone",
  recurrence: { kind: "always_on" },
  validFrom: "2021-02-03T00:01:00+01:00",
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["accumulator"],
    minLegs: 3,
    fundsSource: "own_money_only",
    couponAction: "Jeśli kupon LV BET pozwala wybrać między grą bez podatku a LV Kombi Boost, wybierz «LV Kombi Boost»",
    requiresConfirmation: [],
    notes: [
      "Zdarzenia z kursem poniżej 1.25 nie liczą się do progu.",
      "Zdarzenie rozliczone jako zwrot (kurs 1.00) nie liczy się do progu; bonus spada do niższego progu.",
      "Nie dotyczy zakładów systemowych, Cash-Out, sportów wirtualnych, Player Bets, gier i LV Jackpot.",
    ],
  },
  effects: [
    {
      effect: {
        type: "ACCA_BONUS",
        base: "total_odds",
        tiers: [
          { minLegs: 3, percent: 2 },
          { minLegs: 4, percent: 5 },
          { minLegs: 5, percent: 8 },
          { minLegs: 6, percent: 11 },
          { minLegs: 7, percent: 15 },
          { minLegs: 8, percent: 20 },
          { minLegs: 9, percent: 25 },
          { minLegs: 10, percent: 30 },
          { minLegs: 11, percent: 35 },
          { minLegs: 12, percent: 40 },
          { minLegs: 13, percent: 50 },
          { minLegs: 14, percent: 60 },
          { minLegs: 15, percent: 75 },
        ],
        qualifyingLegMinOdds: 1.25,
        paidAs: { kind: "cash" },
      },
      valuation: "full",
    },
  ],
  stacking: { exclusiveGroup: "lvbet-bez-podatku-lub-kombi-boost", combinableWith: [] },
  source: {
    promoUrl: "https://lvbet.pl/pl/promocje/lv-kombi-boost",
    termsUrl: single("lv-kombi-boost"),
    publicTermsUrl: publicPage("lv-kombi-boost"),
    termsHash: "b5209f818afd58324d8a104abd5189f4bcf40710ec26f59b26807655c3611561",
    fetchedAt: "2026-11-07T00:05:22Z",
    evidence: {
      audience: "Oferta skierowana jest wyłącznie do pełnoletnich użytkowników (18+).",
      recurrence: "Promocja jest ważna od 03.02.2021 (od godziny 00:01), aż do odwołania.",
      validFrom: "Promocja jest ważna od 03.02.2021 (od godziny 00:01), aż do odwołania.",
      "eligibility.minLegs": "Zakład kwalifikujący się do promocji to kupon kombi z minimum trzema (3) selekcjami.",
      "eligibility.fundsSource":
        "W promocji nie biorą udziału: zakłady postawione za środki bonusowe, zakłady systemowe, zakłady rozliczone przez opcję Cash-Out",
      "effects[0].effect.base":
        "Jeżeli gracz przygotuje kupon kombi, którego kurs wyniósłby 5.00, to po przemnożeniu przez promocyjny wskaźnik finalny kurs całkowity kuponu wynosił będzie 5.55.",
      "effects[0].effect.tiers":
        "Liczba selekcji Boost Kursu 3 +2% 4 +5% 5 +8% 6 +11% 7 +15% 8 +20% 9 +25% 10 +30% 11 +35% 12 +40% 13 +50% 14 +60% 15 +75%",
      "effects[0].effect.tiers[12]": "1.75 (boost kursu całkowitego 75%) przy piętnastu lub więcej selekcjach.",
      "effects[0].effect.qualifyingLegMinOdds":
        "W promocji biorą udział selekcje o kursie minimalnym 1.25. W przypadku dodania do kuponu selekcji z kursem mniejszym niż 1.25 kurs całkowity nie zostanie powiększony o nową selekcję.",
      "effects[0].effect.paidAs": "całkowity kurs kuponu zostanie pomnożony o: 1.02 (boost kursu całkowitego 2%) przy trzech selekcjach;",
      "stacking.exclusiveGroup":
        "W przypadku kiedy na stronie obowiązuje promocja z grą bez podatku, gracz może samodzielnie wybrać z jakiej promocji skorzysta.",
      "eligibility.couponAction":
        "W przypadku kiedy na stronie obowiązuje promocja z grą bez podatku, gracz może samodzielnie wybrać z jakiej promocji skorzysta.",
    },
  },
  review: review(),
  version: 1,
};

const bezpiecznyKupon: Promotion = {
  id: "lvbet-bezpieczny-kupon",
  bookmaker: "lvbet",
  name: "Bezpieczny Kupon 4+",
  audience: "everyone",
  recurrence: { kind: "per_period", period: "week" },
  validFrom: "2022-04-11T10:00:00+02:00",
  activation: { kind: "join_button" },
  eligibility: {
    betTypes: ["accumulator"],
    minLegs: 4,
    odds: { totalMin: 3.0 },
    minStakePln: 20,
    fundsSource: "own_money_only",
    requiresConfirmation: [],
    notes: [
      "Zapis przyciskiem «Biorę udział» trzeba powtarzać w każdym tygodniu (od poniedziałku 10:00).",
      "Liczy się tylko pierwszy kupon AKO z co najmniej 4 zdarzeniami postawiony w danym tygodniu.",
      "Wszystkie zdarzenia muszą się rozstrzygnąć do niedzieli 23:59 tego samego tygodnia.",
      "Kurs 3.00 liczy się przed podwyższeniem z LV Kombi Boost.",
      "Zdarzenie rozliczone jako zwrot (kurs 1.00) albo «half won» wyklucza zwrot.",
      "Zwrot jest zaokrąglany do pełnej złotówki i wypłacany w poniedziałek do 16:00.",
    ],
  },
  effects: [
    {
      effect: {
        type: "REFUND_ON_ONE_MISS",
        minLegs: 4,
        capPln: 50,
        paidAs: {
          kind: "bonus_funds",
          wagering: { multiplier: 3, of: "bonus", ownFundsOnly: false, odds: { totalMin: 1.75 }, days: 30 },
        },
      },
      valuation: "full",
    },
  ],
  stacking: { combinableWith: ["lvbet-kombi-boost"] },
  source: {
    promoUrl: "https://lvbet.pl/pl/promocje/bezpieczny-4",
    termsUrl: single("bezpieczny-4"),
    publicTermsUrl: publicPage("bezpieczny-4"),
    termsHash: "e6f9bc9cdb66c00007420d17cf60e095a7a4fa7620d10a5c2aaf977e411f22b6",
    fetchedAt: "2026-11-07T00:05:22Z",
    evidence: {
      audience: "Oferta skierowana jest wyłącznie do pełnoletnich użytkowników (18+).",
      recurrence:
        "Kliknięcie przycisku BIORĘ UDZIAŁ uprawnia gracza do otrzymania zwrotu za dany tydzień. Czynność tą należy powtarzać na początku każdego tygodnia, aby wziąć udział w promocji.",
      validFrom: "Promocja trwa od 11.04.2022 (od godziny 10:00) do odwołania.",
      "activation.kind": "Przycisk BIORĘ UDZIAŁ będzie aktywowany w każdy poniedziałek od godziny 10:00.",
      "eligibility.minLegs":
        "W promocji biorą udział gracze, którzy postawili zakład kombi składający się z minimum 4 zdarzeń.",
      "eligibility.odds.totalMin":
        "Minimalny kurs ważnego zakładu kombinacyjnego wynosi 3.00. Do promocji kwalifikuje gracza kurs realny, przed jego podwyższeniem z promocji LV Kombi Boost.",
      "eligibility.minStakePln": "Minimalna stawka pozwalająca wziąć udział w promocji to 20 PLN.",
      "eligibility.fundsSource":
        "W promocji nie biorą udziału: zakłady postawione za środki bonusowe, zakłady rozliczone przez opcję Cash-Out, zakłady systemowe",
      "effects[0].effect.minLegs":
        "Zwrot będzie przysługiwał jeżeli jedno z wydarzeń na postawionym kuponie będzie nietrafione, a wszystkie pozostałe zostaną wytypowane poprawnie.",
      "effects[0].effect.capPln":
        "Zwrot stawki w postaci bonusu do 50 PLN wypłacony zostanie w każdy poniedziałek do godziny 16:00.",
      "effects[0].effect.paidAs.wagering.multiplier":
        "Przyznany bonus podlega 3-krotnemu wymogowi obrotu, po minimalnym kursie 1.75.",
      "effects[0].effect.paidAs.wagering.days":
        "Przyznany bonus będzie do wykorzystania na stronie zakładów bukmacherskich z wyłączeniem Gier, Player Bets, LV Jackpot, Sportów Wirtualnych przez 30 dni od momentu jego aktywacji na saldzie bonusowym.",
      "stacking.combinableWith":
        "Do promocji kwalifikuje gracza kurs realny, przed jego podwyższeniem z promocji LV Kombi Boost.",
    },
  },
  review: review(),
  version: 1,
};

const codziennyCashback: Promotion = {
  id: "lvbet-codzienny-cashback-30",
  bookmaker: "lvbet",
  name: "Codzienny Cashback 30 PLN",
  audience: "everyone",
  recurrence: { kind: "per_period", period: "day" },
  validFrom: "2023-01-23T10:00:00+01:00",
  activation: { kind: "join_button" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    minStakePln: 60,
    fundsSource: "own_money_only",
    requiresConfirmation: [
      {
        key: "lvbet_deposit_today_60",
        label: "Wpłaciłem dziś co najmniej 60 zł w LV BET i to mój pierwszy zakład po tej wpłacie",
        expires: "end_of_day",
      },
    ],
    notes: [
      "Zapis przyciskiem «Biorę udział» działa do końca tygodnia; trzeba go powtarzać co poniedziałek.",
      "Liczy się tylko pierwszy zakład po pierwszej wpłacie dnia; musi się rozstrzygnąć tego samego dnia do 23:59.",
      "Zwrot to bonus 2 zł z mnożnikiem kursu ×15 (równowartość 30 zł), ważny 7 dni.",
      "Bonus ×15 można użyć na AKO z co najmniej 3 zdarzeniami, kursem łącznym co najmniej 2.50 i każdym zdarzeniem co najmniej 1.25.",
    ],
  },
  effects: [
    {
      // Paid as a 2 PLN bonus with an x15 odds multiplier, which no payout form represents.
      effect: {
        type: "OTHER",
        description:
          "Gdy pierwszy zakład po pierwszej wpłacie dnia (wpłata i stawka co najmniej 60 zł) przegra i rozliczy się tego samego dnia: zwrot o równowartości 30 zł jako bonus 2 zł z mnożnikiem kursu ×15",
      },
      valuation: "display_only",
    },
  ],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: "https://lvbet.pl/pl/promocje/cashback-30pln",
    termsUrl: single("cashback-30pln"),
    publicTermsUrl: publicPage("cashback-30pln"),
    termsHash: "46f6c5b710dc9efb529bb7c1caf18b1fe150d5fbec5813a6c4235536e972d84c",
    fetchedAt: "2026-11-07T00:05:23Z",
    evidence: {
      audience: "Do promocji kwalifikują się gracze, którzy klikną przycisk BIORĘ UDZIAŁ",
      recurrence:
        "Jeden gracz danego dnia po wpłacie minimum 60 PLN, a następnie postawieniu wpłaconych środków może otrzymać 2 PLN z mnożnikiem kursu x15 w ramach niniejszej promocji.",
      validFrom: "Promocja potrwa od 23.01.2023 (od 10:00) do odwołania.",
      "activation.kind": "Przycisk BIORĘ UDZIAŁ będzie aktywowany w każdy poniedziałek od godziny 10:00.",
      "eligibility.minStakePln":
        "Do zwrotu stawki 30 PLN (2 PLN x15) kwalifikują się gracze, którzy jednego dnia dokonają depozytu za minimum 60 PLN, a następnie postawią zakład o stawce minimalnej 60 PLN (52.8 PLN netto), który okaże się przegrany.",
      "eligibility.requiresConfirmation":
        "Tylko po pierwszym dokonanym depozycie o wartości minimum 60 PLN danego dnia, gracz może otrzymać zwrot za pierwszy przegrany zakład.",
      "eligibility.fundsSource":
        "W promocji nie biorą udziału: zakłady postawione za środki bonusowe, wygrane zakłady, zakłady systemowe",
      "effects[0].effect.description": "Ekwiwalent 30 PLN otrzymasz w bonusie 2 PLN z mnożnikiem kursu x15.",
      "eligibility.notes[1]":
        "Do promocji kwalifikują się tylko przegrane kupony, które zostaną rozliczone tego samego dnia do godziny 23:59, w którym zostały postawione.",
      "eligibility.notes[2]":
        "Bonus za spełnienie warunków promocji zostanie dodany na konto gracza kolejnego dnia do godziny 17:00 i jest ważny 7 dni od momentu jego aktywacji na saldzie bonusowym.",
      "eligibility.notes[3]":
        "Wykorzystanie bonusu z mnożnikiem kursu „x15” będzie możliwe tylko przy zakładach kombi składających się z minimum 3 zdarzeń, o łącznym kursie kuponu minimum 2.50 oraz minimalnym kursie każdego zdarzenia wynoszącym 1.25.",
      "stacking.combinableWith": "Za dany kupon przysługuje tylko jeden zwrot.",
    },
  },
  review: review(),
  version: 1,
};

const kursPlus: Promotion = {
  id: "lvbet-kurs-plus",
  bookmaker: "lvbet",
  name: "Kurs+",
  audience: "everyone",
  recurrence: { kind: "always_on" },
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    fundsSource: "own_money_only",
    requiresConfirmation: [],
    notes: [
      "Gotowy kupon dnia z kursem podniesionym o 20–30%, tylko w ofercie przedmeczowej.",
      "Obowiązuje maksymalna stawka; Kurs+ można zagrać tylko na jednym kuponie.",
      "Nie łączy się z grą bez podatku ani z LV Kombi Boost.",
    ],
  },
  effects: [
    {
      effect: { type: "OTHER", description: "Gotowy kupon dnia z kursem podniesionym o 20–30%" },
      valuation: "display_only",
    },
  ],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: "https://lvbet.pl/pl/promocje/kurs-plus",
    termsUrl: single("kurs-plus"),
    publicTermsUrl: publicPage("kurs-plus"),
    termsHash: "db653da88e2ba87ecf7642c8e4e1060e9b182f9f47c739018bad65ea4d77c3d9",
    fetchedAt: "2026-11-07T00:05:23Z",
    evidence: {
      audience: "Oferta skierowana jest wyłącznie do pełnoletnich użytkowników (18+).",
      recurrence: "Czas trwania Każdego dnia",
      "effects[0].effect.description": "Gotowy kupon z podniesionym kursem o 20% - 30%",
      "eligibility.fundsSource": "Kurs+ można zagrać wyłącznie za środki własne",
      "eligibility.notes":
        "Kurs+ dostępny jest wyłącznie w ofercie przedmeczowej. Obowiązuje ograniczenie stawki (stawka maksymalna). Kurs+ można zagrać tylko na jednym kuponie.",
      "stacking.combinableWith":
        "Oferty Kurs+ nie można łączyć z grą bez podatku. Oferty Kurs+ nie można łączyć z LV Kombi Boost.",
    },
  },
  review: review(),
  version: 1,
};

export const lvbetPromotions: Promotion[] = [
  pakietPowitalny,
  bezPodatkuPoRejestracji,
  startApp20,
  kombiBoost,
  bezpiecznyKupon,
  codziennyCashback,
  kursPlus,
];
