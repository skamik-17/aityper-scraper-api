import type { FreebetTerms, Promotion } from "../../types/promotions.js";

// Entries come from the research files and the live terms.
//
// Sources (fetched 2026-11-07):
// - Landing pages with inline regulamins on promocje.pzbuk.pl (WordPress, server-rendered).
//   termsHash = sha256 of the whole page text after stripping script/style/tags and collapsing
//   whitespace. None of the pages carries the "Promocja zakończona!" banner.
// - Live cards: https://www.pzbuk.pl/rest/promotions/items (Oferta powitalna, 50% Wzmacniacz,
//   Sklep Gracza, E-sportowy poniedziałek, BetBuilder, Mistrz Typowania).
// - Skipped: E-Poniedziałki (esports freebet, offered by SMS/e-mail only), Mistrz Typowania
//   (free-to-play rounds), MEGA KURS (no longer on the promotions cards), BetBuilder (product),
//   Klub VIP (invite only).
// - Freebets: the terms say winnings are "wyłącznie kwotę ponad stawkę" but do not say whether
//   the 12 % tax is taken off the freebet stake. winFactor 0.88 / stakeDeduction 1 is the
//   conservative reading; the effects stay display_only until a test coupon settles it.

const VERIFIED = {
  status: "verified",
  verifiedAt: "2026-11-07T00:19:23Z",
  verifiedBy: "research-agent",
} as const;

function pzbukFreebet(over: Partial<FreebetTerms> = {}): FreebetTerms {
  return { winFactor: 0.88, stakeDeduction: 1, ...over };
}

