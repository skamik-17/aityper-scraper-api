import type { Promotion } from "../../types/promotions.js";

// Entries come from the research files and the live terms.
// Terms are TOTALbet regulation PDFs (cdn.totalbet.pl). termsHash = sha256 of
// `pdftotext <pdf> -` output, whitespace collapsed.

const review = (): Promotion["review"] => ({
  status: "verified",
  verifiedAt: "2026-11-07T01:20:00+01:00",
  verifiedBy: "research-agent",
});

const ofertaPowitalna: Promotion = {
  id: "totalbet-oferta-powitalna",
  bookmaker: "totalbet",
  name: "OFERTA POWITALNA",
  audience: "new_customer",
  recurrence: { kind: "one_time" },
  validFrom: "2026-07-01T10:00:00+02:00",
  activation: { kind: "coupon_toggle" },
  eligibility: {
    betTypes: ["accumulator"],
    minLegs: 2,
    maxStakePln: 111,
    fundsSource: "own_money_only",
    couponAction: "Oznacz kupon suwakiem promocji na podglądzie kuponu w TOTALbet",
    requiresConfirmation: [],
    notes: [
      "Kupon trzeba postawić w ciągu 48 godzin od rejestracji; musi się rozliczyć w ciągu 7 dni.",
      "Promocją można objąć tylko jeden kupon.",
      "Nie dotyczy kuponów ze zdarzeniem rozliczonym jako zwrot (kurs 1.00), zakładów systemowych, kuponów za freebet ani wypłaconych przez Cashout.",
      "Zwrot trafia na saldo główne w ciągu 24 godzin od pełnej aktywacji konta, najpóźniej 30 dni od rozliczenia kuponu.",
    ],
  },
  effects: [
    {
      effect: {
        type: "REFUND_ON_LOSS",
        percent: 100,
        base: "gross_stake",
        capPln: 111,
        paidAs: { kind: "cash" },
        firstCouponOnly: false,
      },
      // 48 hours from registration, counted conservatively as calendar days 0-1.
      extraEligibility: { accountAgeDays: { to: 2 } },
      valuation: "full",
    },
  ],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: "https://totalbet.pl/pages/oferta-powitalna",
    termsUrl: "https://cdn.totalbet.pl/pages/35e71e66-1748-4188-b6a4-b439ee47326c.pdf",
    termsHash: "7fdf2b4c05b567aa2d75652d656d3243a5894905b90eb7fa1a102338ca2e0ac3",
    fetchedAt: "2026-11-07T00:13:35Z",
    evidence: {
      audience: "111 zł ZAKŁAD BEZ RYZYKA jest ważny 48 godzin od momentu rejestracji konta.",
      recurrence: "Klient może uczestniczyć w 111 zł ZAKŁAD BEZ RYZYKA wyłącznie jeden raz.",
      validFrom: "Promocja obowiązuje od 01.07.2026 r. godz. 10:00 do odwołania jej przez organizatora.",
      "activation.kind":
        "Aby kupon został zakwalifikowany do promocji, należy ręcznie oznaczyć go suwakiem na podglądzie tworzonego kuponu.",
      "eligibility.minLegs": "Zakład AKO zawierający min. 2 wydarzenia",
      "eligibility.maxStakePln": "Maksymalna stawka, aby wziąć udział w promocji wynosi 111 PLN.",
      "eligibility.fundsSource":
        "nie są wliczane zakłady wypłacone przez Klienta przy użyciu usługi Cashout, zakłady systemowe, zakłady zawarte za freebet oraz zakłady rozliczone w części lub całości przez Organizatora jako zwrot, po kursie 1,00.",
      "eligibility.notes[0]": "Kupon musi zostać rozliczony w ciągu 7 dni od momentu postawienia.",
      "eligibility.notes[1]":
        "Promocją 111 zł ZAKŁAD BEZ RYZYKA objęty może zostać objęty wyłącznie 1 zakład danego użytkownika spełniający warunki promocji.",
      "eligibility.notes[3]":
        "Zwrot zostanie przyznany w ciągu 24h po pełnej aktywacji konta przez gracza i nie później niż 30 dni od rozliczenia kuponu.",
      "effects[0].effect.percent":
        "są uprawnieni do otrzymania nagrody w postaci jednorazowego doładowania salda głównego (zwanego dalej: „Saldem”) w wysokości 100% stawki za kupon spełniający warunki promocji.",
      "effects[0].effect.paidAs":
        "są uprawnieni do otrzymania nagrody w postaci jednorazowego doładowania salda głównego (zwanego dalej: „Saldem”) w wysokości 100% stawki za kupon spełniający warunki promocji.",
      "effects[0].effect.capPln": "Maksymalna stawka, aby wziąć udział w promocji wynosi 111 PLN.",
      "effects[0].extraEligibility.accountAgeDays.to":
        "Zakład zostanie zawarty nie później, niż przed upływem 48 godzin od dokonania rejestracji.",
    },
  },
  review: review(),
  version: 1,
};

