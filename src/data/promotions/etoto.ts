import type { Eligibility, Promotion } from "../../types/promotions.js";

// Entries come from the research files and the live terms.
// Terms are fetched from the eToto CMS JSON (`api.etoto.pl/rest/cms/pages/{slug}/content`,
// field `data.html`); `termsHash` is the sha256 of that HTML converted to plain text with
// whitespace collapsed. Where the marketing text and the regulamin differ, the regulamin wins.

const VERIFIED_AT = "2026-11-07T00:18:05Z";
const REVIEW: Promotion["review"] = {
  status: "verified",
  verifiedAt: VERIFIED_AT,
  verifiedBy: "research-agent",
};

const cms = (slug: string): string => `https://api.etoto.pl/rest/cms/pages/${slug}/content`;
// Public SPA route of the same CMS page (the promo grid links these paths).
const pub = (slug: string): string => `https://www.etoto.pl/${slug}`;

// Both welcome regulaminy are published together on the welcome landing page.
const WELCOME_TERMS = {
  promoUrl: "https://www.etoto.pl/rejestracja-mocnybonus",
  termsUrl: cms("rejestracja-mocnybonus"),
  publicTermsUrl: pub("rejestracja-mocnybonus"),
  termsHash: "13c9ac50a70d4a090b48b14c6b5f645e0a75974da4e0ba5140d5a4ca53376eb3",
  fetchedAt: "2026-11-07T00:09:02Z",
};
const WELCOME_VALID_FROM_QUOTE = "Akcja trwa od dnia 23.08.2026 r. od godz. 10:00 do odwołania przez Organizatora.";
const NO_COMBINATION_QUOTE = "Akcja nie łączy się z innymi akcjami promocyjnymi, chyba że w regulaminie postanowiono inaczej.";

const MARKETING_CONSENTS: Eligibility["requiresConfirmation"][number] = {
  key: "etoto_marketing_consents",
  label: "Mam włączone zgody marketingowe w eToto",
  expires: "never",
};
const DEPOSIT_LAST_7_DAYS: Eligibility["requiresConfirmation"][number] = {
  key: "etoto_deposit_last_7_days",
  label: "Wpłaciłem pieniądze na konto w eToto w ciągu ostatnich 7 dni",
  expires: "end_of_day",
};

