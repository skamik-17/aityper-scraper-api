import type {
  Eligibility,
  Promotion,
  PromotionEffectEntry,
  Wagering,
  Weekday,
} from "../../types/promotions.js";

// Entries come from the research files and the live terms.
// Terms are fetched from the forBET CMS JSON (`/rest/cms/pages/{slug}/content`, field
// `data.html`); `termsHash` is the sha256 of that HTML converted to plain text with
// whitespace collapsed. `promoUrl` is the page a person opens.

const VERIFIED_AT = "2026-11-07T00:18:05Z";
const REVIEW: Promotion["review"] = {
  status: "verified",
  verifiedAt: VERIFIED_AT,
  verifiedBy: "research-agent",
};

const ALL_DAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WORKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri"];

const cms = (slug: string): string => `https://www.iforbet.pl/rest/cms/pages/${slug}/content`;
// Public page of the same CMS slug (the promo grid links `https://www.iforbet.pl/<slug>`).
const pub = (slug: string): string => `https://www.iforbet.pl/${slug}`;

const BONUS_BOX_GROUP = "forbet-bonus-box";
const FORBET3000_ID = "forbet-kod-forbet3000";
const BONUS_BOX_PROMO_URL = "https://www.iforbet.pl/pakiet-powitalny";

const BONUS_BOX_NOTE =
  "Pakiet wybierasz w oknie Bonus Box po pierwszym zalogowaniu; wyboru nie można później zmienić.";
const BONUS_BOX_COMBINABLE_QUOTE =
  "Pozostałe pakiety w ramach Bonus Box również zawierają dodatkowy bonus 150 PLN, pod warunkiem rejestracji konta z kodem FORBET3000 i wpłaceniem pierwszego depozytu min. 100 PLN.";

const FULL_REGISTRATION_CONFIRMATION: Eligibility["requiresConfirmation"][number] = {
  key: "forbet_full_registration",
  label: "Mam w forBET konto po pełnej rejestracji",
  expires: "never",
};

// Lost-stake refund paid as bonus funds, rolled over once (Bonus Box packages).
const ZBR_WAGERING: Wagering = {
  multiplier: 1,
  of: "bonus",
  ownFundsOnly: false,
  odds: { everyLegMin: 1.3 },
  minLegs: 3,
  days: 14,
};

// Second-deposit bonus rollover (Szefa, Nocny, VIP, Rekruta).
const DEPOSIT_BONUS_WAGERING: Wagering = {
  multiplier: 2,
  of: "bonus",
  ownFundsOnly: false,
  odds: { everyLegMin: 1.3, totalMin: 2.5 },
  minLegs: 3,
  days: 14,
};

const TAX_FREE_EXCLUSIONS_NOTE =
  "Nie dotyczy kuponów systemowych, zakładów długoterminowych i specjalnych (w tym TurboKurs i Combo Expert) ani gier karcianych.";
const TAX_FREE_START_NOTE = "Okres gry bez podatku liczy się od wyboru pakietu.";
const TAX_FREE_ACTIVATION_NOTE =
  "forBET może włączyć grę bez podatku do 24 godzin roboczych po rejestracji; sprawdź, czy współczynnik na kuponie wynosi 1.0.";

function zbr(
  capPln: number,
  stake: { min: number; max: number },
  firstCouponOnly: boolean,
  notes: string[],
  valuation: PromotionEffectEntry["valuation"],
  extra: Partial<Eligibility> = {},
): PromotionEffectEntry {
  return {
    effect: {
      type: "REFUND_ON_LOSS",
      percent: 100,
      base: "gross_stake",
      capPln,
      paidAs: { kind: "bonus_funds", wagering: ZBR_WAGERING },
      firstCouponOnly,
    },
    extraEligibility: { minStakePln: stake.min, maxStakePln: stake.max, notes, ...extra },
    valuation,
  };
}

function secondDepositBonus(
  percent: number,
  capPln: number,
  minDepositPln: number,
  lockNote: string,
): PromotionEffectEntry {
  return {
    effect: {
      type: "DEPOSIT_BONUS",
      depositIndex: 2,
      percent,
      capPln,
      minDepositPln,
      paidAs: { kind: "bonus_funds", wagering: DEPOSIT_BONUS_WAGERING },
    },
    extraEligibility: { notes: [lockNote] },
    // The bonus is locked until the deposit itself is turned over; the Wagering type
    // cannot hold this two-step rollover.
    valuation: "display_only",
  };
}

const DEPOSIT_LOCK_NOTE =
  "Bonus jest zablokowany, dopóki nie obrócisz raz kwotą wpłaty po kursie całkowitym min. 2.00; dopiero potem obracasz bonusem 2 razy.";

// Tax-free welcome period: 3-5 legs, each leg >= 1.30 (Szefa, Rekruta, Spryciarza, Wirtualny).
function taxFree3to5(days: number, notes: string[]): PromotionEffectEntry {
  return {
    effect: { type: "TAX_RELIEF", relief: { kind: "stake_factor", factor: 1 } },
    extraEligibility: {
      betTypes: ["accumulator"],
      minLegs: 3,
      maxLegs: 5,
      odds: { everyLegMin: 1.3 },
      fundsSource: "own_money_only",
      accountAgeDays: { to: days },
      notes: [...notes, TAX_FREE_ACTIVATION_NOTE],
    },
    valuation: "full",
  };
}

interface PackageSpec {
  slug: string;
  packageName: string;
  termsHash: string;
  fetchedAt: string;
  effects: PromotionEffectEntry[];
  notes?: string[];
  validFromQuote?: string;
  recurrenceQuote?: string;
  evidence: Record<string, string>;
}

function bonusBoxPackage(spec: PackageSpec): Promotion {
  return {
    id: `forbet-bonus-box-${spec.slug}`,
    bookmaker: "forbet",
    name: `Bonus Box: ${spec.packageName}`,
    audience: "new_customer",
    recurrence: { kind: "one_time" },
    validFrom: "2025-05-29T12:00:00+02:00",
    activation: { kind: "automatic" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      fundsSource: "any",
      requiresChosenWelcome: true,
      requiresConfirmation: [],
      notes: [BONUS_BOX_NOTE, ...(spec.notes ?? [])],
    },
    effects: spec.effects,
    stacking: { exclusiveGroup: BONUS_BOX_GROUP, combinableWith: [FORBET3000_ID] },
    source: {
      promoUrl: BONUS_BOX_PROMO_URL,
      termsUrl: cms(`regulamin-pakiet-${spec.slug}`),
      // Package regulaminy are shown only inside the Bonus Box popup, not as pages.
      publicTermsUrl: BONUS_BOX_PROMO_URL,
      termsHash: spec.termsHash,
      fetchedAt: spec.fetchedAt,
      evidence: {
        audience:
          "Udział w promocji Oferta Powitalna Bonus Box można wziąć poprzez rejestrację eKonta w okresie trwania promocji oraz wybór jednego z pakietów powitalnych.",
        recurrence:
          spec.recurrenceQuote ??
          "Wybór pakietu jest nieodwracalny i powoduje utratę możliwości wyboru innych pakietów w ramach Oferty Powitalnej Bonus Box.",
        validFrom: spec.validFromQuote ?? "Promocja obowiązuje od 29.05.2025 od godziny 12:00 do odwołania.",
        activation:
          "Po wyborze i zatwierdzeniu pakietu, zostanie on aktywowany automatycznie i przydzielony zgodnie z poniższymi warunkami.",
        "eligibility.requiresChosenWelcome": `${spec.packageName} jest jednym z pakietów dostępnych w ramach Oferty Powitalnej Bonus Box.`,
        "stacking.exclusiveGroup":
          "Wybór pakietu jest nieodwracalny i powoduje utratę możliwości wyboru innych pakietów w ramach Oferty Powitalnej Bonus Box.",
        "stacking.combinableWith": BONUS_BOX_COMBINABLE_QUOTE,
        ...spec.evidence,
      },
    },
    review: REVIEW,
    version: 1,
  };
}

