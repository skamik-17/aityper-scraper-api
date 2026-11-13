import type { FreebetTerms, Promotion } from "../../types/promotions.js";

// Entries come from the research files and the live terms.
//
// Sources (fetched 2026-11-07):
// - Promo pages are server-rendered HTML (BetConstruct SpringBuilder) with the detailed terms
//   inline ("Regulamin Promocji" / "Warunki szczegółowe"). termsHash = sha256 of the whole page
//   text after stripping script/style/tags and collapsing whitespace.
// - The /bonusy-bukmacherskie grid keeps every tile in the markup with display:none and turns
//   tiles on by hard-coded windows in an inline script. Live on 2026-11-07: Bonus na start,
//   Wingo, basketball 20+10, Early Payout, Zwrot Podatku, Boost dnia, Kupon dnia, Kursowy Boost.
//   The permanent tiles all end "2026-12-31T23:59:59" in that script, while the terms say
//   "do odwołania", so no validTo is set.
// - Freebet formula (all promotions): general terms annex of 20.02.2026,
//   https://media2.betcris.pl/regulaminy/REGULAMIN_OG%C3%93LNY_AKCJI_PROMOCYJNYCH.pdf
//   "Kwota wygranej = [kurs całkowity × 0,88 × wartość Freebetu] – (wartość Freebetu × 0,88)".
// - Skipped: basketball 20+10 (basketball only), Wingo (free-to-play rounds), Boost dnia and
//   Kupon dnia (daily, one informational boost entry is kept: Kursowy Boost), Profit Boost
//   (personal tokens), Early Payout (a separate market, not a promotion), VIP (invite only).

const VERIFIED = {
  status: "verified",
  verifiedAt: "2026-11-07T00:19:23Z",
  verifiedBy: "research-agent",
} as const;

const GENERAL_FREEBET_QUOTE =
  "Kwota wygranej = [kurs całkowity × 0,88 × wartość Freebetu] – (wartość Freebetu × 0,88)";

/** Betcris freebet: profit only, 12 % taken off the freebet stake (general terms annex 20.02.2026). */
function betcrisFreebet(over: Partial<FreebetTerms> = {}): FreebetTerms {
  return { winFactor: 0.88, stakeDeduction: 0.88, ...over };
}

const BETCRIS_MARKETING_CONSENTS = {
  key: "betcris_marketing_consents",
  label: "Mam włączone zgody marketingowe w Betcris",
  expires: "never",
} as const;

const BETCRIS_VERIFIED_ACCOUNT = {
  key: "betcris_verified_account",
  label: "Mam w pełni zweryfikowane konto stałe w Betcris",
  expires: "never",
} as const;