const mocnyBonus: Promotion = {
  id: "etoto-mocny-bonus",
  bookmaker: "etoto",
  name: "Mocny Bonus",
  audience: "new_customer",
  recurrence: { kind: "one_time" },
  validFrom: "2026-08-23T10:00:00+02:00",
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    fundsSource: "any",
    requiresConfirmation: [],
    notes: [
      "Strona eToto podaje kod promocyjny do wpisania przy rejestracji; regulamin promocji kodu nie wymaga.",
      "Do bonusu dochodzi 50 pkt w Misjach eToto.",
    ],
  },
  effects: [
    {
      effect: {
        type: "DEPOSIT_BONUS",
        depositIndex: 1,
        percent: 100,
        capPln: 500,
        minDepositPln: 50,
        paidAs: {
          kind: "bonus_funds",
          wagering: {
            multiplier: 3,
            of: "bonus",
            ownFundsOnly: false,
            odds: { everyLegMin: 1.2, totalMin: 2 },
            minLegs: 3,
            days: 7,
          },
        },
      },
      extraEligibility: {
        accountAgeDays: { to: 30 },
        requiresConfirmation: [
          {
            key: "etoto_no_deposit_yet",
            label: "Nie wpłacałem jeszcze pieniędzy na konto w eToto",
            expires: "never",
          },
        ],
        notes: [
          "Do obrotu liczą się tylko kupony AKO przedmeczowe lub LIVE, rozliczone jako wygrane albo przegrane.",
          "Na obrót masz 7 dni od przyznania bonusu (strona promocji podaje 14 dni, regulamin 7).",
        ],
      },
      valuation: "full",
    },
  ],
  stacking: { combinableWith: [] },
  source: {
    ...WELCOME_TERMS,
    evidence: {
      audience:
        "a) w okresie od 23.08.2026 r. godz. 10:00 dokonała rejestracji w Serwisie, lub b) dokonała rejestracji w Serwisie maksymalnie do 30 dni przed 23.08.2026 r. godz. 10:00 oraz nie skorzystała z innej oferty powitalnej ETOTO",
      recurrence:
        "Bonus w ramach Akcji może zostać przyznany wyłącznie jeden raz w odniesieniu do jednego uczestnika, jednego gospodarstwa domowego, jednego adresu e-mail, jednego adresu IP, jednego urządzenia (komputera lub telefonu), jednej karty płatniczej oraz jednego rachunku płatniczego",
      validFrom: WELCOME_VALID_FROM_QUOTE,
      activation: "Zadaniem Uczestnika jest dokonanie pierwszej wpłaty na konto depozytowe w minimalnej kwocie 50,00 zł.",
      "stacking.combinableWith": NO_COMBINATION_QUOTE,
      "eligibility.notes": "Kod bonusowy ETOTO to: ETOTO500.",
      "effects[0].effect.minDepositPln":
        "Zadaniem Uczestnika jest dokonanie pierwszej wpłaty na konto depozytowe w minimalnej kwocie 50,00 zł.",
      "effects[0].effect.percent":
        "Nagrodę dla Uczestnika za spełnienie warunków Akcji stanowi bonus w wysokości 100% wpłaconej kwoty ograniczony do maksymalnej kwoty wynoszącej 500,00 zł oraz 50 pkt w Misjach E-TOTO.",
      "effects[0].effect.capPln":
        "Nagrodę dla Uczestnika za spełnienie warunków Akcji stanowi bonus w wysokości 100% wpłaconej kwoty ograniczony do maksymalnej kwoty wynoszącej 500,00 zł oraz 50 pkt w Misjach E-TOTO.",
      "effects[0].effect.paidAs.wagering":
        "Uczestnik ma 7 dni od dnia przyznania bonusu na spełnienie warunku obrotu. Warunek ten zostanie spełniony po zawarciu zakładów o łącznej stawce równej trzykrotności wartości przyznanego bonusu.",
      "effects[0].effect.paidAs.wagering.ownFundsOnly":
        "Do wymaganej wartości zakładów wliczają się zarówno zakłady wygrane, jak i przegrane, zawarte z wykorzystaniem środków własnych oraz środków bonusowych.",
      "effects[0].effect.paidAs.wagering.odds":
        "b) stanowią zakład wielokrotny obejmujący co najmniej 3 zdarzenia, o łącznym kursie kuponu nie niższym niż 2,00, przy czym minimalny kurs każdego pojedynczego zdarzenia wynosi 1,20;",
      "effects[0].extraEligibility.accountAgeDays":
        "Uczestnik jest uprawniony do odbioru nagrody w terminie 30 dni od daty rejestracji.",
      "effects[0].extraEligibility.requiresConfirmation":
        "Zadaniem Uczestnika jest dokonanie pierwszej wpłaty na konto depozytowe w minimalnej kwocie 50,00 zł.",
    },
  },
  review: REVIEW,
  version: 1,
};

const graBezPodatku: Promotion = {
  id: "etoto-gra-bez-podatku-60-dni",
  bookmaker: "etoto",
  name: "Gra bez podatku",
  audience: "new_customer",
  recurrence: { kind: "always_on" },
  validFrom: "2026-08-23T10:00:00+02:00",
  activation: { kind: "coupon_toggle" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    odds: { totalMin: 1.85 },
    fundsSource: "own_money_only",
    couponAction: "Zaznacz «Zmień współczynnik» na kuponie",
    requiresConfirmation: [],
    notes: [
      "Nie dotyczy zakładów systemowych, sportów wirtualnych ani gier karcianych.",
      "Kupon rozliczony jako zwrot (kurs 1.0) nie korzysta z promocji.",
      "Strona promocji eToto łączy grę bez podatku z kodem promocyjnym i pierwszą wpłatą; regulamin wymaga tylko rejestracji i nie wymaga kodu.",
    ],
  },
  effects: [
    {
      effect: { type: "TAX_RELIEF", relief: { kind: "stake_factor", factor: 1 } },
      extraEligibility: { accountAgeDays: { to: 60 } },
      valuation: "full",
    },
  ],
  stacking: { combinableWith: [] },
  source: {
    ...WELCOME_TERMS,
    evidence: {
      audience:
        "Udział w Akcji może wziąć wyłącznie osoba pełnoletnia, mająca pełną zdolność do czynności prawnych, która dokonała rejestracji w Serwisie, zwana dalej „Uczestnikiem”.",
      recurrence: "Udział w Akcji jest możliwy w ciągu 60 dni od daty rejestracji w Serwisie.",
      validFrom: WELCOME_VALID_FROM_QUOTE,
      activation:
        "W przypadku spełnienia warunków Akcji oraz zaznaczenia na kuponie funkcji „Zmień współczynnik”, stawka zakładu przyjmowana do rozliczenia nie jest pomniejszana o standardowy współczynnik 0,88 stosowany przy zakładach objętych podatkiem od gier.",
      "eligibility.couponAction":
        "W przypadku spełnienia warunków Akcji oraz zaznaczenia na kuponie funkcji „Zmień współczynnik”, stawka zakładu przyjmowana do rozliczenia nie jest pomniejszana o standardowy współczynnik 0,88 stosowany przy zakładach objętych podatkiem od gier.",
      "eligibility.odds.totalMin": "łączny kurs kuponu AKO lub SOLO wynosi co najmniej 1.85 na moment zawarcia zakładu",
      "eligibility.betTypes": "zawarcie zakładów SOLO lub AKO spełniających łącznie poniższe warunki",
      "eligibility.fundsSource": "c) zakład został zawarty ze środków własnych Uczestnika na koncie depozytowym.",
      "eligibility.notes":
        "Do Akcji nie są wliczane zakłady: a) rozliczone jako zwrot lub anulowane (rozliczone po kursie 1,0); b) systemowe; c) zawarte ze środków bonusowych lub freebet; d) na sporty wirtualne oraz na wyniki gier karcianych.",
      "stacking.combinableWith": NO_COMBINATION_QUOTE,
      "effects[0].effect.relief.factor":
        "Do rozliczenia zakładu stosowany jest współczynnik 1,00, co oznacza, że potencjalna wygrana obliczana jest od pełnej stawki zakładu.",
      "effects[0].extraEligibility.accountAgeDays":
        "Udział w Akcji jest możliwy w ciągu 60 dni od daty rejestracji w Serwisie.",
    },
  },
  review: REVIEW,
  version: 1,
};