const graBezPodatku: Promotion = {
  id: "totalbet-gra-bez-podatku",
  bookmaker: "totalbet",
  name: "Gra bez podatku",
  audience: "everyone",
  recurrence: { kind: "always_on" },
  validFrom: "2022-04-12T13:00:00+02:00",
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["accumulator"],
    minLegs: 3,
    odds: { everyLegMin: 1.3 },
    fundsSource: "own_money_only",
    requiresConfirmation: [],
    notes: [
      "Do przewidywanej wygranej TOTALbet dolicza kwotę niwelującą podatek od stawki.",
      "Wygrana z kuponu, na którym choć jedno zdarzenie zostało unieważnione albo zwrócone, nie jest objęta promocją.",
      "Dowolna stawka; nie dotyczy sportów wirtualnych, zakładów systemowych i specjalnych (np. TOTAL HIT).",
      "13,64 % to nasze przeliczenie (12 / 88) – regulamin mówi o kwocie niwelującej podatek.",
    ],
  },
  effects: [
    {
      // 13.64 % of the taxed win restores stake x odds (0.12 / 0.88); the terms give no
      // formula or rounding, so the effect is only displayed until a test coupon proves it.
      effect: { type: "TAX_RELIEF", relief: { kind: "winnings_topup", percentOfWin: 13.64, lostOnAnyVoid: true } },
      valuation: "display_only",
    },
  ],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: "https://totalbet.pl/pages/gra-bez-podatku",
    termsUrl: "https://cdn.totalbet.pl/pages/2d09ff61-3ac4-4e7e-970d-a096101c6051.pdf",
    termsHash: "1cd1a91251ae5d6d7234ed6f2b50cdcb44bf7dd31686f5753ccc07c6c5914716",
    fetchedAt: "2026-11-07T00:13:35Z",
    evidence: {
      audience:
        "GRA BEZ PODATKU przeznaczona jest dla osób, które posiadają Konto tymczasowe lub Konto stałe na stronie www.totalbet.pl",
      recurrence: "Z Promocji uczestnik można skorzystać wiele razy w trakcie trwania Promocji.",
      validFrom: "GRA BEZ PODATKU obowiązuje od 12.04.2022 od godziny 13:00.",
      "eligibility.minLegs":
        "zakład AKO, zawierający minimum trzy zdarzenia oferty przedmeczowej lub live, z minimalnym kursem każdego zdarzenia 1,30;",
      "eligibility.odds.everyLegMin":
        "zakład AKO, zawierający minimum trzy zdarzenia oferty przedmeczowej lub live, z minimalnym kursem każdego zdarzenia 1,30;",
      "eligibility.fundsSource":
        "Promocją będą objęte jedynie wygrane za środki z salda głównego (nie wliczają się wygrane za środki bonusowe oraz freebety).",
      "eligibility.notes[2]":
        "z promocji wyłączone są zakłady na Sporty Wirtualne oraz zakłady systemowe oraz specjalne np. TOTAL HIT.",
      "effects[0].effect.relief.percentOfWin":
        "są uprawnieni do zwiększenia przewidywanej wygranej na kuponie o kwotę niwelującą podatek obrotowy od gier.",
      "effects[0].effect.relief.lostOnAnyVoid":
        "Promocją nie będą objęte wygrane, na których nastąpiło unieważnienie zdarzenia lub zwroty stawek.",
      // TOTAL Bonus is not in the catalog (no live page or terms found).
      "stacking.combinableWith": "Promocja GRA BEZ PODATKU łączy się z promocją TOTAL Bonus.",
    },
  },
  review: review(),
  version: 1,
};