export const betcrisPromotions: Promotion[] = [
  {
    id: "betcris-bonus-na-start",
    bookmaker: "betcris",
    name: "Bonus 3x110% do 110 zł na start",
    audience: "new_customer",
    recurrence: { kind: "one_time" },
    validFrom: "2024-10-16T12:00:00+02:00",
    activation: { kind: "registration_code", code: "BC330" },
    eligibility: {
      betTypes: ["accumulator"],
      minLegs: 3,
      odds: { everyLegMin: 1.3 },
      minStakePln: 10,
      fundsSource: "any",
      accountAgeDays: { to: 30 },
      requiresConfirmation: [BETCRIS_MARKETING_CONSENTS, BETCRIS_VERIFIED_ACCOUNT],
      notes: [
        "Trzy etapy: po każdej z trzech pierwszych wpłat (co najmniej 10 zł), w stałej kolejności. Każda wpłata uruchamia jeden etap, w którym liczy się jeden kwalifikujący kupon AKO postawiony po tej wpłacie.",
        "Kupon etapu: AKO z co najmniej 3 zdarzeniami, każde po kursie 1.30 lub wyższym, stawka od 10 zł brutto. Łącznie najwyżej 3 freebety po 110 zł (330 zł).",
        "Freebet dostajesz tylko wtedy, gdy kupon etapu przegra: 110% stawki brutto, od 11 do 110 zł. Wygrany kupon zamyka ten etap bez freebeta.",
        "Zwrot albo cashout kuponu etapu odbiera ten etap. Sporty wirtualne i gry karciane się nie liczą.",
        "Freebet: AKO z co najmniej 3 zdarzeniami po kursie 1.30 lub wyższym, ważny 7 dni, wygrana do 2000 zł.",
      ],
    },
    effects: [
      {
        // One stage; the three stages (one per deposit) are described in notes so nothing
        // counts the refund three times on one coupon.
        effect: {
          type: "REFUND_ON_LOSS",
          percent: 110,
          base: "gross_stake",
          capPln: 110,
          paidAs: {
            kind: "freebet",
            terms: betcrisFreebet({ odds: { everyLegMin: 1.3 }, minLegs: 3, validDays: 7, maxWinPln: 2000 }),
          },
          firstCouponOnly: false,
        },
        valuation: "full",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://www.betcris.pl/bonusy-bukmacherskie/betcris-kod-promocyjny",
      termsUrl: "https://www.betcris.pl/bonusy-bukmacherskie/bonus-na-start",
      termsHash: "fc71f00f00bf8173b60b6be66bc56ed87237b003152e7db2239b2eb2b220dd20",
      fetchedAt: "2026-11-07T00:08:05Z",
      evidence: {
        audience:
          "założyli konto uczestnika zakładów wzajemnych zarejestrowane na stronie internetowej Organizatora www.betcris.pl w trakcie trwania Promocji oraz wyrazili zgody marketingowe",
        validFrom: "Promocja trwa od 16.10.2024 r. godz. 12:00 do momentu jej zakończenia przez Organizatora.",
        recurrence:
          "Każdy Uczestnik, który zarejestruje swoje konto w czasie trwania Promocji może z niej skorzystać tylko raz.",
        // From the code page https://www.betcris.pl/bonusy-bukmacherskie/betcris-kod-promocyjny.
        "activation.code": "wpisz kod bonusowy BC330 – podczas rejestracji w polu „kod promocyjny” wpisz podany przez nas kod",
        "eligibility.accountAgeDays.to":
          "Uczestnik ma 30 dni od momentu rejestracji na przystąpienie do Promocji i spełnienie warunków opisanych w poniższym Regulaminie.",
        "eligibility.requiresConfirmation[0]":
          "oraz wyrazili zgody marketingowe, w tym na udział w akcjach marketingowych organizowanych przez Organizatora",
        "eligibility.requiresConfirmation[1]":
          "W Promocji mogą wziąć udział wyłącznie Uczestnicy, którzy posiadają w pełni zweryfikowane konto STAŁE w serwisie www.betcris.pl.",
        "eligibility.minStakePln":
          "Zakład kwalifikujący do Promocji to zakład o stawce minimalnej 10 zł (stawka brutto), zawierający minimum 3 zdarzenia, z kursem każdego zdarzenia na kuponie minimum 1.3.",
        "effects[0].effect.percent":
          "Po dokonaniu pierwszego depozytu na kwotę minimum 10 zł, Uczestnik uzyskuje możliwość otrzymania darmowego zakładu (freebetu) o wartości 110% stawki brutto (liczonej według wzoru: stawka netto zakładu x przelicznik (1,25)) zakładu kwalifikującego, do kwoty 110 zł.",
        "effects[0].effect.capPln": "Minimalna kwota bonusu wynosi 11 zł, maksymalna 110 zł.",
        "eligibility.notes[1]":
          "W ramach Promocji Uczestnik może otrzymać maksymalnie 330 zł w formie darmowych zakładów (freebetów).",
        "effects[0].effect.firstCouponOnly":
          "Zawrze 3 zakłady zgodne z warunkami Promocji, każdy zakład po kolejnej wpłacie.",
        "effects[0].effect.paidAs.terms.minLegs":
          "Freebet należy wykorzystać na zawarcie zakładu AKO (z oferty przedmeczowej lub live), zawierającego minimum 3 zdarzenia, z kursem każdego zdarzenia na kuponie minimum 1.3.",
        "effects[0].effect.paidAs.terms.maxWinPln": "Maksymalna wygrana z freebetu uzyskanego w Promocji to 2000 zł.",
        "effects[0].effect.paidAs.terms.validDays": "Freebet należy wykorzystać w ciągu 7 dni od momentu jego przyznania.",
        // From the general promotion terms PDF (annex of 20.02.2026).
        "effects[0].effect.paidAs.terms.winFactor": GENERAL_FREEBET_QUOTE,
        "eligibility.notes[0]":
          "Aby otrzymać wszystkie 3 bonusy w Promocji Uczestnik musi dokonać 3 depozytów oraz 3 zakładów kwalifikujących. Jeden depozyt i jeden zakład mogą aktywować tylko jeden bonus.",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "betcris-totalny-zwrot-podatku",
    bookmaker: "betcris",
    name: "Totalny Zwrot Podatku",
    audience: "everyone",
    recurrence: { kind: "always_on" },
    validFrom: "2022-10-07T12:00:00+02:00",
    activation: { kind: "automatic" },
    eligibility: {
      betTypes: ["accumulator"],
      minLegs: 3,
      odds: { everyLegMin: 1.5 },
      minStakePln: 10,
      fundsSource: "own_money_only",
      requiresConfirmation: [
        {
          key: "betcris_deposit_made",
          label: "Wpłaciłem w Betcris co najmniej jeden depozyt",
          expires: "never",
        },
        BETCRIS_VERIFIED_ACCOUNT,
      ],
      notes: [
        "Zwrot dotyczy tylko wygranych kuponów. Stawki netto wygranych kuponów z jednego dnia sumują się w jeden freebet: od 1 do 50 zł, jeden dziennie, dopisany do 15:00 następnego dnia.",
        "Zakłady systemowe, «łańcuch» i rozliczone przez Cash Out się nie liczą. Wszystkie zdarzenia kuponu muszą być rozliczone.",
        "Freebet: AKO z co najmniej 3 zdarzeniami po kursie 1.30 lub wyższym, bez sportów wirtualnych i gier karcianych, ważny 3 dni, wygrana do 1000 zł.",
      ],
    },
    effects: [
      {
        effect: {
          type: "TAX_RELIEF",
          relief: {
            kind: "freebet_refund",
            percentOfNetStake: 13.64,
            capPerDayPln: 50,
            terms: betcrisFreebet({ odds: { everyLegMin: 1.3 }, minLegs: 3, validDays: 3, maxWinPln: 1000 }),
          },
        },
        valuation: "full",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://www.betcris.pl/bonusy-bukmacherskie/totalny-zwrot-podatku",
      termsUrl: "https://www.betcris.pl/bonusy-bukmacherskie/totalny-zwrot-podatku",
      termsHash: "6c420e337ed796a5bc1eefeec6ee28609a3387f543506d74ad83fb8707debab2",
      fetchedAt: "2026-11-07T00:08:09Z",
      evidence: {
        audience:
          "Warunkiem wzięcia udziału w Promocji, która przeznaczona jest wyłącznie dla Klientów Betcris, jest dokonanie:",
        validFrom: "Promocja „TOTALNY ZWROT PODATKU 2” obowiązuje od dnia 07.10.2022 od godziny 12:00 do odwołania.",
        recurrence: "Kwota podatku sumuje się przez cały dzień, a maksymalny Freebet to 50 PLN!",
        "eligibility.odds.everyLegMin":
          "postawili zakład AKO (z oferty przedmeczowej lub live) z salda głównego (depozytowego) składający się z co najmniej 3 zdarzeń o stawce minimalnej 10 PLN z minimalnym kursem każdego zdarzenia równym 1.50 oraz ten zakład został rozliczony jako wygrany.",
        "eligibility.requiresConfirmation[0]": "Promocja jest przeznaczona dla graczy, którzy dokonali min. 1 depozytu.",
        "eligibility.requiresConfirmation[1]": "prawidłowej rejestracji pełnej i otwarcia Konta STAŁEGO na stronie www.betcris.pl.",
        "eligibility.notes":
          "Zakłady systemowe, zakłady „łańcuch” oraz zakłady rozliczone za pomocą funkcji Cash Out nie biorą udziału w Promocji.",
        "effects[0].effect.relief.percentOfNetStake":
          "Wartość Freebeta jest obliczana według wzoru: suma stawek netto*13,64%.",
        "effects[0].effect.relief.capPerDayPln":
          "Minimalna wartość freebetu, którą może otrzymać Uczestnik Promocji to 1.00 PLN, a maksymalna to 50 PLN. Każdy Uczestnik może otrzymać tylko jeden freebet dziennie.",
        "effects[0].effect.relief.terms.minLegs":
          "Freebet należy wykorzystać na zawarcie zakładu AKO (z oferty przedmeczowej lub live z wyłączeniem sportów wirtualnych i gier karcianych) zawierającego min. 3 zdarzenia, z kursem każdego pojedynczego zdarzenia wynoszącym minimum 1.3.",
        "effects[0].effect.relief.terms.validDays":
          "Freebet musi zostać wykorzystany najpóźniej w terminie 3 dni od jego przyznania.",
        "effects[0].effect.relief.terms.maxWinPln": "Maksymalna kwota wygranej postawionej za freebet wynosi 1000 PLN.",
        // From the general promotion terms PDF (annex of 20.02.2026).
        "effects[0].effect.relief.terms.winFactor": GENERAL_FREEBET_QUOTE,
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "betcris-kursowy-boost",
    bookmaker: "betcris",
    name: "Kursowy Boost",
    audience: "everyone",
    recurrence: { kind: "always_on" },
    validFrom: "2021-08-23T00:00:00+02:00",
    activation: { kind: "automatic" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      fundsSource: "any",
      requiresConfirmation: [],
      notes: [
        "Codziennie podwyższone kursy na wybrane zdarzenia przedmeczowe, oznaczone ikoną «Boost». Można je łączyć z całą ofertą.",
        "Wygrana trafia na saldo główne, bez obrotu.",
      ],
    },
    effects: [
      {
        effect: {
          type: "OTHER",
          description: "Podwyższone kursy na wybrane zdarzenia przedmeczowe, zmieniane codziennie",
        },
        valuation: "display_only",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://www.betcris.pl/bonusy-bukmacherskie/kursowy-boost",
      termsUrl: "https://www.betcris.pl/bonusy-bukmacherskie/kursowy-boost",
      termsHash: "cfe1e98dbe1432e591aa9a0150e2d776a60dca72f65750a33474be645439f14b",
      fetchedAt: "2026-11-07T00:08:11Z",
      evidence: {
        audience: "Promocja przeznaczona jest wyłącznie dla Klientów Betcris.",
        validFrom: "Promocja Kursowy boost obowiązuje od 23.08.2021 roku aż do odwołania.",
        "effects[0].effect.description":
          "Kursowy boost polega na podniesieniu kursu na wybrane zdarzenia w porównaniu do standardowej oferty Betcris.",
        "eligibility.notes": "Promocja Kursowy boost obowiązuje jedynie na wydarzenia z oferty przedmeczowej.",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "betcris-program-lojalnosciowy",
    bookmaker: "betcris",
    name: "Program Lojalnościowy",
    audience: "everyone",
    loyaltyProgram: true,
    recurrence: { kind: "always_on" },
    validFrom: "2023-12-05T00:00:00+01:00",
    activation: { kind: "automatic" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      fundsSource: "own_money_only",
      requiresConfirmation: [BETCRIS_MARKETING_CONSENTS],
      notes: [
        "Punkty = stawka netto × mnożnik poziomu (brązowy 1, srebrny 1,25, złoty 1,5, platynowy 2), za każdy zakład sportowy bez względu na kurs i wynik. Cashout odejmuje punkty, freebety ich nie dają.",
        "Sklep: freebet 5 zł za 1300 pkt, 10 zł za 2500, 20 zł za 5000, 50 zł za 10 000, 100 zł za 18 000, 200 zł za 35 000.",
        "Freebety ze sklepu: co najmniej 3 zdarzenia po kursie 1.30 lub wyższym, ważne 3 dni, wygrana do 200 zł (freebety 5–20 zł) albo 2000 zł (50–200 zł).",
      ],
    },
    effects: [
      {
        effect: {
          type: "OTHER",
          description: "Program lojalnościowy: punkty za zakłady, wymiana na freebety w sklepie",
        },
        valuation: "display_only",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://www.betcris.pl/regulaminy",
      termsUrl: "https://media2.betcris.pl/regulaminy/Program_Lojalnosciowy-Regulamin_Programu.pdf",
      termsVersionDate: "2024-03-01",
      termsHash: "0668e4f81466bd61d153bf1f3d5b4212eaf67066eca860be800f33f8d8c924a9",
      fetchedAt: "2026-11-07T00:08:12Z",
      evidence: {
        "source.termsVersionDate": "Program Lojalnościowy – Regulamin Programu (aktualizacja z 01.03.2024)",
        audience:
          "posiadają aktywne konto uczestnika zakładów wzajemnych zarejestrowane na stronie internetowej Organizatora www.betcris.pl oraz wyraziły zgody marketingowe",
        validFrom: "Program trwa od 05.12.2023 do momentu jego zakończenia przez Organizatora.",
        "eligibility.fundsSource":
          "Punkty przyznawane są wyłącznie za zakłady postawione za prawdziwe środki. Zakłady postawione za freebet nie generują punktów dla Uczestnika.",
        "effects[0].effect.description":
          "Punkty na poszczególnych poziomach są naliczane wg wzoru: stawka netto x przelicznik.",
        "eligibility.notes":
          "W Sklepie gracza dostępne są Freebety o następujących wartościach i w następujących cenach: a. 5 PLN (1300 punktów) b. 10 PLN (2500 punktów) c. 20 PLN (5000 punktów) d. 50 PLN (10 000 punktów) e. 100 PLN (18 000 punktów) f. 200 PLN (35 000 punktów).",
      },
    },
    review: VERIFIED,
    version: 1,
  },
];