const freebetApp: Promotion = {
  id: "etoto-freebet-20-w-apce",
  bookmaker: "etoto",
  name: "Freebet 20 zł w apce",
  audience: "everyone",
  recurrence: { kind: "one_time" },
  validFrom: "2024-11-01T09:30:00+01:00",
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    fundsSource: "own_money_only",
    minStakePln: 10,
    requiresConfirmation: [
      {
        key: "etoto_no_app_bet_yet",
        label: "Nie postawiłem jeszcze żadnego zakładu w aplikacji eToto",
        expires: "never",
      },
    ],
    notes: ["Liczy się tylko pierwszy zakład postawiony w aplikacji eToto, po dowolnym kursie."],
  },
  effects: [
    {
      effect: {
        type: "FREEBET_GRANT",
        amountPln: 20,
        trigger: "Pierwszy zakład w aplikacji eToto za co najmniej 10 zł z salda gotówkowego",
        // The stake deduction is stated; the 0.88 win factor is eToto's standard coefficient,
        // not restated for freebets, hence display_only.
        terms: { winFactor: 0.88, stakeDeduction: 1, validDays: 7 },
      },
      valuation: "display_only",
    },
  ],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: "https://www.etoto.pl/fb-n-20-app-inya",
    termsUrl: cms("fb-n-20-app-inya"),
    publicTermsUrl: pub("fb-n-20-app-inya"),
    termsHash: "b49ff6f052c1a56a43815ddb653aaaa992e8fd80f3f3c8a505393d3748189990",
    fetchedAt: "2026-11-07T00:09:05Z",
    evidence: {
      audience:
        "skierowana jest do graczy, którzy w chwili startu promocji (pkt. 6) nie postawili żadnego zakładu w aplikacji mobilnej ETOTO.",
      "eligibility.requiresConfirmation":
        "Promocja jest dostępna dla os. które jeszcze nigdy nie zagrały w aplikacji.",
      recurrence: "Gracz może skorzystać z oferty raz w ciągu trwania promocji.",
      validFrom: "Promocja jest ważna od 01.11.2024 od godziny 09:30 od odwołania.",
      "eligibility.minStakePln":
        "a. typ zakładu: zakład pojedynczy lub AKO obstawiony na dowolne wydarzenie sportowe, b. stawka zakładu: min. 10 zł obstawione z salda gotówkowego, c. kurs zakładu: dowolny.",
      "eligibility.notes": "Premiowany jest tylko pierwszy zakład postawiony w aplikacji za min. 10 zł",
      "effects[0].effect.amountPln": "Gotowe! Na Twoim koncie pojawi się freebet 20 zł",
      "effects[0].effect.terms.stakeDeduction": "Wygrana pochodząca z freebeta, zostanie pomniejszona o jego wartość.",
      "effects[0].effect.terms.validDays":
        "Freebeta należy użyć w ciągu 7 dni liczonych od chwili dodania freebeta do konta gracza.",
    },
  },
  review: REVIEW,
  version: 1,
};