const totalPrzewaga: Promotion = {
  id: "totalbet-totalprzewaga",
  bookmaker: "totalbet",
  name: "TOTALprzewaga",
  audience: "everyone",
  recurrence: { kind: "always_on" },
  validFrom: "2026-03-06T00:00:00+01:00",
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    fundsSource: "any",
    requiresConfirmation: [],
    notes: [
      "Tylko mecze oznaczone przez TOTALbet znacznikiem «TOTALprzewaga» i tylko zakłady przedmeczowe na zwycięzcę meczu.",
      "Zakład na zwycięzcę wygrywa, gdy wskazana drużyna w dowolnym momencie regulaminowego czasu gry prowadzi co najmniej 2 bramkami.",
      "Kurs się nie zmienia.",
      "Nie łączy się z BetBuilderem ani z Cashout.",
    ],
  },
  effects: [
    {
      effect: { type: "EARLY_WIN", rule: "two_goal_lead", markets: ["MATCH_WINNER"] },
      valuation: "display_only",
    },
  ],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: "https://totalbet.pl/pages/totalprzewaga",
    termsUrl: "https://cdn.totalbet.pl/cms_terms/2026-03-06_Komunikat_TOTALprzewaga.pdf",
    termsVersionDate: "2026-03-06",
    termsHash: "59a1a07e256e9ba1da73de96f18ef732962f37a2043202a622e0bd2f634374f5",
    fetchedAt: "2026-11-07T00:13:36Z",
    evidence: {
      // A notice to the general betting rules, so it applies to every account holder.
      audience:
        "Na podstawie obowiązującego regulaminu zakładów wzajemnych urządzanych przez sieć Internet (zwanego dalej „Regulaminem”) ustala się zasady szczegółowe dla zakładu „TOTALprzewaga”.",
      // In force from this date with no end date: a standing rule, not a one-off.
      recurrence: "Oficjalny komunikat obowiązuje od dnia 06.03.2026",
      "eligibility.notes[0]": "Spotkania objęte promocją mają widoczny znacznik „TOTALprzewaga” (dalej „Mecz”).",
      validFrom: "Oficjalny komunikat obowiązuje od dnia 06.03.2026",
      "eligibility.betTypes":
        "Do Oferty kwalifikują się przedmeczowe Zakłady pojedyncze oraz wielokrotne, przy czym zawarty kupon może również zawierać Zakłady na zdarzenia nieobjęte Ofertą.",
      "eligibility.fundsSource":
        "Skorzystanie z Oferty możliwe jest zarówno przy wykorzystaniu przez Użytkownika środków pochodzących z wpłat, jaki i dostępnych dla Użytkownika środków bonusowych (freebet).",
      "eligibility.notes[2]":
        "Zawarcie Zakładu w ramach Oferty nie wpływa na oferowany kurs, a tym samym na wysokość potencjalnej wygranej.",
      "effects[0].effect.rule":
        "Wskazany przez Użytkownika zwycięzca Meczu, w dowolnym momencie regulaminowego czasu gry, łącznie z czasem doliczonym przez sędziego, uzyskał przewagę przynajmniej dwóch (2) bramek.",
      "effects[0].effect.markets": "Oferta dostępna jest na Zakłady zawarte na zdarzenia dotyczące zwycięzcy meczu.",
      "stacking.combinableWith": "Oferta nie łączy się z opcjami BetBulider oraz Cashout.",
    },
  },
  review: review(),
  version: 1,
};