// Evidence shared by the ZBR of Szefa / Nocny (first bet, 20-1 000 PLN).
const ZBR_1000_EVIDENCE = (i: number): Record<string, string> => ({
  [`effects[${i}].effect.capPln`]: "Maksymalna kwota zakładu, od której przysługuje promocja to 1 000 PLN.",
  [`effects[${i}].extraEligibility.minStakePln`]:
    "Minimalna kwota zakładu, od której przysługuje promocja to 20 PLN.",
  [`effects[${i}].effect.percent`]:
    "Zwrot stawki w postaci bonusu zostanie przyznany automatycznie.",
  [`effects[${i}].effect.paidAs.wagering.days`]:
    "Bonus oczekuje w kolejce przez 14 dni. Czas na obrót bonusem wynosi 14 dni.",
});

const DEPOSIT_WAGERING_QUOTE =
  "Przyznanym bonusem należy dokonać dwukrotnego obrotu, zawierając kupony spełniające następujące warunki: - kurs ogólny kuponu min. 2.5 - min. 3 zdarzenia na kuponie – wszystkie zdarzenia z kursem 1.30 lub wyższym";

const szefa = bonusBoxPackage({
  slug: "szefa",
  packageName: "Pakiet Szefa",
  termsHash: "20a23076fd2895b71ccc580f45571af3f83632f79e5df178067c9f84a71fc7ae",
  fetchedAt: "2026-11-07T00:04:28Z",
  recurrenceQuote: "Gracz, może skorzystać z niniejszej promocji tylko i wyłącznie jeden raz.",
  effects: [
    zbr(1000, { min: 20, max: 1000 }, true, ["TurboKurs, gry karciane i inne zakłady specjalne nie są objęte zwrotem."], "full"),
    secondDepositBonus(100, 2000, 20, DEPOSIT_LOCK_NOTE),
    taxFree3to5(30, [TAX_FREE_START_NOTE, TAX_FREE_EXCLUSIONS_NOTE]),
  ],
  evidence: {
    "effects[0].effect.firstCouponOnly":
      "Regulamin promocji „Zakład bez ryzyka do 1000 PLN” Gracze, którzy zawrą pierwszy zakład po zarejestrowaniu konta, będą mogli skorzystać z promocji zakład bez ryzyka.",
    ...ZBR_1000_EVIDENCE(0),
    "effects[0].effect.paidAs.wagering":
      "Przyznanym bonusem należy w całości dokonać jednokrotnego obrotu, zawierając kupon spełniający następujące warunki: - min. 3 zdarzenia na kuponie – wszystkie zdarzenia z kursem 1.30 lub wyższym.",
    "effects[1].effect.percent":
      "Gracze, którzy wpłacą drugi depozyt po zarejestrowaniu konta, otrzymają 100% bonusu od depozytu do maksymalnie 2 000 PLN.",
    "effects[1].effect.capPln":
      "Maksymalna kwota bonusu to 2 000 PLN, czyli za depozyt powyżej 2 000 PLN gracz otrzyma 2 000 PLN bonusu.",
    "effects[1].effect.minDepositPln": "Minimalna kwota depozytu to 20 PLN.",
    "effects[1].effect.paidAs.wagering": DEPOSIT_WAGERING_QUOTE,
    "effects[1].effect.paidAs.wagering.days": "Czas na obrót bonusem to 14 dni od jego aktywacji",
    "effects[1].extraEligibility.notes":
      "Aby odblokować bonus, należy dokonać jednokrotnego obrotu depozytem po całkowitym kursie minimalnym 2.0 dowolną liczbą kuponów równą deponowanej kwocie.",
    "effects[2].effect.relief.factor":
      "Współczynnik kuponu zmieni się automatycznie na 1.0 jeżeli kupon zostanie zagrany zgodnie z powyższymi pkt. regulaminu promocji „30 dni gry Bez Podatku”.",
    "effects[2].extraEligibility.minLegs": "Na kuponie muszą znajdować się min. 3 zdarzenia.",
    "effects[2].extraEligibility.maxLegs": "Maksymala liczba zdarzeń na kuponie to 5.",
    "effects[2].extraEligibility.odds.everyLegMin": "Minmalny kurs każdego zdarzenia - 1.30.",
    "effects[2].extraEligibility.fundsSource":
      "Do promocji nie zaliczają się kupony zagrane za środki bonusowe oraz kupony systemowe.",
    "effects[2].extraEligibility.accountAgeDays":
      "Okres 30 dni gry Bez Podatku zostanie graczowi włączony automatycznie po wyborze danego pakietu.",
  },
});

const nocny = bonusBoxPackage({
  slug: "nocny",
  packageName: "Pakiet Nocny",
  termsHash: "7516f0e70575d264225538ad9a1456c85dea333271faf5828be9f0c4e47f97f5",
  fetchedAt: "2026-11-07T00:04:29Z",
  recurrenceQuote:
    "Oferta promocyjna ważna jest tylko i wyłącznie dla jednego klienta, konta gracza, gospodarstwa domowego, adresu IP.",
  effects: [
    // US sports only: none of our leagues qualifies.
    zbr(
      1000,
      { min: 20, max: 1000 },
      true,
      ["Zwrot dotyczy tylko pierwszego zakładu na NBA, WNBA, NFL, NHL lub MLS; tych rozgrywek nie porównujemy."],
      "display_only",
      { leagues: [] },
    ),
    secondDepositBonus(150, 750, 20, DEPOSIT_LOCK_NOTE),
    {
      effect: { type: "TAX_RELIEF", relief: { kind: "stake_factor", factor: 1 } },
      extraEligibility: {
        maxLegs: 5,
        fundsSource: "own_money_only",
        accountAgeDays: { to: 20 },
        placementWindows: [
          { days: ALL_DAYS, from: "00:00", to: "06:00" },
        ],
        notes: [TAX_FREE_START_NOTE, TAX_FREE_EXCLUSIONS_NOTE, TAX_FREE_ACTIVATION_NOTE],
      },
      valuation: "full",
    },
  ],
  evidence: {
    "effects[0].effect.firstCouponOnly":
      "Regulamin promocji „Zakład bez ryzyka do 1 000 PLN” Gracze, którzy zawrą pierwszy zakład po zarejestrowaniu konta, będą mogli skorzystać z promocji zakład bez ryzyka.",
    "effects[0].extraEligibility.leagues":
      "Aby skorzystać z promocji pierwszy zakład musi być zawarty na zdarzenia z zakresu oferty na amerykańskie sporty: NBA, WNBA, NFL, NHL, MLS.",
    ...ZBR_1000_EVIDENCE(0),
    "effects[0].effect.paidAs.wagering":
      "Przyznanym bonusem należy w całości dokonać jednokrotnego obrotu, zawierając kupon spełniający następujące warunki: min. 3 zdarzenia na kuponie – wszystkie zdarzenia z kursem 1.30 lub wyższym.",
    "effects[1].effect.percent":
      "Gracze, którzy wpłacą drugi depozyt po zarejestrowaniu konta otrzymają 150% bonusu od depozytu do maksymalnie 750 PLN.",
    "effects[1].effect.capPln":
      "Maksymalna kwota bonusu to 750 PLN, czyli za depozyt powyżej 500 PLN gracz otrzyma 750 PLN bonusu.",
    "effects[1].effect.minDepositPln": "Minimalna kwota depozytu to 20 PLN.",
    "effects[1].effect.paidAs.wagering": DEPOSIT_WAGERING_QUOTE,
    "effects[1].effect.paidAs.wagering.days": "Czas na obrót bonusem to 14 dni od jego aktywacji",
    "effects[1].extraEligibility.notes":
      "Aby odblokować bonus należy dokonać jednokrotnego obrotu depozytem po całkowitym kursie minimalnym 2.0 dowolną liczbą kuponów równą deponowanej kwocie.",
    "effects[2].effect.relief.factor":
      "Współczynnik kuponu zmieni się automatycznie na 1.0 jeżeli kupon zostanie zagrany zgodnie z powyższymi pkt. regulaminu promocji „20 dni gry Bez Podatku”.",
    "effects[2].extraEligibility.placementWindows":
      "Promocja będzie dostępna w godzinach 00:00 – 06:00 w okresie 20 dni.",
    "effects[2].extraEligibility.maxLegs": "Maksymalna liczba zdarzeń na kuponie to 5.",
    "effects[2].extraEligibility.fundsSource":
      "Do promocji nie zaliczają się kupony zagrane za środki bonusowe oraz kupony systemowe.",
    "effects[2].extraEligibility.accountAgeDays":
      "Okres 20 dni gry bez podatku na wszystko zostanie graczowi włączony automatycznie po wyborze danego pakietu.",
  },
});

