import type { Promotion, Wagering } from "../../types/promotions.js";

// Entries come from the research files and the live terms.
// Terms fetched 2026-11-07 (PDF regulaminy on scontent-static.sts.pl, Landingi pages on
// promocje.sts.pl, help articles on pomoc.sts.pl); quotes are verbatim from the normalized text.
// pomoc.sts.pl prints update dates as MM.DD.YYYY ("03.27.2026"), read that way below.

const VERIFIED = {
  status: "verified",
  verifiedAt: "2026-11-07T01:30:21+01:00",
  verifiedBy: "research-agent",
} as const;

// Welcome bonus wagering: 2x the bonus on the bonus account, total odds >= 1.91 at settlement.
const WELCOME_WAGERING: Wagering = {
  multiplier: 2,
  of: "bonus",
  ownFundsOnly: false,
  odds: { totalMin: 1.91 },
  depositLocked: true,
};

export const stsPromotions: Promotion[] = [
  {
    id: "sts-promocja-powitalna",
    bookmaker: "sts",
    name: "Promocja Powitalna",
    audience: "new_customer",
    recurrence: { kind: "one_time" },
    validFrom: "2024-03-19T00:00:00+01:00",
    activation: { kind: "join_button" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      fundsSource: "any",
      accountAgeDays: { to: 30 },
      requiresConfirmation: [
        { key: "sts_marketing_consents", label: "Mam włączone zgody marketingowe w STS", expires: "never" },
      ],
      notes: [
        "Zapis do promocji: zaznaczenie opcji w formularzu rejestracji.",
        "Wpłatę w części będącej podstawą bonusu można wypłacić po jednokrotnym obrocie nią (kupony z kursem całkowitym co najmniej 1.85).",
        "Na aktywację każdego bonusu jest 7 dni; naraz aktywny może być jeden bonus.",
        "Do obrotu bonusem nie liczą się m.in. MAXIKOMBI, Zakład Bezpieczny, kupony rozliczone przez Cash-out i zwroty po kursie 1.00.",
      ],
    },
    effects: [
      {
        effect: {
          type: "DEPOSIT_BONUS",
          depositIndex: 1,
          percent: 100,
          capPln: 100,
          // The terms state no minimum deposit for the bonus.
          minDepositPln: 0,
          paidAs: { kind: "bonus_funds", wagering: WELCOME_WAGERING },
        },
        valuation: "full",
      },
      {
        effect: {
          type: "DEPOSIT_BONUS",
          depositIndex: 2,
          percent: 50,
          capPln: 200,
          minDepositPln: 0,
          paidAs: { kind: "bonus_funds", wagering: WELCOME_WAGERING },
        },
        valuation: "full",
      },
      {
        effect: {
          type: "DEPOSIT_BONUS",
          depositIndex: 3,
          percent: 50,
          capPln: 300,
          minDepositPln: 0,
          paidAs: { kind: "bonus_funds", wagering: WELCOME_WAGERING },
        },
        valuation: "full",
      },
      {
        effect: {
          type: "TASK_REWARD",
          task: "6 zadań w ciągu 30 dni od założenia konta: 10 zł po 2, 20 zł po 4 i 30 zł po 6 zadaniach",
          rewardPln: 60,
          paidAs: { kind: "bonus_funds", wagering: WELCOME_WAGERING },
        },
        // The tasks themselves are defined in STS communications, not in the regulamin.
        valuation: "display_only",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://pomoc.sts.pl/promocja-powitalna/",
      termsUrl: "https://scontent-static.sts.pl/KIK/TW/2024/bonus-powitalny-pl_6616623a36e535.63998668.pdf",
      termsVersionDate: "2024-03-19",
      termsHash: "9e84a91e882eae3be9892e77cd2d707bc428e9e9602a6a43cd742b6f7d3b34d0",
      fetchedAt: "2026-11-07T01:08:40+01:00",
      evidence: {
        audience:
          "dokonała rejestracji i założyła stałe lub tymczasowe internetowe konto do zawierania zakładów wzajemnych zgodnie z Regulaminem Gry",
        activation:
          "Żeby wziąć udział w Akcji, Uczestnik – podczas rejestracji - musi zapisać się do Akcji poprzez zaznaczenie dedykowanej opcji prezentowanej przez Organizatora w formularzu rejestracji.",
        recurrence:
          "W Akcji brane są pod uwagę trzy pierwsze wpłaty dokonane przez Uczestnika na konto depozytowe po zarejestrowaniu konta i zapisaniu się do Akcji.",
        validFrom:
          "Akcja rozpoczyna się dnia 19.03.2024 roku o godz. 00:00 i trwa aż do jej zakończenia przez Organizatora.",
        "eligibility.accountAgeDays.to":
          "Zadaniem Uczestnika w ramach Akcji jest dokonanie wpłaty środków na konto depozytowe Uczestnika w terminie 30 dni od dnia poprawnej rejestracji",
        "eligibility.requiresConfirmation[0]":
          "wyraziła zgody marketingowe w zakresie wskazanym przez Organizatora przy dokonywaniu rejestracji",
        "eligibility.notes[1]":
          "wypłata takich środków możliwa jest dopiero po zawarciu przez Uczestnika i rozliczeniu zakładów wzajemnych za łączną stawkę odpowiadającą wartości takich środków z minimalnym kursem całkowitym wynoszącym 1,85",
        "eligibility.notes[2]":
          "Czas na aktywację każdego z Bonusów przyznanych w ramach Akcji wynosi 7 dni od dnia ich przyznania.",
        "eligibility.notes[3]":
          "Do obrotu nie są zaliczane kupony: MAXIKOMBI, zagrane z opcją Zakład bezpieczny, kupony wypłacone za pomocą opcji Cash-out oraz rozliczone przez Organizatora jako zwrot po kursie 1.0.",
        "effects[0].effect.percent":
          "100% Pierwszego Depozytu, nie więcej niż wysokość Bonusu Maksymalnego za Zadanie 50% Drugiego Depozytu, nie więcej niż wysokość Bonusu Maksymalnego za Zadanie 50% Trzeciego Depozytu",
        "effects[0].effect.capPln": "Pierwszy bonus: do 100 zł, czyli 100% wpłaty.",
        "effects[0].effect.paidAs.wagering":
          "za łączną stawkę odpowiadającą dwukrotności otrzymanego bonusu, z minimalnym kursem całkowitym wynoszącym 1.91.",
        "effects[1].effect.capPln": "Drugi bonus: do 200 zł, czyli 50% wpłaty.",
        "effects[2].effect.capPln": "Trzeci bonus: do 300 zł, czyli 50% wpłaty.",
        "effects[2].effect":
          "Wysokość Bonusu Maksymalnego za Zadanie 100,00 PLN 200,00 PLN 300,00 PLN",
        "effects[3].effect.rewardPln": "Bonusy otrzymasz po wykonaniu kolejno: 2 zadań – 10 zł; 4 zadań – 20 zł; 6 zadań – 30 zł.",
        "effects[3].effect.task": "Na wykonanie wszystkich zadań masz 30 dni od założenia konta.",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "sts-zaklad-bez-ryzyka",
    bookmaker: "sts",
    name: "Zakład bez Ryzyka 100 PLN",
    audience: "new_customer",
    recurrence: { kind: "one_time" },
    validFrom: "2024-04-09T00:00:00+02:00",
    activation: { kind: "registration_code", code: "STS100" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      fundsSource: "own_money_only",
      accountAgeDays: { to: 7 },
      requiresConfirmation: [],
      notes: [
        "Liczy się tylko pierwszy zakład z konta depozytowego po rejestracji; wpłata i zakład w ciągu 7 dni od dnia rejestracji.",
        "Nie liczą się zakłady rozliczone przez Cash-out, STS Bezpieczny, Superoferta, MaxiKombi, Hit dnia, Mecz dnia, Podwyższony kurs ani zwroty po kursie 1.00.",
        "Kod promocyjny z listy kodów akcji trzeba wpisać przy rejestracji; jeden zwrot na osobę.",
      ],
    },
    effects: [
      {
        effect: {
          type: "REFUND_ON_LOSS",
          percent: 100,
          base: "gross_stake",
          capPln: 100,
          paidAs: { kind: "cash" },
          firstCouponOnly: true,
        },
        valuation: "full",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://promocje.sts.pl/",
      termsUrl: "https://promocje.sts.pl/regulamin-260713-regulamin-zbr-100",
      termsVersionDate: "2026-08-03",
      termsHash: "64ee7608a4425b4d72a6acc452fbd96532fbb735519773a1095d9d685a10dc62",
      fetchedAt: "2026-11-07T01:08:41+01:00",
      evidence: {
        audience:
          "która w trakcie trwania Akcji założy internetowe konto do zawierania zakładów wzajemnych zgodnie z zasadami określonymi w Regulaminie Gry",
        recurrence: "Jeden Uczestnik może otrzymać tylko jeden zwrot w ramach Akcji.",
        validFrom: "Akcja rozpoczyna się dnia 09.04.2024 i trwa do odwołania przez Organizatora.",
        activation: "podczas rejestracji wpisać jeden spośród kodów aktywnych w Akcji.",
        // From the code list (promocje.sts.pl/zbr-100pln-lista-kodow).
        "activation.code": "SPORTVIP, STARTBONUS, STREFAMMA, STS100, STSBETGAMES",
        "eligibility.accountAgeDays.to":
          "w terminie nieprzekraczającym 7 (siedmiu) dni od dnia rejestracji, o której mowa w lit. a powyżej, dokonać łącznie: wpłaty pierwszego depozytu i zawarcia zakładu SOLO lub AKO",
        "eligibility.fundsSource":
          "z wykorzystaniem środków zgromadzonych na koncie depozytowym Uczestnika z oferty przedmeczowej lub live",
        "eligibility.notes[1]":
          "W Akcji nie są brane pod uwagę zakłady, które zostały wypłacone przy użyciu mechanizmu Cash-out, zakłady STS Bezpieczny, Superoferta, MaxiKombi, Hit dnia, Mecz dnia, Podwyższony kurs",
        "effects[0].effect.percent":
          "Uczestnik otrzyma od Organizatora zwrot odpowiadający pełnej wysokości Wkładu Klienta uiszczonego na poczet zawarcia zakładu wzajemnego, jednakże nie więcej niż 100 zł",
        "effects[0].effect.base":
          "Wypłacany zwrot w Akcji będzie odpowiadał kwocie Wkładu, a więc będzie wynosić 100 PLN",
        "effects[0].effect.capPln": "jednakże nie więcej niż 100 zł",
        "effects[0].effect.paidAs":
          "Pod warunkiem spełnienia warunków Akcji, w tym w szczególności wykonania Zadań, Zwrot nastąpi na konto depozytowe Uczestnika.",
        "effects[0].effect.firstCouponOnly":
          "brany jest pod uwagę wyłącznie pierwszy zakład zawarty przez Uczestnika z wykorzystaniem środków z konta depozytowego po założeniu internetowego konta Uczestnika",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "sts-zaklad-bezpieczny",
    bookmaker: "sts",
    name: "Zakład Bezpieczny",
    audience: "everyone",
    recurrence: { kind: "always_on" },
    activation: { kind: "coupon_toggle" },
    eligibility: {
      betTypes: ["accumulator"],
      minLegs: 10,
      odds: { everyLegMin: 1.3 },
      fundsSource: "own_money_only",
      requiresConfirmation: [],
      couponAction: "Przesuń suwak Zakładu Bezpiecznego na kuponie STS",
      notes: [
        "Kupon musi mieć co najmniej 10 zakładów z kursem minimum 1.30; gdy zwroty zmniejszą tę liczbę poniżej 10, kupon traci status Zakładu Bezpiecznego.",
        "Zakład Bezpieczny nie liczy się do obrotu bonusem.",
      ],
    },
    effects: [
      {
        effect: {
          type: "REFUND_ON_ONE_MISS",
          minLegs: 10,
          // Unknown: the help article states no cap and STS publishes no regulamin for this product.
          capPln: 0,
          paidAs: { kind: "cash" },
        },
        valuation: "display_only",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://pomoc.sts.pl/zaklad-bezpieczny/",
      termsUrl: "https://pomoc.sts.pl/zaklad-bezpieczny/",
      termsVersionDate: "2026-03-27",
      termsHash: "e2caf515258dc82cd3369e045838382de983df15048b3fb8d699c9654e952d1d",
      fetchedAt: "2026-11-07T01:08:42+01:00",
      evidence: {
        audience: "Zakład Bezpieczny dostępny jest na aplikacji oraz stronie sts.pl",
        recurrence: "Zakład bezpieczny możesz zagrać z ofertą przedmeczową oraz LIVE.",
        activation: "Wystarczy przesunąć suwak w prawo i gotowe - możesz już obstawić swój Zakład Bezpieczny.",
        "eligibility.minLegs": "co najmniej 10 zakładów z minimalnym kursem 1.30 kupon zagrany z konta depozytowego",
        "eligibility.notes[0]":
          "Jeżeli na kuponie niektóre zakłady zostaną rozliczone jako zwroty, przez co liczba zakładów z kursem min. 1.30 spadnie poniżej 10. - kupon straci status Zakładu Bezpiecznego .",
        "eligibility.notes[1]": "Należy pamiętać, że Zakład Bezpieczny nie jest brany pod uwagę do obrotu bonusem!",
        "effects[0].effect":
          "Gdy na kuponie jeden z zakładów zostanie rozliczony jako przegrany otrzymasz zwrot stawki za kupon.",
      },
    },
    // Draft: REFUND_ON_ONE_MISS needs capPln and the source names none; "zwrot stawki" may mean the
    // stake after the 12% tax (STS's own definition of "stawka"), so the refund base is open too.
    review: { status: "draft" },
    version: 1,
  },
  {
    id: "sts-game-changer",
    bookmaker: "sts",
    name: "Game Changer",
    audience: "everyone",
    recurrence: { kind: "always_on" },
    activation: { kind: "automatic" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      fundsSource: "any",
      requiresConfirmation: [],
      notes: [
        "Tylko mecze oznaczone w STS ikoną Game Changer (ponad 80 lig i rozgrywek); tego oznaczenia nie widzimy.",
        "Tylko zakłady przedmeczowe; przy podwójnej szansie obejmuje 1X i X2, nie obejmuje 12.",
      ],
    },
    effects: [
      {
        effect: { type: "EARLY_WIN", rule: "two_goal_lead", markets: ["MATCH_WINNER", "DOUBLE_CHANCE"] },
        // Which matches carry the icon is not published as data.
        valuation: "display_only",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://www.sts.pl/blog/game-changer-sts-superprzewaga/",
      termsUrl: "https://pomoc.sts.pl/game-changer/",
      termsVersionDate: "2026-02-03",
      termsHash: "e5b444ee228de2c9889f626bc4881c5a4a1c1f62143556a727d641e476d4b2ff",
      fetchedAt: "2026-11-07T01:09:56+01:00",
      evidence: {
        // From the promo article (www.sts.pl/blog/game-changer-sts-superprzewaga).
        audience:
          "Tak naprawdę każdy gracz zakładów bukmacherskich jest trzy kroki od wykorzystania Game Changera na mecze piłki nożnej.",
        "eligibility.notes[0]":
          "Promocja obejmuje wyłącznie wybrane mecze piłki nożnej postawione przed ich rozpoczęciem z oferty przedmeczowej (ikona ).",
        "eligibility.notes[1]": "Promocja nie działa na zakłady na żywo (LIVE) oraz na kupony postawione w punktach stacjonarnych.",
        "effects[0].effect.rule": "Jeśli wytypowana drużyna będzie prowadzić dwoma golami , kupon wygrywa.",
        "effects[0].effect.markets": "zakłady z podpórką 1X i X2 (w przypadku zakładu 12 Game Changer nie działa)",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "sts-club",
    bookmaker: "sts",
    name: "STS Club",
    audience: "everyone",
    loyaltyProgram: true,
    recurrence: { kind: "always_on" },
    activation: { kind: "join_button" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      fundsSource: "any",
      requiresConfirmation: [],
      notes: ["STS Coinsy są ważne 180 dni od otrzymania."],
    },
    effects: [
      {
        effect: {
          type: "OTHER",
          description:
            "STS Coinsy za zadania początkowe, dzienne i tygodniowe, wymieniane na nagrody: bonusy, Winboostery, koszulki i elektronikę.",
        },
        valuation: "display_only",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://pomoc.sts.pl/sts-club/",
      termsUrl: "https://pomoc.sts.pl/sts-club/",
      termsVersionDate: "2026-04-20",
      termsHash: "06ea131bf4801b0dfaab1bc6c6c8d114168c26175097c33c75b1dd9a30a017bd",
      fetchedAt: "2026-11-07T01:08:44+01:00",
      evidence: {
        audience: "Jeżeli masz już swoje konto i spełniasz powyższe warunki, otrzymasz automatycznie STS Coinsy!",
        recurrence:
          "STS Club to program lojalnościowy , w którym za wykonanie zadań możesz codziennie zgarnąć STS Coinsy!",
        activation: "Przejdź do zakładki z ,,Profilem gracza\". Wybierz ,,STS Club\". ,,Dołącz teraz” - i gotowe!",
        "eligibility.notes[0]": "Każdy STS Coins jest ważny przez 180 dni od momentu otrzymania.",
        "effects[0].effect.description":
          "Wykonując zadania, możesz zdobyć 4 rodzaje nagród: bonusy , np. 5, 10, 50 zł, udział w promocji Winbooster , koszulki piłkarskie , np. reprezentacji Polski, elektronikę , np. smartwatche.",
      },
    },
    review: VERIFIED,
    version: 1,
  },
  {
    id: "sts-bonuseria",
    bookmaker: "sts",
    name: "BonuSeria",
    audience: "everyone",
    recurrence: { kind: "always_on" },
    activation: { kind: "join_button" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      odds: { totalMin: 2.5 },
      fundsSource: "own_money_only",
      requiresConfirmation: [
        { key: "sts_verified_account", label: "Mam zweryfikowane konto w STS", expires: "never" },
      ],
      couponAction: "Wybierz BonuSerię w menu promocji na kuponie STS",
      notes: [
        "Nie liczą się Sporty Wirtualne, BetGames ani kupony rozliczone przez Cash-Out.",
        "Zmiana warunków serii zeruje postęp.",
      ],
    },
    effects: [
      {
        effect: {
          type: "OTHER",
          description:
            "Codzienny kupon z konta depozytowego przez wybraną liczbę dni i za wybraną stawkę; nagroda w bonusie od 3 zł do 500 zł zależnie od długości serii.",
        },
        // Reward table per stake and series length is not published.
        valuation: "display_only",
      },
    ],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://pomoc.sts.pl/bonuseria/",
      termsUrl: "https://pomoc.sts.pl/bonuseria/",
      termsVersionDate: "2026-05-12",
      termsHash: "ddb062ce97e4267b100f584b22c73700100818f0f61b6ebd3a77a7966f5015b0",
      fetchedAt: "2026-11-07T01:08:45+01:00",
      evidence: {
        audience: "BonuSeria to promocja dla zweryfikowanych graczy.",
        recurrence: "Jeżeli przerwiesz serię, nic się nie stało, możesz rozpocząć ją od nowa, w każdej chwili.",
        activation: "Do BonuSerii zapiszesz się w zakładce \"Promocje\". Następnie należy kliknąć \"Rozpocznij serię\".",
        "eligibility.odds.totalMin": "Każdy kupon musi mieć kurs minimum 2.50 .",
        "eligibility.fundsSource":
          "Do serii zaliczają się wszystkie kupony zawarte z konta depozytowego oprócz Sportów Wirtualnych, BetGames oraz kuponów rozliczonych poprzez Cash-Out.",
        "eligibility.couponAction":
          "Pamiętaj, aby na ekranie tworzenia zakładu wybierać BonuSerię z menu promocji.",
        "eligibility.notes[1]":
          "Możesz zmienić warunki swojej serii w każdej chwili, ale pamiętaj, że wtedy Twoje obecne postępy zostaną wyzerowane i zaczniesz od dnia pierwszego.",
        "effects[0].effect.description":
          "Im dłuższą serię utrzymasz, tym wyższą nagrodę otrzymasz – możesz zgarnąć od 3 zł aż do 500 zł !",
      },
    },
    review: VERIFIED,
    version: 1,
  },
];