const totalVip: Promotion = {
  id: "totalbet-total-vip",
  bookmaker: "totalbet",
  name: "TOTAL VIP",
  audience: "everyone",
  loyaltyProgram: true,
  recurrence: { kind: "per_period", period: "week" },
  validFrom: "2025-05-26T00:00:00+02:00",
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    fundsSource: "own_money_only",
    requiresConfirmation: [],
    notes: [
      "Punkty za 1 zł obrotu: SOLO 0,5, AKO z 2 zdarzeniami 0,7, z 3 zdarzeniami 0,9, z 4 i więcej 1,2.",
      "Co najmniej 6 000 punktów w tygodniu daje freebet 10 zł.",
      "100 graczy z największym obrotem w tygodniu dostaje cashback liczony od zebranych punktów.",
      "Cashback wynosi od 1% do 2%.",
      "Cashback trafia co tydzień na saldo główne.",
      "Liczą się tylko zakłady z salda głównego, bez zakładów systemowych.",
    ],
  },
  effects: [
    {
      effect: {
        type: "OTHER",
        description: "Program punktowy: cotygodniowy cashback 1–2% dla 100 najaktywniejszych graczy i freebet 10 zł od 6 000 punktów",
      },
      valuation: "display_only",
    },
  ],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: "https://totalbet.pl/pages/totalvip",
    termsUrl: "https://cdn.totalbet.pl/pages/27c6f91b-57a0-437e-9713-9de29a8b989b.pdf",
    termsVersionDate: "2025-05-26",
    termsHash: "c7956ca711fb2fa6f29f517251fea3a4b419843e9de51a8c11e4b30e3df11db5",
    fetchedAt: "2026-11-07T00:13:36Z",
    evidence: {
      audience:
        "Uczestnik – osoba pełnoletnia, mająca pełną zdolność do czynności prawnych, która w okresie trwania Promocji posiada Konto i dokona obrotu środkami pieniężnymi na zakładach bukmacherskich z Salda na Totalbet.pl.",
      recurrence: "Punkty TOTAL VIP naliczają się wg Tygodnia rozliczeniowego.",
      validFrom: "Nowy Regulamin Promocji obowiązuje od 26.05.2025 r. od godz. 00:00.",
      "activation.kind":
        "Warunkiem uczestnictwa w TOTAL VIP jest zawarcie minimum jednego zakładu spełniającego warunki Promocji, co jest równoznaczne z wyrażeniem chęci uczestnictwa w Promocji.",
      "eligibility.fundsSource":
        "Promocją objęte są wszystkie zakłady bukmacherskie (z wyłączeniem zakładów systemowych) organizowane na Totalbet.pl, a zawarte za środki z Salda głównego",
      "eligibility.notes[0]":
        "Zakład pojedynczy (SOLO): 1 zł obrotu = 0,5 Punktu. - Zakład AKO 2 zdarzenia: 1 zł obrotu = 0,7 Punktu. - Zakład AKO 3 zdarzenia: 1 zł obrotu = 0,9 Punktu. - Zakład AKO 4 i więcej zdarzeń: 1 zł obrotu = 1,2 Punktu.",
      "eligibility.notes[1]":
        "Aby wziąć udział w Promocji należy dokonać w ciągu Tygodnia obrotu o wartości minimum 6 000 Punktów. Uczestnicy, którzy spełnili warunek obrotu zdobywając minimalną liczbę punktów w danym Tygodniu, uprawnieni są do odbioru nagrody w postaci freebeta 10 zł.",
      "eligibility.notes[2]":
        "Stu (100) pierwszych Uczestników, którzy dokonali najwyższego obrotu w danym Tygodniu, uzyskuje status VIP GOLD, który uprawnia do odebrania Cashbacku w kwocie równej iloczynowi wartości procentowej Cashback oraz liczby Punktów zebranych w danym Tygodniu",
      "eligibility.notes[3]": "Cashback – procent premii (także „Odpis”) z zakresu 1,0% - 2,0%",
      "eligibility.notes[4]":
        "Cashback wypłacany jest co tydzień (do wtorku do godz. 23:59) w formie doładowania salda głównego, z możliwością dalszej gry lub wypłaty.",
    },
  },
  review: review(),
  version: 1,
};