const SECOND_BET_NOTE = "Dotyczy tylko drugiego zakładu po założeniu konta, postawionego ze środków z salda głównego.";
const THIRD_BET_NOTE = "Dotyczy tylko trzeciego zakładu po założeniu konta, postawionego ze środków z salda głównego.";

const bezpieczny = bonusBoxPackage({
  slug: "bezpieczny",
  packageName: "Pakiet Bezpieczny",
  termsHash: "39660fdac903d89634e47063d123cec04ab12dd90f36619774a5b2b3792f2759",
  fetchedAt: "2026-11-07T00:04:30Z",
  recurrenceQuote:
    "Oferta promocyjna ważna jest tylko i wyłącznie dla jednego klienta, konta gracza, gospodarstwa domowego, adresu IP.",
  effects: [
    zbr(1500, { min: 20, max: 1500 }, true, ["TurboKurs, gry karciane i inne zakłady specjalne nie są objęte zwrotem."], "full"),
    // Second and third bet only: the bet number is not representable in Eligibility.
    zbr(1000, { min: 20, max: 1000 }, false, [SECOND_BET_NOTE], "display_only", { fundsSource: "own_money_only" }),
    zbr(500, { min: 20, max: 500 }, false, [THIRD_BET_NOTE], "display_only", { fundsSource: "own_money_only" }),
  ],
  evidence: {
    "effects[0].effect.firstCouponOnly":
      "Regulamin promocji „Zakład bez ryzyka do 1500 PLN” Gracze, którzy zawrą pierwszy zakład po zarejestrowaniu konta, będą mogli skorzystać z promocji zakład bez ryzyka.",
    "effects[0].effect.capPln": "Maksymalna kwota zakładu, od której przysługuje promocja to 1 500 PLN.",
    "effects[0].extraEligibility.minStakePln":
      "Minimalna kwota zakładu, od której przysługuje promocja to 20 PLN.",
    "effects[0].effect.percent": "Zwrot stawki w postaci bonusu zostanie przyznany automatycznie.",
    "effects[0].effect.paidAs.wagering":
      "Przyznanym bonusem należy w całości dokonać jednokrotnego obrotu, zawierając kupon spełniający następujące warunki: - min. 3 zdarzenia na kuponie – wszystkie zdarzenia z kursem 1.30 lub wyższym.",
    "effects[0].effect.paidAs.wagering.days":
      "Bonus oczekuje w kolejce przez 14 dni. Czas na obrót bonusem wynosi 14 dni.",
    "effects[1].extraEligibility.notes":
      "Regulamin promocji „Zakład bez ryzyka do 1000 PLN” Gracze, którzy zawrą drugi zakład po zarejestrowaniu konta, będą mogli skorzystać z promocji zakład bez ryzyka.",
    "effects[1].effect.capPln": "Maksymalna kwota zakładu, od której przysługuje promocja to 1 000 PLN.",
    "effects[1].extraEligibility.fundsSource": "Zakład bez ryzyka musi zostać zawarty za środki z salda głównego.",
    "effects[2].extraEligibility.notes":
      "Regulamin promocji „Zakład bez ryzyka do 500 PLN” Gracze, którzy zawrą trzeci zakład po zarejestrowaniu konta, będą mogli skorzystać z promocji zakład bez ryzyka.",
    "effects[2].effect.capPln": "Maksymalna kwota zakładu, od której przysługuje promocja to 500 PLN.",
    "effects[2].extraEligibility.fundsSource": "Zakład bez ryzyka musi zostać zawarty za środki z salda głównego.",
  },
});

