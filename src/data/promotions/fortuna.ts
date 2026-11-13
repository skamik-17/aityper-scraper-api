import type { FreebetTerms, Promotion } from "../../types/promotions.js";

// Entries come from the research files and the live terms.
// Terms fetched 2026-11-07: komunikat PDFs from api.efortuna.pl/cms-client/file/<id>, and the
// promotion JSON api.efortuna.pl/pm/api/public/v1/promotion-definitions/<id> (needs the header
// Accept-Language: pl) behind the public page www.efortuna.pl/bonus/<slug> (publicTermsUrl).
// Quotes are verbatim from the normalized text.

const VERIFIED = {
  status: "verified",
  verifiedAt: "2026-11-07T01:30:21+01:00",
  verifiedBy: "research-agent",
} as const;

// Freebet Wskaźnik = (0.88 x odds - 1) / odds: net win = F x (0.88 x odds - 1).
const WELCOME_FREEBET: FreebetTerms = { winFactor: 0.88, stakeDeduction: 1, odds: { totalMin: 2.5 }, validDays: 7 };

const FREEBET_WSKAZNIK_QUOTE = "wynosi [0,88 pomnożone przez kurs minus 1 (jeden)] podzielone przez kurs.";

export const fortunaPromotions: Promotion[] = [
  {
    id: "fortuna-zaklad-bez-ryzyka",
    bookmaker: "fortuna",
    name: "Zakład Bez Ryzyka",
    audience: "new_customer",
    recurrence: { kind: "one_time" },
    validFrom: "2026-08-06T10:00:00+02:00",
    activation: { kind: "registration_code", code: "BEZRYZYKA" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      maxStakePln: 200,
      fundsSource: "any",
      accountAgeDays: { to: 7 },
      requiresConfirmation: [],
      couponAction: "Włącz suwak promocji pod kuponem przed pierwszym zakładem",
      notes: [
        "Dotyczy tylko pierwszego zakładu po rejestracji, zawartego w ciągu 168 godzin od rejestracji.",
        "Kwota zakładu (z podatkiem) najwyżej 200 zł; planowane rozstrzygnięcie najpóźniej 7 dni od zawarcia.",
        "Nie dotyczy Superoferty, Ekspert+, Hitu Dnia, Wirtualnych Sportów, Bet On Games ani Early Cash Out.",
        "Komunikat nie wymaga kodu; kod promocyjny podaje strona oferty powitalnej.",
      ],
    },
    effects: [
      {
        effect: {
          type: "REFUND_ON_LOSS",
          percent: 100,
          base: "gross_stake",
          capPln: 200,
          paidAs: { kind: "cash" },
          firstCouponOnly: true,
        },
        valuation: "full",
      },
    ],
    stacking: { combinableWith: ["fortuna-freebety-powitalne"] },
    source: {
      promoUrl: "https://www.efortuna.pl/bonus/oferta-powitalna",
      termsUrl: "https://api.efortuna.pl/cms-client/file/6a797f822434e2287d2da11e",
      termsVersionDate: "2026-08-06",
      termsHash: "5bda1b64e66f38d8060052d290b037fef432eb166860f1ac704d57f4c167ea25",
      fetchedAt: "2026-11-07T01:15:57+01:00",
      evidence: {
        audience:
          "przed 06.08.2026 r. od godz. 10:00 nie posiadały iKonta tymczasowego lub iKonta stałego w Fortunie oraz, 2) w okresie od 06.08.2026 r. od godz. 10:00 dokonają rejestracji iKonta tymczasowego lub iKonta stałego.",
        recurrence:
          "Możliwość zawarcia Zakładu „Bez ryzyka” obejmuje wyłącznie pierwszy zakład po zakończeniu rejestracji iKonta",
        validFrom: "Fortuna, począwszy od 06.08.2026 r. od godz. 10:00 do odwołania",
        // From the welcome page (www.efortuna.pl/bonus/oferta-powitalna).
        "activation.code":
          "Zarejestruj się z kodem BEZRYZYKA i odbierz Zakład Bez Ryzyka do 200 zł oraz aż 85 zł we freebetach na start.",
        "eligibility.couponAction":
          "Pamiętaj o aktywowaniu odpowiedniej promocji suwakiem pod kuponem. Zrób to przed zawarciem pierwszego zakładu.",
        "eligibility.maxStakePln": "kwota wpłacona na zakład (stawka - w tym podatek od gry) wyniesie nie więcej niż 200 zł",
        "eligibility.accountAgeDays.to": "zostanie zawarty w terminie 168 godzin od momentu rejestracji iKonta",
        "eligibility.notes[1]":
          "planowane (w momencie zawierania zakładu) rozstrzygnięcie zakładu nastąpi maksymalnie w terminie 7 dni od dnia jego zawarcia.",
        "eligibility.notes[2]":
          "zakład nie będzie dotyczył oferty: Superoferty, Ekspert +, Hitu Dnia, Wirtualnych Sportów, Bet On Games oraz wypłaconych wcześniej (opcja \"Early Cash Out\").",
        "effects[0].effect.percent":
          "W przypadku gdy zakład „Bez ryzyka” okaże się przegrany, zakład zostanie anulowany i kwota wpłacona przez Klienta za ten zakład zostanie zwrócona na iKonto klienta 24 godzin od rozliczenia zakładu.",
        "effects[0].effect.capPln":
          "otrzymają możliwość zawarcia zakładu „Bez ryzyka” za maksymalna kwotę (stawka – w tym podatek od gry) 200 zł.",
        "effects[0].effect.paidAs": "W przypadku przegranej otrzymasz zwrot stawki w gotówce.",
        "stacking.combinableWith": "Zakład Bez Ryzyka do 200 zł + 85 zł we freebetach!",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "fortuna-freebety-powitalne",
    bookmaker: "fortuna",
    name: "Freebet o wartości 50 zł + freebet o wartości 20 zł w ramach oferty powitalnej",
    audience: "new_customer",
    recurrence: { kind: "one_time" },
    validFrom: "2026-09-09T10:00:00+02:00",
    activation: { kind: "registration_code", code: "BEZRYZYKA" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      fundsSource: "any",
      accountAgeDays: { to: 3 },
      requiresConfirmation: [
        {
          key: "fortuna_marketing_consents",
          label: "Mam włączone zgody marketingowe SMS i e-mail w Fortunie",
          expires: "never",
        },
      ],
      notes: [
        "Warunki (pełna weryfikacja konta, zgody marketingowe, pierwsza wpłata) trzeba spełnić w ciągu 72 godzin od rejestracji.",
        "Każdy freebet stawia się jednym zakładem za dokładnie jego kwotę.",
        "Zakład za freebet nie łączy się z innymi promocjami ani bonusami kursowymi.",
        "Limity stawki w ustawieniach odpowiedzialnej gry muszą pozwalać na zakład za kwotę freebetu.",
        "Strona oferty wymienia też freebet 10 zł za dołączenie do Discorda Fortuny i 5 zł za udostępnienie kuponu w Strefie Kuponów.",
      ],
    },
    effects: [
      {
        effect: {
          type: "FREEBET_GRANT",
          amountPln: 50,
          trigger: "Pierwsza wpłata, pełna weryfikacja konta i zgody marketingowe SMS i e-mail w ciągu 72 godzin od rejestracji",
          terms: WELCOME_FREEBET,
        },
        valuation: "full",
      },
      {
        effect: {
          type: "FREEBET_GRANT",
          amountPln: 20,
          trigger: "Te same warunki; freebet do wykorzystania tylko w aplikacji Fortuny",
          terms: WELCOME_FREEBET,
        },
        valuation: "full",
      },
    ],
    stacking: { combinableWith: ["fortuna-zaklad-bez-ryzyka"] },
    source: {
      promoUrl: "https://www.efortuna.pl/bonus/oferta-powitalna",
      termsUrl: "https://api.efortuna.pl/pm/api/public/v1/promotion-definitions/6abf7c2c721cff577fbb340c",
      publicTermsUrl: "https://www.efortuna.pl/bonus/oferta-powitalna",
      termsVersionDate: "2026-09-09",
      termsHash: "a1a18bf1f929c417f057fe7e2326812e4b5aca1de9ae67461d82da70607e3b6d",
      fetchedAt: "2026-11-07T01:12:01+01:00",
      evidence: {
        audience:
          "Promocja przeznaczona jest wyłącznie dla nowych Klientów Organizatora, którzy w czasie jej obowiązywania dokonają rejestracji iKonta",
        recurrence:
          "Jednemu graczowi przysługuje w ramach Promocji jeden zestaw dwóch freebetów, o których mowa w pkt 3.3.",
        validFrom: "Promocja obowiązuje od dnia 9.09.2026 r. od godziny 10:00 do odwołania.",
        "activation.code":
          "Zarejestruj się z kodem BEZRYZYKA i odbierz Zakład Bez Ryzyka do 200 zł oraz aż 85 zł we freebetach na start.",
        "eligibility.accountAgeDays.to":
          "Aby wziąć udział w Promocji, gracz musi w ciągu 72 godzin od momentu rejestracji iKonta spełnić następujące warunki",
        "eligibility.requiresConfirmation[0]":
          "udzielić Organizatorowi zgód na komunikację marketingową, tj. zgodę na komunikację za pośrednictwem wiadomości SMS oraz zgodę na komunikację za pośrednictwem poczty elektronicznej (e-mail)",
        "eligibility.notes[2]":
          "Freebety nie łączą się ze sobą i nie podlegają łączeniu z innymi promocjami ani bonusami kursowymi.",
        "eligibility.notes[3]":
          "Warunkiem wykorzystania freebetów, o których mowa w pkt. 4 Regulaminu, jest dostosowanie przez gracza, przed skorzystaniem z Promocji, swojego dziennego i miesięcznego limitu stawki",
        "eligibility.notes[4]":
          "Dołącz do naszej społeczności na Discordzie i odbierz dodatkowy freebet 10 zł.",
        "effects[0].effect.amountPln":
          "otrzymają dwa bonusy w postaci: freebetu o wartości 50 zł oraz freebetu o wartości 20 zł.",
        "effects[0].effect.terms.odds.totalMin":
          "Freebet o wartości 50 zł może zostać wykorzystany na zawarcie jednego, dowolnego zakładu z oferty prematch lub live, z warunkiem minimalnego kursu całkowitego zakładu 2,50 i z dokładną stawką zakładu 50 zł.",
        "effects[0].effect.terms.validDays":
          "Gracz ma 7 dni na wykorzystanie każdego z freebetów, licząc od momentu jego pojawienia się na iKoncie.",
        "effects[0].effect.terms.winFactor": FREEBET_WSKAZNIK_QUOTE,
        "effects[0].effect.terms.stakeDeduction":
          "w przypadku, gdy gra się za środki z freebetu, wygrana będzie mniejsza o wartość freebetu niż w analogicznym Zakładzie postawionym za środki niepochodzące z freebetu.",
        "effects[1].effect.amountPln":
          "Freebet o wartości 20 zł może zostać wykorzystany wyłącznie za pośrednictwem aplikacji mobilnej Organizatora na zawarcie jednego, dowolnego zakładu z oferty prematch lub live, z warunkiem minimalnego kursu całkowitego zakładu 2,50 i z dokładną stawką zakładu 20 zł.",
        "effects[1].effect.terms.winFactor": FREEBET_WSKAZNIK_QUOTE,
        "stacking.combinableWith": "Zakład Bez Ryzyka do 200 zł + 85 zł we freebetach!",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "fortuna-bonusy-ako-2026",
    bookmaker: "fortuna",
    name: "Bonusy AKO 2026 Online",
    audience: "everyone",
    recurrence: { kind: "always_on" },
    validFrom: "2026-01-15T08:00:00+01:00",
    activation: { kind: "coupon_toggle" },
    eligibility: {
      betTypes: ["accumulator"],
      minLegs: 2,
      odds: { everyLegMin: 1.35 },
      fundsSource: "own_money_only",
      requiresConfirmation: [],
      couponAction: "Włącz suwak «Bonusy AKO 2026 Online» w sekcji bonusów pod kuponem",
      notes: [
        "Tylko piłka nożna, tenis, koszykówka, siatkówka, piłka ręczna i hokej.",
        "Warunki są sprawdzane też przy rozliczeniu: zwrot zdarzenia może obniżyć bonus do niższego progu albo go usunąć.",
        "Regulamin nazywa bonus «przelicznikiem kursowym», pytania i odpowiedzi piszą «+10% do kursu», a strona promocji «bonus do wygranej»; kwoty nie wyliczamy, dopóki nie sprawdzimy jej na kuponie.",
        "Nie obejmuje m.in. HIT DNIA, Mistrzowskiego Boosta, Gotowców, zakładów specjalnych, zakładu Bezpieczny, Maxikombi ani Early Cash Out.",
      ],
    },
    effects: [
      {
        effect: {
          type: "ACCA_BONUS",
          base: "total_odds",
          tiers: [
            { minLegs: 2, percent: 10 },
            { minLegs: 4, percent: 15 },
            { minLegs: 6, percent: 20 },
            { minLegs: 8, percent: 25 },
            { minLegs: 10, percent: 30 },
            { minLegs: 13, percent: 40 },
            { minLegs: 16, percent: 50 },
            { minLegs: 20, percent: 100 },
          ],
          qualifyingLegMinOdds: 1.35,
          paidAs: { kind: "cash" },
        },
        // Base unclear: "przelicznik kursowy" without a formula or example.
        valuation: "display_only",
      },
    ],
    stacking: { exclusiveGroup: "fortuna-bonus-kursowy", combinableWith: [] },
    source: {
      promoUrl: "https://www.efortuna.pl/bonus/ako-bonusy-2026",
      termsUrl: "https://api.efortuna.pl/pm/api/public/v1/promotion-definitions/6abf9063c44d9c75c5d4266d",
      publicTermsUrl: "https://www.efortuna.pl/bonus/ako-bonusy-2026",
      termsVersionDate: "2026-01-15",
      termsHash: "a0f67082dec32d31dbacbe97592cef2aada5604e419ff28e6303df2cc0969261",
      fetchedAt: "2026-11-07T01:12:22+01:00",
      evidence: {
        audience:
          "Promocja przeznaczona jest dla nowych i zarejestrowanych klientów, posiadających iKonto u Organizatora",
        recurrence: "REGULAMIN PROMOCJI „Bonusy AKO 2026 Online” obowiązujący od 15.01.2026 r. od godziny 8:00 do odwołania",
        validFrom: "REGULAMIN PROMOCJI „Bonusy AKO 2026 Online” obowiązujący od 15.01.2026 r. od godziny 8:00 do odwołania",
        activation:
          "Aby skorzystać z Promocji należy na etapie tworzenia Zakładu dodać bonus klikając właściwy suwak w sekcji ,,bonusy\" znajdującej się pod wybranymi przez gracza Zdarzeniami.",
        "eligibility.minLegs":
          "typu AKO, składającego się z minimum 2 zdarzeń, każde z kursem minimalnym 1,35",
        "eligibility.odds.everyLegMin":
          "Zakład musi być typu AKO, zawierać co najmniej 2 zdarzenia z kursem minimalnym 1,35 każde",
        // From the welcome freebet regulamin (www.efortuna.pl/bonus/oferta-powitalna).
        "eligibility.fundsSource":
          "Freebety nie łączą się ze sobą i nie podlegają łączeniu z innymi promocjami ani bonusami kursowymi.",
        "eligibility.notes[0]":
          "Dla oferty przedmeczowej (prematch) zdarzenia w ramach zakładu mogą dotyczyć wyłącznie następujących dyscyplin: Piłka nożna, Tenis, Koszykówka, Siatkówka, Piłka ręczna, Hokej;",
        "eligibility.notes[1]":
          "Aby bonus kursowy został przyznany, warunki otrzymania bonusu kursowego muszą być spełnione również w momencie rozliczenia zakładu",
        "eligibility.notes[2]": "Bonus zależy od liczby zdarzeń w kuponie: 2–3 zdarzeń: +10% do kursu",
        "effects[0].effect.base":
          "otrzymają bonus kursowy (przelicznik kursowy), którego wysokość uzależniona jest od liczby zdarzeń w ramach zawartego zakładu.",
        "effects[0].effect.tiers":
          "Wysokość bonusów kursowych wynosi: Liczba zdarzeń w ramach zakładu Bonus 1 - 2-3 + 10% 4-5 + 15% 6-7 + 20% 8-9 + 25% 10-12 + 30% 13-15 + 40% 16-19 + 50% 20+ + 100%",
        "effects[0].effect.qualifyingLegMinOdds": "Kurs każdego typu musi wynosić min. 1,35.",
        "stacking.exclusiveGroup":
          "Promocja na etapie tworzenia zakładu nie będzie zastępowana inną aktualną promocją z bonusem kursowym, a klient samodzielnie decyduje o włączeniu promocji, która jest dla niego najbardziej korzystna.",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "fortuna-betbuilder-bez-podatku",
    bookmaker: "fortuna",
    name: "Betbuilder bez podatku Online",
    audience: "everyone",
    recurrence: { kind: "always_on" },
    validFrom: "2026-08-10T12:00:00+02:00",
    activation: { kind: "coupon_toggle" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      fundsSource: "own_money_only",
      requiresConfirmation: [],
      couponAction: "Włącz suwak «Betbuilder bez podatku» pod kuponem",
      notes: [
        "Kupon musi składać się wyłącznie ze zdarzeń Betbuilder; kursów Betbuilder nie porównujemy, więc to tylko informacja.",
        "Nie obejmuje Maxikombi, zakładu Bezpieczny ani Early Cash Out.",
      ],
    },
    effects: [
      {
        effect: {
          type: "OTHER",
          description:
            "Kurs mnożony przez 1.14 na kuponach złożonych wyłącznie ze zdarzeń Betbuilder (wyrównanie podatku od stawki).",
        },
        valuation: "display_only",
      },
    ],
    stacking: { exclusiveGroup: "fortuna-bonus-kursowy", combinableWith: [] },
    source: {
      promoUrl: "https://www.efortuna.pl/bonus/betbuilder-bez-podatku",
      termsUrl: "https://api.efortuna.pl/cms-client/file/6a79b7ef2434e2287d2da1f4",
      termsVersionDate: "2026-08-10",
      termsHash: "5b48ba90873b9c013b169ac8963dbe93b4a00665054620b872f995b4465f7cfe",
      fetchedAt: "2026-11-07T01:16:39+01:00",
      evidence: {
        audience:
          "Niniejszy komunikat określa warunki zakładów w ramach oferty „Betbuilder bez podatku Online” urządzanych przez sieć Internet",
        recurrence: "obowiązujących od 10.08.2026 od godziny 12:00 do odwołania",
        validFrom: "obowiązujących od 10.08.2026 od godziny 12:00 do odwołania",
        activation:
          "Aby skorzystać z Oferty należy na etapie tworzenia Zakładu zaznaczyć właściwy suwak w sekcji znajdującej się pod wybranymi przez gracza Zdarzeniami.",
        "eligibility.fundsSource": "Oferta obejmuje zakłady zawierane za środki pieniężne.",
        "eligibility.notes[0]":
          "Warunki określone w niniejszej ofercie dotyczą wyłącznie zakładów przedmeczowych (prematch) albo live składających się tylko i wyłącznie ze Zdarzeń w ramach oferty Betbuilder.",
        "effects[0].effect.description":
          "Do zakładów z niniejszej oferty zostanie zastosowany przelicznik kursowy w wysokości 1,14.",
        "stacking.exclusiveGroup": "Oferta nie łączy się z promocją: • „Bonusy AKO 2026 Online”.",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "fortuna-safebet-90-00",
    bookmaker: "fortuna",
    name: "Safebet 90:00",
    audience: "everyone",
    recurrence: { kind: "always_on" },
    validFrom: "2026-08-10T00:00:00+02:00",
    activation: { kind: "automatic" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      fundsSource: "any",
      leagues: ["ekstraklasa", "premier-league", "laliga", "serie-a", "ligue-1"],
      markets: ["MATCH_WINNER"],
      requiresConfirmation: [],
      notes: [
        "Tylko zdarzenia oznaczone etykietą 90:00 i tylko zakłady przedmeczowe; nie dotyczy podwójnej szansy.",
        "W AKO zdarzenie rozliczane jest po kursie 1.00 zamiast przegranej; w SOLO zwracana jest stawka.",
      ],
    },
    effects: [
      {
        effect: {
          type: "REFUND_ON_CONDITION",
          condition: "typ 1X2 zgodny ze stanem meczu w 90:00, ale niezgodny z wynikiem końcowym",
          paidAs: { kind: "cash" },
        },
        // Needs a model of late goals; the scope also depends on the 90:00 label per match.
        valuation: "display_only",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://www.efortuna.pl/bonus/90-00",
      termsUrl: "https://api.efortuna.pl/cms-client/file/6a7988cc2434e2287d2da150",
      termsVersionDate: "2026-08-10",
      termsHash: "85756ee8d3b264136e6e4e67be1551decbd2d18d4cbf06815622d9916e373682",
      fetchedAt: "2026-11-07T01:16:18+01:00",
      evidence: {
        // From the promotion page (www.efortuna.pl/bonus/90-00).
        audience: "Promocja skierowana do pełnoletnich klientów Fortuny.",
        validFrom:
          "Wskazane w niniejszym Oficjalnym komunikacie zasady SAFEBETY 2.0 obowiązują dla Zakładów zawartych od dnia 10 sierpnia 2026 r.",
        // From the promotion FAQ (www.efortuna.pl/bonus/90-00).
        "eligibility.leagues":
          "Wszystkie mecze w topowych ligach: polskiej Ekstraklasa polskiej 1. Liga angielskiej Premier League niemieckiej Bundesliga hiszpańskiej La Liga włoskiej Serie A francuskiej Ligue 1",
        "eligibility.markets":
          "Zdarzeń „Wynik meczu” obejmujących wygraną Gospodarzy, remis albo wygraną Gości w ofercie prematch w kategorii Piłka nożna, oznaczonych etykietą „90:00” z uwzględnieniem oferty Betbuilder;",
        "eligibility.notes[0]": "Zakładów na Zdarzenie „Wynik meczu – podwójny typ”;",
        "effects[0].effect.condition":
          "jeżeli wytypowany wynik (wygrana Gospodarzy, remis albo wygrana Gości) jest zgodny ze stanem meczu w dokładnie 90:00 minucie i sekundzie spotkania jednak nie jest zgodny z końcowym oficjalnym wynikiem meczu.",
        "eligibility.notes[1]":
          "Zdarzenia typu „Wynik meczu” będą zwracane (zwrot stawki w przypadku zakładu SOLO) albo Zdarzenie rozliczane będzie z kursem 1.0 (w przypadku zakładu AKO)",
      },
    },
    review: VERIFIED,
    version: 1,
  },
];