const boost: Promotion = {
  id: "etoto-boost",
  bookmaker: "etoto",
  name: "BOOST – powiększone kursy",
  audience: "everyone",
  recurrence: { kind: "always_on" },
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    fundsSource: "any",
    requiresConfirmation: [],
    notes: ["Zestaw pięciu zdarzeń z podwyższonymi kursami w osobnej kategorii oferty."],
  },
  effects: [{ effect: { type: "OTHER", description: "Podwyższone kursy na wybrane zdarzenia (BOOST)" }, valuation: "display_only" }],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: "https://www.etoto.pl/boost-powiekszone-kursy",
    termsUrl: cms("boost-powiekszone-kursy"),
    publicTermsUrl: pub("boost-powiekszone-kursy"),
    termsHash: "4398dd846053b2cad32a85a3c491e8e5b5cb898d01091f5380e1f6e6f74b6910",
    fetchedAt: "2026-11-07T00:09:04Z",
    evidence: {
      audience: "Nasze BOOSTY, czyli podwyższone kursy, to zestaw pięć wydarzeń, które charakteryzują się wysokimi kursami.",
      recurrence:
        "Nasze BOOSTY, czyli podwyższone kursy, to zestaw pięć wydarzeń, które charakteryzują się wysokimi kursami.",
    },
  },
  review: REVIEW,
  version: 1,
};

const bonusomat: Promotion = {
  id: "etoto-bonusomat",
  bookmaker: "etoto",
  name: "Bonusomat",
  audience: "existing_customer",
  recurrence: { kind: "per_period", period: "day" },
  validFrom: "2026-10-16T00:00:00+02:00",
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    fundsSource: "any",
    requiresConfirmation: [
      { key: "etoto_verified_account", label: "Mam zweryfikowane konto w eToto", expires: "never" },
      MARKETING_CONSENTS,
      DEPOSIT_LAST_7_DAYS,
    ],
    notes: [
      "Nagroda raz dziennie, zależna od sumy wpłat z ostatnich 30 dni: od freebetu 2 zł (wpłaty 500–999 zł) do freebetu 100 zł (od 50 000 zł); poniżej 500 zł nagrody nie ma.",
      "Bonusomat działa na stronie www.etoto.pl, w zakładce Misje.",
    ],
  },
  effects: [
    {
      effect: {
        type: "OTHER",
        description: "Codzienna nagroda (freebet albo podwojenie wygranej) zależna od sumy wpłat z ostatnich 30 dni",
      },
      valuation: "display_only",
    },
  ],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: "https://www.etoto.pl/bonusomat",
    termsUrl: cms("bonusomat"),
    publicTermsUrl: pub("bonusomat"),
    termsHash: "9ffe9c4b7fa23b5c4bf0c9e6323216a4343ede1a47489543d80d81cabc5cb190",
    fetchedAt: "2026-11-07T00:09:07Z",
    evidence: {
      audience:
        "Udział w Akcji może wziąć wyłącznie osoba pełnoletnia, zamieszkująca na terenie Polski, mająca pełną zdolność do czynności prawnych, która posiada zweryfikowane konto E-TOTO oraz wyraziła zgodę na otrzymywanie treści marketingowych, zwana dalej „Uczestnikiem”.",
      "eligibility.requiresConfirmation":
        "Warunkiem otrzymania nagrody jest dokonanie przez Uczestnika wpłaty na konto depozytowe Uczestnika w ciągu ostatnich 7 pełnych dni.",
      recurrence: "Nagrodę można otrzymać wyłącznie raz dziennie.",
      validFrom: "Akcja trwa od dnia 16.10.2026 r. do odwołania przez Organizatora.",
      "eligibility.notes":
        "Freebet 100 zł 50000 - Freebet 50 zł 20000 49999 Podwojenie wygranej (stawka 15 zł) 5000 19999 Freebet 15 zł 4000 4999 Podwojenie wygranej (stawka 10 zł) 3000 3999 Freebet 10 zł 2500 2999 Podwojenie wygranej (stawka 5 zł) 2000 2499 Freebet 5 zł 1000 1999 Freebet 2 zł 500 999 Brak wygranej 0 499",
      "effects[0].effect.description": "Pod uwagę brany będzie okres ostatnich 30 dni.",
    },
  },
  review: REVIEW,
  version: 1,
};