const vip = bonusBoxPackage({
  slug: "vip",
  packageName: "Pakiet VIP",
  termsHash: "67fb5495ff3907deea99485ee89d8c0296fa467f53e664ada3e8d8d422049afd",
  fetchedAt: "2026-11-07T00:04:32Z",
  effects: [
    zbr(1000, { min: 1000, max: 1000 }, true, ["Zwrot dotyczy tylko pierwszego zakładu za dokładnie 1 000 zł."], "full", {
      requiresConfirmation: [
        {
          key: "forbet_vip_first_deposit_1000",
          label: "Moja pierwsza wpłata w forBET wynosiła co najmniej 1 000 zł",
          expires: "never",
        },
      ],
    }),
    secondDepositBonus(100, 2000, 2000, DEPOSIT_LOCK_NOTE),
    {
      // forBET calls it "freebet 500 PLN", but the terms describe bonus funds rolled over once
      // on a single coupon; whether the stake comes back with the win is not stated.
      effect: {
        type: "TASK_REWARD",
        task: "Drugi depozyt co najmniej 2 000 zł w pakiecie VIP",
        rewardPln: 500,
        paidAs: {
          kind: "bonus_funds",
          wagering: { multiplier: 1, of: "bonus", ownFundsOnly: false, odds: { everyLegMin: 1.3 }, minLegs: 4, days: 14 },
        },
      },
      extraEligibility: {
        notes: [
          "forBET nazywa to freebetem 500 PLN; grasz nim jednym kuponem za całą kwotę, po wykorzystaniu bonusu od depozytu.",
          "Regulamin nie mówi, czy stawka wraca razem z wygraną.",
        ],
      },
      valuation: "display_only",
    },
    {
      effect: { type: "TAX_RELIEF", relief: { kind: "stake_factor", factor: 1 } },
      extraEligibility: {
        maxLegs: 5,
        fundsSource: "own_money_only",
        accountAgeDays: { to: 10 },
        notes: [
          TAX_FREE_START_NOTE,
          TAX_FREE_EXCLUSIONS_NOTE,
          "Nie dotyczy też zakładów z narzędzia BetArchitekt w aplikacji iOS.",
          TAX_FREE_ACTIVATION_NOTE,
        ],
      },
      valuation: "full",
    },
  ],
  evidence: {
    "effects[0].effect.firstCouponOnly":
      "Regulamin promocji „Zakład bez ryzyka 1 000 PLN” Gracze, którzy zawrą pierwszy zakład po zarejestrowaniu konta, będą mogli skorzystać z promocji zakład bez ryzyka.",
    "effects[0].effect.capPln": "Dokładna kwota zakładu, dla której przysługuje promocja to 1 000 PLN.",
    "effects[0].extraEligibility.minStakePln":
      "Zakłady zawarte za mniejszą lub większą kwotę niż 1 000 PLN nie będą uwzględnione w promocji zakład bez ryzyka.",
    "effects[0].extraEligibility.requiresConfirmation":
      "W tej lub wyższej kwocie należy wpłacić pierwszy depozyt.",
    "effects[0].effect.percent": "Zwrot stawki w postaci bonusu zostanie przyznany automatycznie.",
    "effects[0].effect.paidAs.wagering":
      "Przyznanym bonusem należy w całości dokonać jednokrotnego obrotu, zawierając kupon spełniający następujące warunki: - min. 3 zdarzenia na kuponie – wszystkie zdarzenia z kursem 1.30 lub wyższym.",
    "effects[0].effect.paidAs.wagering.days":
      "Bonus oczekuje w kolejce przez 14 dni. Czas na obrót bonusem wynosi 14 dni.",
    "effects[1].effect.percent":
      "Gracze, którzy wpłacą drugi depozyt po zarejestrowaniu konta, otrzymają 100% bonusu od depozytu.",
    "effects[1].effect.capPln":
      "Dokładna kwota bonusu to 2 000 PLN, czyli za depozyt powyżej 2 000 PLN gracz otrzyma 2 000 PLN bonusu.",
    "effects[1].effect.minDepositPln": "Minimalna kwota depozytu to 2 000 PLN.",
    "effects[1].effect.paidAs.wagering": DEPOSIT_WAGERING_QUOTE,
    "effects[1].effect.paidAs.wagering.days": "Czas na obrót bonusem to 14 dni od jego aktywacji",
    "effects[1].extraEligibility.notes":
      "Aby odblokować bonus należy dokonać jednokrotnego obrotu depozytem po całkowitym kursie minimalnym 2.0 dowolną liczbą kuponów równą deponowanej kwocie.",
    "effects[2].effect.rewardPln": "Po spełnieniu warunków wpłaty depozytu gracz otrzyma dodatkowo freebet 500 PLN.",
    "effects[2].effect.paidAs.wagering":
      "Środkami bonusowymi należy obrócić jednokrotnie - CAŁĄ KWOTĄ BONUSU (jeden kupon) - min. kurs pojedynczego zdarzenia w kuponie AKO musi wynosić 1.30.",
    "effects[2].effect.paidAs.wagering.minLegs": "Minimalna liczba zdarzeń na kuponie: 4.",
    "effects[2].effect.paidAs.wagering.days":
      "Bonus oczekuje w kolejce przez 14 dni. Czas na obrót bonusem wynosi 14 dni. Czas na rozliczenie wszystkich zdarzeń wynosi 14 dni.",
    "effects[3].effect.relief.factor":
      "Współczynnik kuponu zmieni się automatycznie na 1.0 jeżeli kupon zostanie zagrany zgodnie z powyższymi pkt. regulaminu promocji „10 dni gry Bez Podatku”.",
    "effects[3].extraEligibility.maxLegs": "Maksymalna liczba zdarzeń na kuponie to 5.",
    "effects[3].extraEligibility.fundsSource":
      "Do promocji nie zaliczają się kupony zagrane za środki bonusowe oraz kupony systemowe.",
    "effects[3].extraEligibility.accountAgeDays":
      "Okres 10 dni gry bez podatku na wszystko zostanie graczowi włączony automatycznie po wyborze danego pakietu.",
    "effects[3].extraEligibility.notes":
      "Do promocji nie zaliczają się zakłady długoterminowe, zakłady specjalne w tym TurboKurs, Combo Expert oraz zakłady z narzędzia BetArchitekt w aplikacji iOS.",
  },
});

// MaxiZysk / Booster: a one-off profit multiplier picked on the coupon, stake = deposit.
function maxiZysk(
  percent: number,
  maxStakePln: number,
  key: string,
  label: string,
  label2: string,
): PromotionEffectEntry {
  return {
    effect: {
      type: "ACCA_BONUS",
      base: "profit",
      tiers: [{ minLegs: 4, percent }],
      qualifyingLegMinOdds: 1.4,
      paidAs: { kind: "cash" },
    },
    extraEligibility: {
      betTypes: ["accumulator"],
      minLegs: 4,
      odds: { everyLegMin: 1.4, totalMin: 4.4 },
      maxStakePln,
      fundsSource: "own_money_only",
      couponAction: `Wybierz ${label2} z listy sald na kuponie`,
      requiresConfirmation: [{ key, label, expires: "never" }],
      notes: [
        "Stawka kuponu musi być równa wpłacie, do której przyznano mnożnik.",
        "Mnożnik trzeba wykorzystać w 72 godziny.",
        "Zdarzenie rozliczone po kursie 1.0 kasuje mnożnik.",
      ],
    },
    // Rounding (multiplier 1.994-2.00) and the 2 279 PLN max win are not representable.
    valuation: "display_only",
  };
}

const maklera = bonusBoxPackage({
  slug: "maklera",
  packageName: "Pakiet Maklera",
  termsHash: "89b53582d8bf7531240e76941995c9f4536772c079d57004cef0769e8a4ab7ac",
  fetchedAt: "2026-11-07T00:04:33Z",
  validFromQuote: "Promocja obowiązuje od 29.05. 2025 od godziny 12:00 do odwołania.",
  notes: ["Maksymalna wygrana na kuponie z MaxiZyskiem to 2 279 zł."],
  effects: [
    maxiZysk(
      100,
      200,
      "forbet_maxizysk_first_deposit",
      "Mam w forBET niewykorzystany MaxiZysk z pierwszej wpłaty (Pakiet Maklera)",
      "MaxiZysk",
    ),
    maxiZysk(
      100,
      100,
      "forbet_maxizysk_second_deposit",
      "Mam w forBET niewykorzystany MaxiZysk z drugiej wpłaty (Pakiet Maklera)",
      "MaxiZysk",
    ),
    maxiZysk(
      50,
      300,
      "forbet_booster_third_deposit",
      "Mam w forBET niewykorzystany Booster 50% z trzeciej wpłaty (Pakiet Maklera)",
      "Booster",
    ),
  ],
  evidence: {
    "effects[0].effect.tiers":
      "Regulamin promocji „MaxiZysk do 200 PLN” Gracze, którzy wpłacą pierwszy depozyt po zarejestrowaniu konta, otrzymają jednorazowo mnożnik MaxiZysk do kwoty 200 PLN.",
    "effects[0].effect.tiers[0].percent": "Zysk z kuponu zostanie pomnożony 2-krotnie.",
    "effects[0].extraEligibility.maxStakePln":
      "Mnożnik przysługuje dla kwoty do maksymalnie 200 PLN, czyli za depozyt powyżej 200 PLN gracz otrzyma MaxiZysk dla kwoty 200 PLN.",
    "effects[0].extraEligibility.odds":
      "Kuponem AKO z min. 4 zdarzeniami przedmeczowymi lub/i LIVE - kurs pojedynczego zdarzenia na kuponie musi wynosić min. 1.40. Kurs ogólny kuponu nie może być niższy niż 4.40.",
    "effects[1].effect.tiers":
      "Regulamin promocji „MaxiZysk do 100 PLN” Gracze, którzy wpłacą drugi depozyt po zarejestrowaniu konta otrzymają jednorazowo mnożnik MaxiZysk do kwoty 100 PLN.",
    "effects[1].extraEligibility.maxStakePln":
      "Mnożnik przysługuje dla kwoty do maksymalnie 100 PLN, czyli za depozyt powyżej 100 PLN gracz otrzyma MaxiZysk dla kwoty 100 PLN.",
    "effects[2].effect.tiers":
      "Regulamin promocji „Booster 50% do 300 PLN” Gracze, którzy wpłacą trzeci depozyt po zarejestrowaniu konta otrzymają jednorazowo mnożnik Booster 50% dla kwoty do kwoty do 300 PLN.",
    "effects[2].effect.tiers[0].percent": "Zysk z kuponu zostanie zwiększony o 50%.",
    "effects[2].extraEligibility.maxStakePln":
      "Mnożnik przysługuje dla kwoty do maksymalnie 300 PLN, czyli za depozyt powyżej 300 PLN gracz otrzyma Booster 50% dla kwoty 300 PLN.",
    "eligibility.notes": "Maksymalna wygrana na kuponie z mnożnikiem MaxiZysk to 2279 PLN.",
  },
});