export const pzbukPromotions: Promotion[] = [
  {
    id: "pzbuk-oferta-na-start",
    bookmaker: "pzbuk",
    name: "300 PLN na start + 50 PLN freebet",
    audience: "new_customer",
    recurrence: { kind: "one_time" },
    validFrom: "2026-06-09T11:00:00+02:00",
    activation: { kind: "automatic" },
    eligibility: {
      betTypes: ["accumulator"],
      odds: { totalMin: 2.0 },
      fundsSource: "own_money_only",
      requiresConfirmation: [
        {
          key: "pzbuk_phone_verified",
          label: "Mam zweryfikowany numer telefonu w PZBuk",
          expires: "never",
        },
      ],
      notes: [
        "Wpłata od 5 do 300 zł, potem pierwszy kupon kombo po kursie łącznym 2.00 lub wyższym. Freebet równy stawce tego kuponu (do 300 zł), bez względu na wynik.",
        "Dodatkowy freebet 50 zł za wpłatę co najmniej 100 zł, dopisany po rozliczeniu pierwszego kuponu.",
        "Freebety: kupon kombinacyjny po kursie łącznym 2.00 lub wyższym, bez BetBuildera, ważne 30 dni, jedna stawka (niewykorzystana reszta przepada). Wygrana to kwota ponad stawkę, bez obrotu.",
        "Nie łączy się z ofertami powitalnymi «Freebet 50 PLN», «Freebet 100 PLN» ani innymi wcześniejszymi ofertami powitalnymi. Zakłady wirtualne i Gry TV się nie liczą.",
      ],
    },
    effects: [
      {
        effect: {
          type: "FREEBET_GRANT",
          amountPln: 300,
          trigger: "Pierwszy kupon kombo po wpłacie 5–300 zł; freebet równy stawce kuponu, najwyżej 300 zł",
          terms: pzbukFreebet({ odds: { totalMin: 2.0 }, minLegs: 2, validDays: 30 }),
        },
        // amountPln is the cap: the freebet equals the stake of the first qualifying coupon.
        valuation: "display_only",
      },
      {
        effect: {
          type: "FREEBET_GRANT",
          amountPln: 50,
          trigger: "Wpłata co najmniej 100 zł i rozliczenie pierwszego kuponu",
          terms: pzbukFreebet({ odds: { totalMin: 2.0 }, minLegs: 2, validDays: 30 }),
        },
        // Freebet tax treatment not stated in the terms.
        valuation: "display_only",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://www.pzbuk.pl/pl/bonus",
      termsUrl: "https://promocje.pzbuk.pl/oferta-na-start/",
      termsHash: "ce9b582221a1d7704f128d3a589e3472ea5ddf155fb625c2de8b913bd1176e5a",
      fetchedAt: "2026-11-07T00:09:45Z",
      evidence: {
        audience:
          "Oferta jest dostępna wyłącznie dla nowo zarejestrowanych Graczy pzbuk.pl i obowiązuje od dnia 09.06.2026 od godziny 11:00 do odwołania.",
        validFrom:
          "Oferta jest dostępna wyłącznie dla nowo zarejestrowanych Graczy pzbuk.pl i obowiązuje od dnia 09.06.2026 od godziny 11:00 do odwołania.",
        recurrence: "Promocja jest jednorazowa.",
        "eligibility.requiresConfirmation":
          "Gracz bierze udział w promocji po prawidłowym zweryfikowaniu numeru telefonu i spełnieniu warunków oferty wyszczególnionych poniżej.",
        "eligibility.odds.totalMin":
          "Aby skorzystać z oferty, Gracz musi dokonać wpłaty (pomiędzy 5 a 300 PLN), a następnie postawić zakład kombo z kursem łącznym minimum 2.0 .",
        "eligibility.fundsSource":
          "W promocji nie biorą udziału kupony postawione na zakłady wirtualne, zdarzenia wirtualne, Gry TV oraz kupony obstawione przy użyciu darmowych zakładów otrzymanych w ramach innych promocji.",
        "stacking.combinableWith":
          "Promocja wyklucza się z ofertą powitalną „Freebet 50 PLN”, „Freebet 100 PLN” oraz innymi uprzednio dostępnymi ofertami powitalnymi.",
        "effects[0].effect.amountPln":
          "W ramach promocji Gracz może otrzymać darmowy zakład do 300 PLN, zwany dalej freebetem, oraz dodatkowy 50 PLN freebet.",
        "effects[0].effect.trigger": "Gracz otrzyma freebet o wartości swojego pierwszego postawionego zakładu",
        "effects[0].effect.terms.odds.totalMin":
          "Gracz może wykorzystać otrzymany Freebet na kupon kombinacyjny z kursem łącznym min. 2.0, z wyłączeniem opcji BetBuilder.",
        "effects[0].effect.terms.validDays":
          "Od momentu aktywowania oferty promocyjnej, czyli przyznania darmowego zakładu Freebet, Gracz ma 30 dni na jego wykorzystanie.",
        "effects[0].effect.terms.stakeDeduction":
          "Wygrane z darmowego zakładu Freebet obejmują wyłącznie kwotę ponad stawkę postawionego zakładu i nie są objęte wymogiem obrotu przed wypłatą.",
        "effects[1].effect.amountPln":
          "Dodatkowo, za wpłatę minimum 100 PLN – gracz otrzymuje dodatkowy freebet 50 PLN, który również zostanie dopisany po rozliczeniu pierwszego zakładu.",
        "effects[1].effect.terms": "Bonusowy Freebet za wpłatę minimum 100 PLN posiada te same warunki.",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "pzbuk-wzmacniacz-ekstraklasa",
    bookmaker: "pzbuk",
    name: "Wzmacniacz zakładów",
    audience: "everyone",
    recurrence: { kind: "per_period", period: "week" },
    validFrom: "2024-09-13T09:00:00+02:00",
    activation: { kind: "join_button" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      odds: { totalMin: 1.5 },
      maxStakePln: 25,
      fundsSource: "own_money_only",
      leagues: ["ekstraklasa"],
      requiresConfirmation: [],
      couponAction: "Wybierz «50% Wzmacniacz» z menu «Dostępne bonusy» na kuponie",
      notes: [
        "Na stronie PZBuk promocja występuje jako «50% Wzmacniacz» na Ekstraklasę.",
        "Jeden wzmacniacz na tydzień, odnawiany w piątek o 9:00, ważny 7 dni. Zapis «Zapisz się» wystarczy zrobić raz.",
        "Kupon tylko ze zdarzeniami z Ekstraklasy, kurs łączny 1.50 lub wyższy, stawka do 25 zł.",
        "Regulamin mówi o 50% «podstawowej wygranej» i nie precyzuje, czy chodzi o całą wypłatę, czy o zysk.",
        "Dodatek trafia na konto razem z wygraną, bez obrotu.",
      ],
    },
    effects: [
      {
        effect: {
          type: "ACCA_BONUS",
          base: "total_odds",
          tiers: [{ minLegs: 1, percent: 50 }],
          paidAs: { kind: "cash" },
        },
        // "50% podstawowej wygranej": payout vs. profit is not stated, so the base is a guess.
        valuation: "display_only",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://promocje.pzbuk.pl/50-na-ekstraklase/",
      termsUrl: "https://promocje.pzbuk.pl/50-na-ekstraklase/",
      termsHash: "3a831f232b0b2bae974d876bf04102cba9ab99be90ba17585d5232021497f85d",
      fetchedAt: "2026-11-07T00:09:48Z",
      evidence: {
        audience:
          "Aby skorzystać z oferty, Gracz musi zalogować się na konto, jednorazowo ZAPISAĆ SIĘ DO PROMOCJI i aktywować bonus z rozwijanego menu „Dostępne bonusy” podczas tworzenia kuponu spełniającego wymogi promocji.",
        activation:
          "Aby skorzystać z oferty, Gracz musi zalogować się na konto, jednorazowo ZAPISAĆ SIĘ DO PROMOCJI i aktywować bonus z rozwijanego menu „Dostępne bonusy” podczas tworzenia kuponu spełniającego wymogi promocji.",
        validFrom: "obowiązuje dnia 13.09.2024 od godz. 9:00 do odwołania promocji.",
        recurrence:
          "W czasie trwania promocji gracz może odebrać jeden 50% WZMACNIACZ na Ekstraklasę tygodniowo. Promocja odnawia się w każdy piątek o godzinie 9:00 CET. Gracz ma 7 dni na wykorzystanie WZMACNIACZA.",
        "eligibility.odds.totalMin":
          "Całkowity kurs łączny kuponu musi wynosić minimalnie 1.5 i zawierać zdarzenia z dyscypliny piłka nożna , > liga: EKSTRAKLASA .",
        "eligibility.leagues": "Promocja jest dostępna tylko na zakłady dotyczące Ekstrakasy.",
        "eligibility.maxStakePln": "Maksymalna stawka na kuponie może wynosić 25 PLN.",
        "eligibility.fundsSource":
          "Zakład postawiony przy pomocy “darmowego zakładu” przyznanego w ramach dowolnej promocji nie jest objęty promocją „Wzmacniacz zakładów”.",
        "effects[0].effect.tiers[0].percent": "Dodatkowe wygrane stanowią 50% podstawowej wygranej z zakładu.",
        "effects[0].effect.paidAs":
          "Dodatkowe wygrane z promocji „Wzmacniacz zakładów” dodawane są do konta gracza niezwłocznie po rozliczeniu zakładu łącznie z kwotą wygranej, bez dodatkowych warunków obrotu przed wypłatą.",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "pzbuk-sklep-gracza",
    bookmaker: "pzbuk",
    name: "Sklep Gracza",
    audience: "everyone",
    loyaltyProgram: true,
    recurrence: { kind: "always_on" },
    activation: { kind: "automatic" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      fundsSource: "any",
      requiresConfirmation: [],
      notes: [
        "Punkty: 10 za każde postawione 5 zł (bez względu na kurs i liczbę zdarzeń), 1 za każdą wpłaconą złotówkę, 20 za pierwsze logowanie w danym dniu, 500 za rejestrację z weryfikacją, 500 za każdy zatwierdzony dokument, 100 za pierwszą wypłatę.",
        "Punkty wymieniasz w zakładce «Sklep» na bonusy, freebety i gadżety. Ceny nagród podaje sklep.",
        "Punkty przepadają po 9 miesiącach bez logowania.",
      ],
    },
    effects: [
      {
        effect: {
          type: "OTHER",
          description: "Program lojalnościowy: punkty za zakłady, wpłaty i logowanie, wymiana na bonusy i freebety",
        },
        valuation: "display_only",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://promocje.pzbuk.pl/sklep-gracza/",
      termsUrl: "https://promocje.pzbuk.pl/sklep-gracza/",
      termsHash: "56be61aab98556095b750ee11e388c9330a60f705cc3760ba3a010df165152f0",
      fetchedAt: "2026-11-07T00:09:51Z",
      evidence: {
        audience:
          "Gracz – użytkownik zarejestrowany w serwisie www.pzbuk.pl , korzystający z programu lojalnościowego",
        "effects[0].effect.description":
          "Zakłady na żywo i przedmeczowe, także w zakładce Wirtualne TV: 10 punktów za każde wydane 5 PLN.",
        "eligibility.notes":
          "W przypadku, kiedy Gracz nie zaloguje się na konto przez okres 9 miesięcy punkty zostaną odjęte z konta Gracza.",
      },
    },
    review: VERIFIED,
    version: 1,
  },
];