const quiz: Promotion = {
  id: "etoto-quiz-codzienny",
  bookmaker: "etoto",
  name: "Quiz codzienny",
  audience: "existing_customer",
  recurrence: { kind: "per_period", period: "day" },
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    fundsSource: "any",
    requiresConfirmation: [MARKETING_CONSENTS, DEPOSIT_LAST_7_DAYS],
    notes: ["Trzy pytania dziennie w zakładce Misje; freebet 5 zł dostają gracze z najlepszym wynikiem dnia."],
  },
  effects: [{ effect: { type: "OTHER", description: "Codzienny quiz sportowy z freebetem 5 zł dla najlepszych" }, valuation: "display_only" }],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: "https://www.etoto.pl/quiz-codzienny",
    termsUrl: cms("quiz-codzienny"),
    publicTermsUrl: pub("quiz-codzienny"),
    termsHash: "241f624ef853e606b3f9d469c4b7b17e2f1809d31a85905372090f3cdc4620d6",
    fetchedAt: "2026-11-07T00:09:06Z",
    evidence: {
      audience:
        "Quiz jest dostępny dla osób, które wyraziły zgody marketingowe oraz dokonały co najmniej jednej wpłaty w ciągu ostatnich 7 dni.",
      "eligibility.requiresConfirmation":
        "Quiz jest dostępny dla osób, które wyraziły zgody marketingowe oraz dokonały co najmniej jednej wpłaty w ciągu ostatnich 7 dni.",
      recurrence: "Każdego dnia czeka na Ciebie nowy quiz dotyczący wybranego wydarzenia sportowego.",
      "eligibility.notes": "Freebet 5 zł otrzymają gracze, którzy zdobędą najwięcej punktów w danym dniu.",
    },
  },
  review: REVIEW,
  version: 1,
};

const typer: Promotion = {
  id: "etoto-typer",
  bookmaker: "etoto",
  name: "Typer ETOTO",
  audience: "everyone",
  recurrence: { kind: "per_period", period: "week" },
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    fundsSource: "any",
    requiresConfirmation: [],
    notes: ["Typujesz wyniki wybranych meczów; najlepsi w rankingu tygodniowym dostają freebety i bonusy."],
  },
  effects: [{ effect: { type: "OTHER", description: "Cotygodniowy konkurs typerski z rankingiem" }, valuation: "display_only" }],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: "https://www.etoto.pl/typer",
    termsUrl: cms("typer"),
    publicTermsUrl: pub("typer"),
    termsHash: "d837bf51f12106be8d042a21093a157133ae7a2f62c51d17871ce8b9626de6b7",
    fetchedAt: "2026-11-07T00:09:09Z",
    evidence: {
      audience: "Zaloguj się lub załóż konto w ETOTO.",
      recurrence: "Każdy tydzień to nowe typy = nowe szanse.",
      "eligibility.notes": "Najlepsi gracze zdobywają freebety i bonusy",
    },
  },
  review: REVIEW,
  version: 1,
};

const misje: Promotion = {
  id: "etoto-misje",
  bookmaker: "etoto",
  name: "Misje ETOTO",
  audience: "everyone",
  loyaltyProgram: true,
  recurrence: { kind: "always_on" },
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    fundsSource: "any",
    requiresConfirmation: [],
    notes: ["Punkty za codzienne misje, poziomy, ranking i sklep, w którym punkty wymieniasz na bonusy i freebety."],
  },
  effects: [{ effect: { type: "OTHER", description: "Program misji z punktami, poziomami i sklepem z nagrodami" }, valuation: "display_only" }],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: "https://www.etoto.pl/misje",
    termsUrl: cms("misje"),
    publicTermsUrl: pub("misje"),
    termsHash: "3c84fdc2c473665c77f301c92dfbaaf1f74325530cb21debf3abe804f9aefbac",
    fetchedAt: "2026-11-07T00:09:08Z",
    evidence: {
      audience: "Codziennie nowe misje – loguj się, graj, zdobywaj punkty.",
      recurrence: "Codziennie nowe misje – loguj się, graj, zdobywaj punkty.",
      "eligibility.notes":
        "Punkty podnoszą Twój poziom i możesz je wymieniać w sklepie na bonusy, freebety i inne nagrody.",
    },
  },
  review: REVIEW,
  version: 1,
};

export const etotoPromotions: Promotion[] = [
  mocnyBonus,
  graBezPodatku,
  freebetApp,
  boost,
  bonusomat,
  quiz,
  typer,
  misje,
];