const rekruta = bonusBoxPackage({
  slug: "rekruta",
  packageName: "Pakiet Rekruta",
  termsHash: "80f724a7a125867028e328a776d6fa399acc9853490bd610c41efe04c416a9c1",
  fetchedAt: "2026-11-07T00:04:34Z",
  recurrenceQuote:
    "Oferta promocyjna ważna jest tylko i wyłącznie dla jednego klienta, konta gracza, gospodarstwa domowego, adresu IP.",
  effects: [
    zbr(200, { min: 200, max: 200 }, true, ["Zwrot dotyczy tylko pierwszego zakładu za dokładnie 200 zł."], "full"),
    {
      effect: {
        type: "DEPOSIT_BONUS",
        depositIndex: 2,
        percent: 100,
        capPln: 300,
        minDepositPln: 300,
        paidAs: { kind: "bonus_funds", wagering: DEPOSIT_BONUS_WAGERING },
      },
      extraEligibility: {
        notes: [
          "Bonus jest zablokowany, dopóki nie obrócisz raz kwotą równą bonusowi po kursie całkowitym min. 2.00; dopiero potem obracasz bonusem 2 razy.",
        ],
      },
      valuation: "display_only",
    },
    {
      // Called "Freebet 100 PLN" by forBET; the terms describe bonus funds rolled over once.
      effect: {
        type: "TASK_REWARD",
        task: "Drugi depozyt co najmniej 300 zł w pakiecie Rekruta",
        rewardPln: 100,
        paidAs: {
          kind: "bonus_funds",
          wagering: { multiplier: 1, of: "bonus", ownFundsOnly: false, odds: { everyLegMin: 1.3 }, minLegs: 4, days: 3 },
        },
      },
      extraEligibility: {
        notes: [
          "forBET nazywa to freebetem 100 PLN; grasz nim jednym kuponem za całą kwotę, po wykorzystaniu bonusu od depozytu.",
          "Regulamin nie mówi, czy stawka wraca razem z wygraną.",
        ],
      },
      valuation: "display_only",
    },
    taxFree3to5(30, [TAX_FREE_START_NOTE, TAX_FREE_EXCLUSIONS_NOTE]),
  ],
  evidence: {
    "effects[0].effect.firstCouponOnly":
      "Regulamin promocji „Zakład bez ryzyka 200 PLN” Gracze, którzy zawrą pierwszy zakład po zarejestrowaniu konta będą mogli skorzystać z promocji zakład bez ryzyka.",
    "effects[0].effect.capPln": "Dokładna kwota, dla której przysługuje promocja to 200 PLN.",
    "effects[0].extraEligibility.minStakePln":
      "Zakłady zawarte za mniejszą lub większą kwotę niż 200 PLN nie będą uwzględnione w promocji zakład bez ryzyka.",
    "effects[0].effect.percent": "Zwrot stawki w postaci bonusu zostanie przyznany automatycznie.",
    "effects[0].effect.paidAs.wagering":
      "Przyznanym bonusem należy w całości dokonać jednokrotnego obrotu, zawierając kupon spełniający następujące warunki: - min. 3 zdarzenia na kuponie – wszystkie zdarzenia z kursem 1.30 lub wyższym.",
    "effects[0].effect.paidAs.wagering.days":
      "Bonus oczekuje w kolejce przez 14 dni. Czas na obrót bonusem wynosi 14 dni.",
    "effects[1].effect.percent":
      "Gracze, którzy wpłacą drugi depozyt po zarejestrowaniu konta otrzymają 100% bonusu od depozytu .",
    "effects[1].effect.capPln": "Kwota bonusu to 300 PLN, za depozyt 300 PLN lub więcej gracz otrzyma 300 PLN bonusu.",
    "effects[1].effect.minDepositPln": "Kwota depozytu musi wynieść min. 300 PLN.",
    "effects[1].effect.paidAs.wagering": DEPOSIT_WAGERING_QUOTE,
    "effects[1].effect.paidAs.wagering.days": "Czas na obrót bonusem to 14 dni od jego aktywacji",
    "effects[1].extraEligibility.notes":
      "Aby odblokować bonus należy dokonać jednokrotnego obrotu depozytem po całkowitym kursie minimalnym 2.0 dowolną liczbą kuponów, których stawki równają się kwocie przyznanego bonusu.",
    "effects[2].effect.rewardPln": "Po spełnieniu warunków wpłaty depozytu gracz otrzyma dodatkowo freebet 100 PLN.",
    "effects[2].effect.paidAs.wagering":
      "Środkami bonusowymi należy obrócić jednokrotnie - CAŁĄ KWOTĄ BONUSU (jeden kupon) - min. kurs pojedynczego zdarzenia w kuponie AKO musi wynosić 1.30.",
    "effects[2].effect.paidAs.wagering.minLegs": "Minimalna liczba zdarzeń na kuponie: 4.",
    "effects[2].effect.paidAs.wagering.days": "Czas na obrót bonusem wynosi 72 godziny.",
    "effects[3].effect.relief.factor":
      "Współczynnik kuponu zmieni się automatycznie na 1.0 jeżeli kupon zostanie zagrany zgodnie z powyższymi pkt. regulaminu promocji „30 dni gry Bez Podatku”.",
    "effects[3].extraEligibility.minLegs": "Na kuponie muszą znajdować się min. 3 zdarzenia.",
    "effects[3].extraEligibility.maxLegs": "Maksymala liczba zdarzeń na kuponie to 5.",
    "effects[3].extraEligibility.odds.everyLegMin": "Minmalny kurs każdego zdarzenia - 1.30.",
    "effects[3].extraEligibility.fundsSource":
      "Do promocji nie zaliczają się kupony zagrane za środki bonusowe oraz kupony systemowe.",
    "effects[3].extraEligibility.accountAgeDays":
      "Okres 30 dni gry bez podatku zostanie graczowi włączony automatycznie po wyborze danego pakietu.",
  },
});

const spryciarza = bonusBoxPackage({
  slug: "spryciarza",
  packageName: "Pakiet Spryciarza",
  termsHash: "97f0ca7d152dde40e88fa2fd5ad0cd23d95483f2cfd57647af5687685c2c2d6d",
  fetchedAt: "2026-11-07T00:04:35Z",
  // 30 + 20 + 10 days with identical conditions: one 60-day effect.
  effects: [taxFree3to5(60, ["Trzy kolejne okresy: 30, 20 i 10 dni, łącznie 60 dni od wyboru pakietu.", TAX_FREE_EXCLUSIONS_NOTE])],
  evidence: {
    "effects[0].effect.relief.factor":
      "Współczynnik kuponu zmieni się automatycznie na 1.0 jeżeli kupon zostanie zagrany zgodnie z powyższymi pkt. regulaminu promocji „10 dni gry Bez Podatku”.",
    "effects[0].extraEligibility.minLegs": "Na kuponie muszą znajdować się min. 3 zdarzenia.",
    "effects[0].extraEligibility.maxLegs": "Maksymalna liczba zdarzeń na kuponie to 5.",
    "effects[0].extraEligibility.odds.everyLegMin": "Minimalny kurs każdego zdarzenia - 1.30.",
    "effects[0].extraEligibility.fundsSource":
      "Do promocji nie zaliczają się kupony zagrane za środki bonusowe oraz kupony systemowe.",
    "effects[0].extraEligibility.accountAgeDays":
      "Gra bez podatku zostanie wyłączona w ciągu 24 godzin roboczych od upływu 10 dni gry bez podatku, a 60 dni łącznie.",
    "effects[0].extraEligibility.notes":
      "Okres 30 dni gry bez podatku zostanie graczowi włączony automatycznie po wyborze danego pakietu.",
  },
});

