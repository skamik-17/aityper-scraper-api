import type { Promotion } from "../../types/promotions.js";

// Entries come from the research files and the live terms.
// Terms fetched 2026-11-07; quotes are verbatim from the normalized text of each document.

const VERIFIED = {
  status: "verified",
  verifiedAt: "2026-11-07T01:30:21+01:00",
  verifiedBy: "research-agent",
} as const;

const ACCA_SHARE_LABEL =
  "Mam poniżej 1 000 zł stawek od dołączenia do promocji albo co najmniej 50% moich stawek to kwalifikujące się AKO";

export const betclicPromotions: Promotion[] = [
  {
    id: "betclic-bez-podatku-2",
    bookmaker: "betclic",
    name: "Bez Podatku 2.0",
    audience: "everyone",
    recurrence: { kind: "always_on" },
    validFrom: "2026-05-21T00:00:00+02:00",
    activation: { kind: "automatic" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      fundsSource: "any",
      requiresConfirmation: [],
      notes: [
        "Nie dotyczy zakładów systemowych, sportów wirtualnych ani gier karcianych.",
        "Udział AKO liczony jest z ostatnich 5000 zakładów, a po 12 miesiącach tylko z zakładów z ostatnich 12 miesięcy; aktualny stan pokazuje licznik w Betclic.",
        "Podatek 10% od wygranej powyżej 2280 zł nadal obowiązuje.",
      ],
    },
    effects: [
      {
        // Qualifying AKO: always factor 1.0.
        effect: { type: "TAX_RELIEF", relief: { kind: "stake_factor", factor: 1 } },
        extraEligibility: { betTypes: ["accumulator"], minLegs: 2, odds: { everyLegMin: 1.2 } },
        valuation: "full",
      },
      {
        // Any bet: 0.94 is guaranteed even after the 1 000 zł limit with an AKO share below 50%.
        effect: { type: "TAX_RELIEF", relief: { kind: "stake_factor", factor: 0.94 } },
        valuation: "full",
      },
      {
        // Any bet: 1.0 while under the 1 000 zł limit or with an AKO share of at least 50%.
        effect: { type: "TAX_RELIEF", relief: { kind: "stake_factor", factor: 1 } },
        extraEligibility: {
          requiresConfirmation: [{ key: "betclic_acca_share_50", label: ACCA_SHARE_LABEL, expires: "end_of_week" }],
        },
        valuation: "full",
      },
    ],
    stacking: { combinableWith: ["betclic-multiboost"] },
    source: {
      promoUrl: "https://www.betclic.pl/scp-bezpodatku",
      termsUrl: "https://www.betclic.pl/scp-bezpodatku",
      termsVersionDate: "2026-05-21",
      termsHash: "3fb09ec0f78f71c7ee9870a6c82515bffe36ec29de7cc82c9c314d99d755c4cd",
      fetchedAt: "2026-11-07T01:03:09+01:00",
      evidence: {
        audience:
          "W Akcji Specjalnej udział mogą wziąć wyłącznie Użytkownicy posiadając aktywne Konto zarejestrowane zgodnie z Regulaminem.",
        activation: "Nie są potrzebne żadne dodatkowe działania, wystarczy posiadać konto w Betclic.",
        recurrence: "Promocja obowiązuje codziennie, całą dobę, do odwołania.",
        validFrom: "Akcja Specjalna trwa od dnia 21.05.2026 r. do odwołania.",
        "eligibility.fundsSource": "wlicza się zakłady zawarte przy wykorzystaniu freebetów (środków bonusowych)",
        "eligibility.notes[0]":
          "nie wlicza się zakładów systemowych, zawartych na sporty wirtualne oraz na symulowane gry w karty",
        "eligibility.notes[1]":
          "Udział, o którym mowa w ust. 5, oblicza się z uwzględnieniem ostatnich 5000 (pięć tysięcy) Zakładów zawartych przez Użytkownika od dnia przystąpienia do Oferty",
        "eligibility.notes[2]": "Nadal obowiązuje 10% podatek od ewentualnej wygranej powyżej 2280 zł.",
        "effects[0].effect.relief.factor":
          "dla kwalifikujących się Zakładów wielokrotnych tak, jak w przypadku, gdyby Użytkownik zawarł Zakład ze Wskaźnikiem 1.0.",
        "effects[0].extraEligibility.minLegs":
          "za kwalifikujący się Zakład wielokrotny uznaje się wyłącznie Zakład składający się z co najmniej dwóch zdarzeń objętych Ofertą, o kursie równym lub wyższym 1.20 każdy",
        "effects[0].extraEligibility.odds.everyLegMin":
          "Wszystkie kupony, które mają minimum 2 selekcje oraz minimalny kurs każdej z nich wynoszący 1,20.",
        "effects[1].effect.relief.factor":
          "dla Zakładów pojedynczych oraz Zakładów wielokrotnych, które nie spełniają warunków określonych w ust. 9 oraz wskazanych w ust. 10, tak, jak w przypadku, gdyby Użytkownik zawarł Zakład ze Wskaźnikiem 0.94 (6%)",
        "effects[2].effect.relief.factor":
          "Jeżeli udział, o którym mowa w ust. 5, wynosi co najmniej 50%, wszystkie zawarte przez Użytkownika Zakłady pojedyncze oraz wielokrotne kwalifikują się do Oferty",
        "effects[2].extraEligibility.requiresConfirmation[0]":
          "Do momentu, w którym łączna suma stawek Zakładów zawartych przez Użytkownika od chwili rozpoczęcia Akcji Specjalnej osiągnie kwotę 1,000 PLN (tysiąc złotych), zawarte przez Użytkownika Zakłady będą automatycznie kwalifikowały się do Oferty.",
        "stacking.combinableWith":
          "W połączeniu z wysokimi kursami i jeszcze lepszą promocją Multiboost Twoje wygrane mogą być największe na polskim rynku.",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "betclic-oferta-powitalna-wyzwania",
    bookmaker: "betclic",
    name: "Oferta Powitalna – Wyzwania",
    audience: "new_customer",
    recurrence: { kind: "one_time" },
    validFrom: "2026-08-20T00:00:00+02:00",
    activation: { kind: "automatic" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      fundsSource: "own_money_only",
      accountAgeDays: { to: 14 },
      requiresConfirmation: [],
      notes: [
        "Cztery Wyzwania aktywują się po kolei; warunki i kwotę każdego Betclic pokazuje w aplikacji po rejestracji.",
        "Liczy się kurs bazowy, bez podwyższenia z Multiboost.",
        "Zakład w całości rozliczony przez Cashout nie zalicza Wyzwania.",
      ],
    },
    effects: [
      {
        effect: {
          type: "FREEBET_GRANT",
          amountPln: 100,
          trigger: "Cztery kolejne Wyzwania wykonane w ciągu 14 dni od rejestracji (łącznie do 100 zł)",
          terms: { winFactor: 1, stakeDeduction: 1, odds: { totalMin: 2.14 } },
        },
        // The terms delegate amounts and per-challenge conditions to the app; only the 100 zł total is public.
        valuation: "display_only",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://www.betclic.pl/scp-nastart",
      termsUrl:
        "https://dam.begmedia.com/rox/images/Global/COMMON/TnC/PL/Regulamin_Oferty_Powitalnej_Wyzwania_zmiany_102026.pdf",
      termsHash: "9c63332e58e46eeba13b499bca8ef929cc280b4a06e91345eac43aecd2bcef79",
      fetchedAt: "2026-11-07T01:03:44+01:00",
      evidence: {
        audience:
          "Oferta skierowana jest wyłącznie do nowych Użytkowników, którzy zarejestrowali Konto zgodnie z Regulaminem Zakładów w czasie obowiązywania Oferty.",
        activation: "Wariant oferty powitalnej jest przypisywany automatycznie w momencie rejestracji Konta.",
        recurrence:
          "Oferta może zostać wykorzystana tylko raz w odniesieniu do jednej osoby, jednego gospodarstwa domowego, jednego adresu IP, jednego urządzenia oraz jednej metody płatności.",
        validFrom: "Oferta obowiązuje od dnia 20.08.2026 r. do dnia jej wycofania przez Betclic.",
        "eligibility.accountAgeDays.to":
          "Okres na wykonanie Wyzwań wynosi 14 dni od momentu przypisania Oferty Użytkownikowi, co następuje w momencie rejestracji Konta",
        "eligibility.fundsSource":
          "Stawka kwalifikującego się Zakładu musi zostać w całości opłacona ze środków pieniężnych Użytkownika.",
        "eligibility.notes[0]":
          "Warunki mające zastosowanie do każdego Wyzwania, w tym wymogi dotyczące kwalifikującego się Zakładu oraz wartość odpowiadającego mu Freebetu, są określone w informacji o danym Wyzwaniu udostępnionej Użytkownikowi na Platformie.",
        "eligibility.notes[1]":
          "uwzględnia się wyłącznie kurs bazowy Zakładu, bez uwzględniania podwyższenia kursu wynikającego z zastosowania takich funkcji jak MultiBoost lub podobnych funkcjonalności",
        "eligibility.notes[2]": "Zakłady w całości rozliczone z wykorzystaniem funkcji Cashout nie kwalifikują się do Wyzwań.",
        // From the promo page (scp-nastart): the regulamin itself does not state the amounts.
        "effects[0].effect.amountPln": "Zgarnij do 100 zł we Freebetach na start.",
        // From the Bez Podatku 2.0 page (scp-bezpodatku): Betclic freebet coupon minimum odds.
        "effects[0].effect.terms.odds.totalMin":
          "Pamiętaj, że min. kurs dla kuponów postawionych przy użyciu Freebetów niezmiennie wynosi 2,14.",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "betclic-multiboost",
    bookmaker: "betclic",
    name: "Multiboost",
    audience: "everyone",
    recurrence: { kind: "always_on" },
    validFrom: "2025-07-07T00:00:00+02:00",
    activation: { kind: "automatic" },
    eligibility: {
      betTypes: ["accumulator"],
      minLegs: 5,
      fundsSource: "own_money_only",
      requiresConfirmation: [],
      notes: [
        "Przy 2–4 zdarzeniach bonus działa tylko, gdy co najmniej jedno zdarzenie jest na żywo (2 – 2%, 3 – 3%, 4 – 4%).",
        "Dotyczy tylko zdarzeń oznaczonych przez Betclic jako objęte promocją; tego oznaczenia nie widzimy.",
        "Betclic podaje procent wzrostu kursu jako przybliżony i podnosi kurs każdej kwalifikującej się selekcji, więc kwoty nie wyliczamy.",
        "Nie dotyczy kuponów rozliczonych przez Cash-out.",
      ],
    },
    effects: [
      {
        effect: {
          type: "ACCA_BONUS",
          base: "total_odds",
          tiers: [
            { minLegs: 5, percent: 5 },
            { minLegs: 6, percent: 6 },
            { minLegs: 7, percent: 10 },
            { minLegs: 8, percent: 15 },
            { minLegs: 9, percent: 20 },
            { minLegs: 10, percent: 30 },
            { minLegs: 11, percent: 40 },
            { minLegs: 12, percent: 50 },
            { minLegs: 13, percent: 60 },
            { minLegs: 14, percent: 70 },
            { minLegs: 15, percent: 80 },
            { minLegs: 16, percent: 90 },
            { minLegs: 17, percent: 100 },
          ],
          qualifyingLegMinOdds: 1.2,
          capPln: 200000,
          paidAs: { kind: "cash" },
        },
        // "Przybliżona % wartość wzrostu kursu", applied per selection: the exact formula is not stated.
        valuation: "display_only",
      },
    ],
    stacking: { combinableWith: ["betclic-bez-podatku-2"] },
    source: {
      promoUrl: "https://www.betclic.pl/scp-wygrywajwiecej",
      termsUrl: "https://www.betclic.pl/scp-wygrywajwiecej",
      termsVersionDate: "2025-07-07",
      termsHash: "7b0224971c71787a8f5b5e68abf0c3dc39e49063bf710c22b6e45bc50907c987",
      fetchedAt: "2026-11-07T01:03:10+01:00",
      evidence: {
        audience: "Promocja kierowana jest do Użytkowników, którzy zarejestrowali Konto zgodnie z Regulaminem.",
        activation: "Kurs każdej kwalifikującej się selekcji na kuponie zostanie podwyższony automatycznie.",
        recurrence: "Promocja obowiązuje do odwołania.",
        validFrom: "Regulamin wchodzi w życie dnia 07.07.2025 r.",
        "eligibility.minLegs": "Multiboost dostępny jest już od 5 selekcji na kuponie, lub 2 (jeśli minimum jedna jest Live).",
        "eligibility.fundsSource":
          "Do Promocji nie wliczają się zakłady zawarte przy wykorzystaniu Freebetów oraz rozliczone przy wykorzystaniu opcji Cash-out.",
        "eligibility.notes[0]":
          "W przypadku dwóch, trzech oraz czterech zakładów składowych wymaga się, aby przynajmniej jeden z nich był zakładem na żywo.",
        "eligibility.notes[1]":
          "Multiboost jest rodzajem bonusu, który dodawany jest do kursów w zakładach wielokrotnych składających się z minimum dwóch zakładów składowych o minimalnym kursie 1.20 każdy zawartych na wybrane zdarzenia oznaczone jako biorące udział w Promocji.",
        "effects[0].effect.tiers":
          "Liczba zdarzeń na kuponie AKO Przybliżona % wartość wzrostu kursu 2 2% 3 3% 4 4% 5 5% 6 6% 7 10% 8 15% 9 20% 10 30% 11 40% 12 50% 13 60% 14 70% 15 80% 16 90% 17 100% 18+ 100%",
        "effects[0].effect.qualifyingLegMinOdds": "UWAGA: Minimalny kurs każdej selekcji w Multiboost to tylko 1,20!",
        "effects[0].effect.capPln":
          "Wygraną w zakładzie wielokrotnym objętym Promocją, w części stanowiącej iloczyn wartości, o którą powiększony został kurs oraz stawki, ustala się na nie więcej niż 200 000 (dwieście tysięcy) złotych.",
        "stacking.combinableWith": "Ważne: Multiboost łączy się z grą bez podatku i zakładami Bezpieczny wynik.",
      },
    },
    review: VERIFIED,
    version: 1,
  },
];