const betozaur: Promotion = {
  id: "totalbet-betozaur",
  bookmaker: "totalbet",
  name: "Betozaur",
  audience: "everyone",
  recurrence: { kind: "always_on" },
  validFrom: "2026-07-20T00:00:00+02:00",
  activation: { kind: "join_button" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    fundsSource: "any",
    requiresConfirmation: [],
    notes: [
      "Typujesz wynik 8 meczów (1, X, 2) w regulaminowym czasie gry na stronie programu.",
      "Po zapisaniu typów nie można ich zmienić.",
      "8 trafień: udział w podziale puli nagród kolejki; 7 trafień: freebet 25 zł; 6 trafień: freebet 10 zł.",
      "Freebet: jeden zakład z kursem łącznym co najmniej 2.00.",
      "Stawka freebetu jest odejmowana od wygranej.",
      "Nagrodę można odebrać tylko na koncie stałym.",
    ],
  },
  effects: [
    {
      effect: { type: "OTHER", description: "Typer 8 meczów: pula nagród za 8 trafień, freebety za 6 i 7 trafień" },
      valuation: "display_only",
    },
  ],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: "https://totalbet.pl/news/betozaur",
    termsUrl: "https://cdn.totalbet.pl/pages/be0843b2-6d86-403a-a121-081247a61374.pdf",
    termsHash: "e28ba9ddb1145a84b0d91558faa4e3071ac0d4619474bbbf5286832ed1bb61eb",
    fetchedAt: "2026-11-07T00:13:36Z",
    evidence: {
      audience: "Program przeznaczony jest dla osób posiadających konto stałe lub tymczasowe na stronie www.totalbet.pl.",
      recurrence: "Sprzedaż premiowa trwa od 20.07.2026 do odwołania jej przez Organizatora.",
      validFrom: "Sprzedaż premiowa trwa od 20.07.2026 do odwołania jej przez Organizatora.",
      "activation.kind": "Do wzięcia udziału w sprzedaży premiowej uprawnia wskazanie 8 wyników oraz zapisanie swoich typów.",
      "eligibility.notes[0]":
        "Typowanie polega na wskazaniu wyniku spotkania w regulaminowym czasie gry: drużyna 1, remis lub drużyna 2.",
      "eligibility.notes[1]": "Uczestnik sprzedaży premiowej nie ma możliwości korekty swoich typów po zapisaniu ich.",
      "eligibility.notes[2]": "a) 6 poprawnych typów = Freebet 10 PLN, b) 7 poprawnych typów = Freebet 25 PLN,",
      "eligibility.notes[3]": "za jednorazową stawkę z warunkiem minimalnego kursu całkowitego na kuponie 2,00.",
      "eligibility.notes[4]": "Stawka otrzymanego Bonusu FREEBET odejmowana jest od ewentualnej wygranej.",
      "eligibility.notes[5]":
        "Uczestnik, który nie przekształci konta tymczasowego w konto stałe, traci prawo do nagrody",
      "effects[0].effect.description":
        "Każda osoba, która poprawnie wytypuje 8 wyników meczów na stronie: https://totalbet.plus/betozaur/typowanie uprawniona jest do wzięcia udziału w podziale puli nagród.",
    },
  },
  review: review(),
  version: 1,
};

export const totalbetPromotions: Promotion[] = [ofertaPowitalna, graBezPodatku, totalPrzewaga, totalVip, betozaur];