const wirtualny = bonusBoxPackage({
  slug: "wirtualny",
  packageName: "Pakiet Wirtualny",
  termsHash: "64efef44d576f4e77efedc0ba688e29b705b5aefbbcc06d037243b23674b7e03",
  fetchedAt: "2026-11-07T00:04:36Z",
  notes: ["Pakiet zawiera też freebety za kupony na sporty wirtualne; tej części nie porównujemy."],
  effects: [taxFree3to5(30, [TAX_FREE_START_NOTE, TAX_FREE_EXCLUSIONS_NOTE])],
  evidence: {
    "effects[0].effect.relief.factor":
      "Współczynnik kuponu zmieni się automatycznie na 1.0 jeżeli kupon zostanie zagrany zgodnie z powyższymi pkt. regulaminu promocji „30 dni gry Bez Podatku”.",
    "effects[0].extraEligibility.minLegs": "Na kuponie muszą znajdować się min. 3 zdarzenia",
    "effects[0].extraEligibility.maxLegs": "Maksymala liczba zdarzeń na kuponie to 5.",
    "effects[0].extraEligibility.odds.everyLegMin": "Minmalny kurs każdego zdarzenia - 1.30.",
    "effects[0].extraEligibility.fundsSource":
      "Do promocji nie zaliczają się kupony zagrane za środki bonusowe oraz kupony systemowe.",
    "effects[0].extraEligibility.accountAgeDays":
      "Okres 30 dni gry bez podatku zostanie graczowi włączony automatycznie po wyborze danego pakietu.",
    "eligibility.notes":
      "Uczestnik, który wybierze Pakiet Wirtualny, otrzyma pakiet powitalny, w którego skład wchodzi: promocja „Gra bez podatku 30 dni”, promocja „Freebet 500 za 500 PLN (I)”, promocja „Freebet 500 za 500 PLN (II)”.",
  },
});

const BONUS_BOX_IDS = [szefa, nocny, bezpieczny, vip, maklera, rekruta, spryciarza, wirtualny].map((p) => p.id);

const kodForbet3000: Promotion = {
  id: FORBET3000_ID,
  bookmaker: "forbet",
  // forBET's full name is "Pakiet Powitalny z kodem promocyjnym FORBET3000"; the code is left out
  // because the UI renders names verbatim and codes are not exposed (spec 8.2).
  name: "Pakiet Powitalny z kodem promocyjnym",
  audience: "new_customer",
  recurrence: { kind: "one_time" },
  validFrom: "2025-05-29T00:00:00+02:00",
  activation: { kind: "registration_code", code: "FORBET3000" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    fundsSource: "any",
    requiresConfirmation: [],
    notes: [
      "Kod dodaje 150 zł bonusu do każdego pakietu Bonus Box; reszta zależy od wybranego pakietu.",
      "Strona promocji nazywa te 150 zł freebetem, a regulamin bonusem z obrotem 4×.",
    ],
  },
  effects: [
    {
      effect: {
        type: "TASK_REWARD",
        task: "Rejestracja z kodem promocyjnym i pierwsza wpłata co najmniej 100 zł",
        rewardPln: 150,
        paidAs: {
          kind: "bonus_funds",
          wagering: {
            multiplier: 4,
            of: "bonus",
            ownFundsOnly: false,
            odds: { everyLegMin: 1.2, totalMin: 2 },
            minLegs: 2,
            days: 15,
          },
        },
      },
      valuation: "full",
    },
  ],
  stacking: { combinableWith: BONUS_BOX_IDS },
  source: {
    promoUrl: "https://www.iforbet.pl/kod-forbet3000",
    termsUrl: cms("kod-forbet3000"),
    publicTermsUrl: pub("kod-forbet3000"),
    termsHash: "a73e1fe06f8e889381ae836434b4b4062eb43d867d51ec18c9975b251af630cb",
    fetchedAt: "2026-11-07T00:04:39Z",
    evidence: {
      audience:
        "Gracz, który zarejestruje konto na stronie lub w aplikacji forBET, wpisując w procesie rejestracji kod promocyjny FORBET3000, w trakcie trwania promocji otrzyma pakiet powitalny, którego skład jest zależny od wybranego pakietu w ramach Bonux Box.",
      recurrence:
        "Oferta promocyjna ważna jest tylko i wyłącznie dla jednego klienta, konta gracza, gospodarstwa domowego, adresu IP.",
      validFrom: "Promocja obowiązuje od 29.05.2025 do odwołania.",
      "activation.code": "Wpisz przy rejestracji oficjalny kod FORBET3000, a otrzymasz aż trzy promocje!",
      "effects[0].effect.rewardPln":
        "Gracze, którzy wpłacą pierwszy depozyt po zarejestrowaniu konta w wysokości min. 100 PLN, otrzymają dodatkowy bonus 150 PLN.",
      "effects[0].effect.paidAs.wagering":
        "Bonusem 150 PLN należy obrócić czterokrotnie, kuponami z kursem minimalnym zdarzenia 1.20. Minimalna liczba zdarzeń na kuponie:2. Kurs ogólny kuponu min. 2.00. Czas na obrót bonusem wynosi 360 godzin.",
      "stacking.combinableWith": BONUS_BOX_COMBINABLE_QUOTE,
      "eligibility.notes": "Pierwsza wpłata aktywuje Zakład Bez Ryzyka do 1000 PLN + 150 PLN Freebet (dla wpłaty min. 100 PLN).",
    },
  },
  review: REVIEW,
  version: 1,
};

const ranneGranie: Promotion = {
  id: "forbet-ranne-granie-bez-podatku",
  bookmaker: "forbet",
  name: "Ranne granie BEZ PODATKU",
  audience: "everyone",
  recurrence: { kind: "always_on" },
  validFrom: "2026-10-01T00:00:00+02:00",
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["accumulator"],
    minLegs: 3,
    maxLegs: 5,
    odds: { everyLegMin: 1.3 },
    fundsSource: "own_money_only",
    placementWindows: [
      { days: WORKDAYS, from: "06:00", to: "11:00" },
      { days: WORKDAYS, from: "06:00", to: "13:00", channel: "app" },
    ],
    requiresConfirmation: [FULL_REGISTRATION_CONFIRMATION],
    notes: [
      "Nie łączy się z grą bez podatku z pakietu powitalnego.",
      "Nie dotyczy wirtualnego tenisa, kuponów z MaxiZyskiem lub Boosterem, zakładów systemowych, długoterminowych, TurboKursu ani gier karcianych.",
    ],
  },
  effects: [
    {
      effect: { type: "TAX_RELIEF", relief: { kind: "stake_factor", factor: 1 } },
      valuation: "full",
    },
  ],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: "https://www.iforbet.pl/ranne-granie-bez-podatku",
    termsUrl: cms("ranne-granie-bez-podatku"),
    publicTermsUrl: pub("ranne-granie-bez-podatku"),
    termsHash: "105237fae45ca6bfa460a2fd3ca0d5a5481e9ee02969601eb3e3c525ca7a8c38",
    fetchedAt: "2026-11-07T00:04:37Z",
    evidence: {
      audience: "Promocja ważna jest dla klientów, którzy przeszli pełną rejestrację na stronie forBET.",
      "eligibility.requiresConfirmation":
        "Promocja ważna jest dla klientów, którzy przeszli pełną rejestrację na stronie forBET.",
      recurrence: "Codziennie, od poniedziałku do piątku w godz. 6:00 - 11:00 grasz u nas BEZ PODATKU",
      validFrom:
        "Promocja obowiązuje od 01.10.2026, od poniedziałku do piątku, w godzinach 06:00 - 11:00 (dla kuponów zawartych na stronie komputerowej lub stronie mobilnej) lub w godzinach 06:00 - 13:00 (dla kuponów zawartych w aplikacji Android lub iOS).",
      "eligibility.placementWindows":
        "Promocja obowiązuje od 01.10.2026, od poniedziałku do piątku, w godzinach 06:00 - 11:00 (dla kuponów zawartych na stronie komputerowej lub stronie mobilnej) lub w godzinach 06:00 - 13:00 (dla kuponów zawartych w aplikacji Android lub iOS).",
      "eligibility.minLegs":
        "Na kuponie muszą znajdować się min. 3 zdarzenia i max. 5 zdarzeń - kurs każdego pojedynczego zdarzenia nie może być niższy niż 1.30.",
      "eligibility.odds.everyLegMin":
        "Na kuponie muszą znajdować się min. 3 zdarzenia i max. 5 zdarzeń - kurs każdego pojedynczego zdarzenia nie może być niższy niż 1.30.",
      "eligibility.fundsSource":
        "W promocji nie biorą udziału kupony zagrane za środki bonusowe, MaxiZysk, Booster oraz zakłady systemowe.",
      "effects[0].effect.relief.factor":
        "Współczynnik kuponu zmieni się automatycznie na 1.0, jeżeli kupon zostanie zagrany zgodnie z zasadami promocji.",
      "stacking.combinableWith": "Promocja nie łączy się z promocją „30 dni gry Bez Podatku” z Pakietu Powitalnego.",
    },
  },
  review: REVIEW,
  version: 1,
};

const turboAko: Promotion = {
  id: "forbet-turbo-ako",
  bookmaker: "forbet",
  name: "TurboAKO",
  audience: "everyone",
  recurrence: { kind: "always_on" },
  validFrom: "2026-05-26T15:00:00+02:00",
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["accumulator"],
    minLegs: 6,
    maxLegs: 32,
    fundsSource: "own_money_only",
    requiresConfirmation: [FULL_REGISTRATION_CONFIRMATION],
    notes: [
      "Do progu liczą się tylko zdarzenia z kursem co najmniej 1.30.",
      "Nie dotyczy kuponów z MaxiZyskiem, Boosterem lub TurboKursem, zakładów specjalnych, długoterminowych, sezonowych, systemowych ani kuponów rozliczonych przez Cashout.",
      "Regulamin mówi, że TurboAKO zwiększa wygraną, ale nie mówi, czy procent liczy się od całej wypłaty czy od zysku.",
    ],
  },
  effects: [
    {
      effect: {
        type: "ACCA_BONUS",
        // "zwiększa wygraną" on forBET's "Możliwa Wygrana" (stake x 0.88 x odds); profit is
        // the other possible reading, hence display_only.
        base: "total_odds",
        tiers: [
          { minLegs: 6, percent: 15 },
          { minLegs: 7, percent: 20 },
          { minLegs: 8, percent: 25 },
          { minLegs: 9, percent: 30 },
          { minLegs: 10, percent: 35 },
          { minLegs: 11, percent: 40 },
        ],
        qualifyingLegMinOdds: 1.3,
        capPln: 10000,
        paidAs: { kind: "cash" },
      },
      valuation: "display_only",
    },
  ],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: "https://www.iforbet.pl/turbo-ako",
    termsUrl: cms("turbo-ako"),
    publicTermsUrl: pub("turbo-ako"),
    termsHash: "a2151b1cf130e62f5d783c26cac0e6b16654b16dc884f6d1ce00ea2a4afac834",
    fetchedAt: "2026-11-07T00:04:38Z",
    evidence: {
      audience: "Promocja ważna jest dla klientów, którzy przeszli pełną rejestrację na stronie forBET.",
      "eligibility.requiresConfirmation":
        "Promocja ważna jest dla klientów, którzy przeszli pełną rejestrację na stronie forBET.",
      recurrence: "Promocja obowiązuje od 26.05.2026, godz. 15:00. Promocja obowiązuje do odwołania.",
      validFrom: "Promocja obowiązuje od 26.05.2026, godz. 15:00. Promocja obowiązuje do odwołania.",
      activation: "TurboAKO dodaje się automatycznie od 6 zdarzeń.",
      "eligibility.maxLegs": "11-32 zdarzeń:: {+40%}",
      "eligibility.fundsSource":
        "W promocji nie biorą udziału kupony zagrane za środki bonusowe, MaxiZysk, Booster, TurboKurs, zakłady specjalne, długoterminowe, sezonowe, zakłady systemowe oraz rozliczone przy użyciu funkcji Cashout.",
      "effects[0].effect.tiers":
        "TurboAKO zwiększa wygraną według poniższego podziału: 6 zdarzeń - 15% 7 zdarzeń - 20% 8 zdarzeń - 25% 9 zdarzeń - 30% 10 zdarzeń - 35% 11 zdarzeń - 40%",
      "effects[0].effect.qualifyingLegMinOdds":
        "Kurs pojedynczego zdarzenia to 1.30 lub wyższy. Kursy poniżej 1.30 nie będą zaliczały się do TurboAKO.",
      "effects[0].effect.capPln": "Maksymalna kwota bonusu TurboAKO to 10 000 PLN.",
      "effects[0].effect.base": "Już przy sześciu zdarzeniach potencjalna wygrana zwiększy się o 15%.",
    },
  },
  review: REVIEW,
  version: 1,
};

const turboKurs: Promotion = {
  id: "forbet-turbo-kurs",
  bookmaker: "forbet",
  name: "TurboKurs",
  audience: "everyone",
  recurrence: { kind: "always_on" },
  validFrom: "2024-02-29T00:00:00+01:00",
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    fundsSource: "own_money_only",
    requiresConfirmation: [],
    notes: [
      "Podwyższone kursy na wybrane zdarzenia w wybrane dni, w zakładce TurboKurs.",
      "Limit stawki to zwykle 200 zł łącznie na wszystkie kupony z TurboKursem.",
      "TurboKurs nie liczy się do gry bez podatku ani do TurboAKO.",
    ],
  },
  effects: [{ effect: { type: "OTHER", description: "Podwyższone kursy na wybrane zdarzenia (TurboKurs)" }, valuation: "display_only" }],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: "https://www.iforbet.pl/nowy-turbo-kurs",
    termsUrl: cms("nowy-turbo-kurs"),
    publicTermsUrl: pub("nowy-turbo-kurs"),
    termsHash: "92e11be8f1f6ab58f9f1a2489802cd056fb699ba4e19b5fbf48e0b02175ad79e",
    fetchedAt: "2026-11-07T00:04:41Z",
    evidence: {
      audience: "TurboKurs będzie publikowany na stronie www w zakładce TurboKurs.",
      recurrence: "Promocja obowiązuje od 29.02.2024 w wybrane dni do odwołania.",
      validFrom: "Promocja obowiązuje od 29.02.2024 w wybrane dni do odwołania.",
      "eligibility.betTypes": "Zdarzenie TurboKurs może zostać zagrane jako singiel lub w kuponie AKO.",
      "eligibility.fundsSource": "Zdarzenie nie może zostać zagrane z salda bonusowego.",
      "eligibility.notes":
        "Każdy użytkownik może postawić na TurboKurs ograniczoną stawkę. Zazwyczaj jest to 200 PLN, chyba że osobny komunikat stanowi inaczej.",
    },
  },
  review: REVIEW,
  version: 1,
};

const bonusUrodzinowy: Promotion = {
  id: "forbet-bonus-urodzinowy",
  bookmaker: "forbet",
  name: "Bonus urodzinowy",
  audience: "everyone",
  recurrence: { kind: "per_event" },
  validFrom: "2018-11-22T00:00:00+01:00",
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    fundsSource: "any",
    requiresConfirmation: [FULL_REGISTRATION_CONFIRMATION],
    notes: [
      "Przysługuje w dniu urodzin, jeśli w ostatnich 3 miesiącach wpłaciłeś co najmniej 100 zł i obróciłeś tę kwotę co najmniej raz.",
      "Nowe konto założone do 7 dni przed urodzinami albo do 7 dni po nich też się kwalifikuje; po urodzinach trzeba napisać na promocje@iforbet.pl.",
    ],
  },
  effects: [
    {
      effect: {
        type: "TASK_REWARD",
        task: "Urodziny i wpłata co najmniej 100 zł z jednokrotnym obrotem w ostatnich 3 miesiącach",
        rewardPln: 20,
        paidAs: {
          kind: "bonus_funds",
          wagering: {
            multiplier: 2,
            of: "bonus",
            ownFundsOnly: false,
            odds: { everyLegMin: 1.2, totalMin: 2 },
            minLegs: 3,
            days: 14,
          },
        },
      },
      valuation: "full",
    },
  ],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: "https://www.iforbet.pl/bonus-urodzinowy",
    termsUrl: cms("bonus-urodzinowy"),
    publicTermsUrl: pub("bonus-urodzinowy"),
    termsHash: "09edb680eba8c22741a96c9a889ba5756e15da68a96c09aa2fafd18d528cc0de",
    fetchedAt: "2026-11-07T00:04:43Z",
    evidence: {
      audience:
        "Promocja dotyczy również nowo zarejestrowanych Graczy, którzy założyli konto w serwisie iforbet.pl w okresie do 7 dni przed albo do 7 dni po dacie swoich urodzin.",
      "eligibility.requiresConfirmation":
        "Promocja ważna jest tylko dla klientów, którzy przeszli pełną rejestrację konta w serwisie iforbet.pl",
      recurrence:
        "Promocja dotyczy Graczy, którzy w okresie 3 ostatnich miesięcy wpłacili minimum 100 złotych depozytu i dokonali przynajmniej jednokrotnego obrotu i obchodzą w danym dniu urodziny.",
      validFrom: "Promocja obowiązuje od 22 listopada 2018 roku do odwołania.",
      "effects[0].effect.rewardPln":
        "Graczom, którzy spełnili warunki opisane w punktach 1-2 zostanie przypisany bonus urodzinowy w wysokości 20 złotych.",
      "effects[0].effect.paidAs.wagering":
        "Obrót bonusem wynosi 2x po kursie minimalnym 2.0 - min. kurs pojedynczego zdarzenia w kuponie AKO musi wynosić 1.20. Na kuponie muszą znajdować się min. 3 zdarzenia.",
      "effects[0].effect.paidAs.wagering.days":
        "Bonus oczekuje w kolejce przez 14 dni. Czas na obrót bonusem wynosi 14 dni.",
    },
  },
  review: REVIEW,
  version: 1,
};

const betPlanner: Promotion = {
  id: "forbet-betplanner",
  bookmaker: "forbet",
  name: "BetPlanner Centrum Promocji",
  audience: "everyone",
  loyaltyProgram: true,
  recurrence: { kind: "always_on" },
  activation: { kind: "join_button" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    fundsSource: "any",
    requiresConfirmation: [
      {
        key: "forbet_marketing_consents",
        label: "Mam włączone zgody marketingowe (e-mail i SMS) w forBET",
        expires: "never",
      },
    ],
    notes: [
      "Kalendarz akcji czasowych: na każdą trzeba się osobno zapisać. Za udział dostajesz BetCoiny do wymiany w sklepie.",
    ],
  },
  effects: [
    {
      effect: { type: "OTHER", description: "Kalendarz promocji z zapisami i sklepem za BetCoiny" },
      valuation: "display_only",
    },
  ],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: "https://www.iforbet.pl/betplanner-centrum-promocji",
    termsUrl: cms("betplanner-centrum-promocji"),
    publicTermsUrl: pub("betplanner-centrum-promocji"),
    termsHash: "55c35e76610780be8143e970fb398151ea551b4598626663e07ea5a48da5ac0b",
    fetchedAt: "2026-11-07T00:04:45Z",
    evidence: {
      audience: "Twoje centrum promocji! Planuj swoją aktywność, zapisuj się do promocji i zgarniaj BetCoiny",
      recurrence: "Twoje centrum promocji! Planuj swoją aktywność, zapisuj się do promocji i zgarniaj BetCoiny",
      "eligibility.requiresConfirmation":
        "Zauważyliśmy, że nie masz ustawionych zgód marketingowych na swoim koncie. Zaznacz je, aby wziąć udział w tej promocji.",
    },
  },
  review: REVIEW,
  version: 1,
};

const strefaGracza: Promotion = {
  id: "forbet-strefa-gracza",
  bookmaker: "forbet",
  name: "Strefa Gracza",
  audience: "everyone",
  recurrence: { kind: "per_period", period: "week" },
  activation: { kind: "automatic" },
  eligibility: {
    betTypes: ["single", "accumulator"],
    fundsSource: "any",
    requiresConfirmation: [],
    notes: [
      "Konkursy typerskie z nagrodami w bonusach. Konkurs Open jest dla wszystkich zalogowanych, konkurs Elite po spełnieniu warunków aktywności z poprzedniego tygodnia.",
    ],
  },
  effects: [{ effect: { type: "OTHER", description: "Cotygodniowe konkursy typerskie (Open i Elite)" }, valuation: "display_only" }],
  stacking: { combinableWith: [] },
  source: {
    promoUrl: "https://www.iforbet.pl/lobby-strefa-gracza",
    termsUrl: cms("lobby-strefa-gracza"),
    publicTermsUrl: pub("lobby-strefa-gracza"),
    termsHash: "25fdffb578ac8306f0698dd35f07c4bed7b07d64ca6cae3a86498f3734a0d528",
    fetchedAt: "2026-11-07T00:04:46Z",
    evidence: {
      audience: "Konkurs Open dostępny jest dla wszystkich Graczy. Konkurs Elite tylko dla tych, którzy spełnili warunki.",
      recurrence:
        "Zazwyczaj to: min. 10 kuponów w 4 oddzielne dni tygodnia (od poniedziałku do niedzieli w tygodniu poprzedzającym konkurs) za stawkę min. 30 PLN min. oraz min. 300 PLN depozytu w tydzień.",
    },
  },
  review: REVIEW,
  version: 1,
};

export const forbetPromotions: Promotion[] = [
  szefa,
  nocny,
  bezpieczny,
  vip,
  maklera,
  rekruta,
  spryciarza,
  wirtualny,
  kodForbet3000,
  ranneGranie,
  turboAko,
  turboKurs,
  bonusUrodzinowy,
  betPlanner,
  strefaGracza,
];
