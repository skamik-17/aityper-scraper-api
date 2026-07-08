import type {
  BookmakerMarketNormalizer,
  NormalizationContext,
  NormalizedMarketOutput,
  NormalizedMarketType,
  NormalizedSelection,
  RawBookmakerMarket,
} from "../types.js";
import {
  buildMarketKey,
  canonicalizePlayerName,
  normalize1x2Selection,
  normalizeDoubleChanceSelection,
  normalizeMarketName,
  normalizeOddEvenSelection,
  normalizeOverUnderSelection,
  normalizeYesNoSelection,
  parseDecimalLine,
  parseHandicapLine,
  parseHtFtSelection,
  parseIntegerLine,
  parseOverUnderLine,
  parseScoreSelection,
} from "../helpers/index.js";
import { getMarketMetadata, isValidMarketCode, getMarketByCode } from "../../../data/market-catalog.js";

/**
 * Superbet market-type id -> catalog code.
 *
 * Verified against the live Superbet offer API (production-superbet-offer-pl,
 * /v2/pl-PL/events/{id}) which exposes the authoritative `marketName` per id.
 * Ids whose real market has no catalog counterpart are mapped to "OTHER" so
 * they never pollute a wrong market (minute-interval micro markets, exotic
 * combos, etc.).
 */
const SUPERBET_MARKET_ID_TO_CODE: Record<number, NormalizedMarketType> = {
  // ===== Match result / double chance / draw no bet =====
  547: "MATCH_WINNER", // "Mecz"
  548: "DOUBLE_CHANCE", // listing endpoint alias
  531: "DOUBLE_CHANCE", // "Podwójna szansa"
  554: "HALF_TIME_DOUBLE_CHANCE", // "1.połowa - podwójna szansa"
  573: "SECOND_HALF_DOUBLE_CHANCE", // "2.połowa - podwójna szansa"
  562: "HALF_TIME_RESULT", // "1.połowa - 1X2"
  560: "SECOND_HALF_RESULT", // "2.połowa - 1X2"
  555: "DRAW_NO_BET", // "Zakład bez remisu"
  563: "HALF_TIME_DRAW_NO_BET", // "1.połowa - zakład bez remisu"
  572: "SECOND_HALF_DRAW_NO_BET", // "2.połowa - zakład bez remisu"
  239944: "KICKOFF_TEAM", // "Drużyna rozpocznie mecz"
  2365: "DOUBLE_RESULT", // "1. połowa/mecz"
  201521: "DOUBLE_RESULT_PAIR", // "1. połowa/mecz - podwójna szansa"
  200914: "HT_OR_FT_RESULT", // "1. połowa lub mecz"
  200791: "MULTI_RESULT", // "Multiwynik"
  200748: "OTHER", // "Wynik dowolnej połowy meczu" - no catalog counterpart

  // ===== BTTS family =====
  539: "BTTS", // "Obie drużyny strzelą"
  559: "BTTS", // listing endpoint alias
  565: "HALF_TIME_BTTS", // "1.połowa - obie drużyny strzelą"
  549: "SECOND_HALF_BTTS", // "2.połowa - obie drużyny strzelą"
  200733: "BTTS_2PLUS_GOALS", // "Obie drużyny strzelą powyżej 1.5 gola"
  200751: "BTTS_AT_LEAST_ONE_HALF", // "Obie drużyny strzelą w przynajmniej jednej połowie"
  200772: "BTTS_BY_HALF", // "Obie drużyny strzelą gola - 1.połowa/2.połowa"
  201501: "BTTS_OR_OVER_2_5", // "Obie drużyny strzelą gola lub powyżej 2.5 gola"
  201502: "OTHER", // BTTS or over 3.5 - no catalog counterpart
  201503: "OTHER", // BTTS and over 2.5 - no catalog counterpart
  201504: "OTHER", // BTTS and over 3.5 - no catalog counterpart
  231006: "OTHER", // "{home} wygra lub obie strzelą" - side would be lost
  231007: "DRAW_OR_BTTS", // "Remis lub obie drużyny strzelą gola"
  231008: "OTHER", // "{away} wygra lub obie strzelą" - side would be lost
  231009: "OTHER", // "{home} wygra lub czyste konto" - no catalog counterpart
  231010: "DRAW_OR_CLEAN_SHEET", // "Remis lub którakolwiek drużyna zachowa czyste konto"
  231011: "OTHER", // "{away} wygra lub czyste konto" - no catalog counterpart
  232509: "BOTH_HALVES_GOALS", // "Gol w obu połowach"

  // ===== Goals - totals =====
  200734: "TOTAL_GOALS", // "Liczba goli"
  552: "TOTAL_GOALS", // listing endpoint alias
  200735: "HALF_TIME_TOTAL_GOALS", // "1.połowa - liczba goli"
  200738: "SECOND_HALF_TOTAL_GOALS", // "2.połowa - liczba goli"
  544: "HOME_TEAM_TOTAL_GOALS", // "{home} - liczba goli"
  535: "AWAY_TEAM_TOTAL_GOALS", // "{away} - liczba goli"
  2529: "HALF_TIME_HOME_TEAM_TOTAL_GOALS", // "1.połowa - {home} - liczba goli"
  2531: "HALF_TIME_AWAY_TEAM_TOTAL_GOALS", // "1.połowa - {away} - liczba goli"
  201506: "SECOND_HALF_HOME_TEAM_TOTAL_GOALS", // "2.połowa - {home} - liczba goli"
  201507: "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS", // "2.połowa - {away} - liczba goli"
  543: "ODD_EVEN_GOALS", // "Nieparzysta/parzysta liczba goli"
  200241: "HALF_TIME_ODD_EVEN_GOALS", // "1.połowa - liczba goli nieparzysta/parzysta"
  200243: "HOME_TEAM_ODD_EVEN_GOALS", // "{home} - liczba goli nieparzysta/parzysta"
  200236: "AWAY_TEAM_ODD_EVEN_GOALS", // "{away} - liczba goli nieparzysta/parzysta"
  200742: "OWN_GOALS_TOTAL", // "Liczba goli samobójczych"
  200248: "GOAL_BY_MINUTE", // "Liczba goli - do X minuty"
  200247: "RESULT_AT_MINUTE", // "Mecz - do X minuty"
  231000: "OTHER", // "{home} wygra lub powyżej X goli" - side would be lost
  231001: "OTHER", // "{home} wygra lub poniżej X goli" - side would be lost
  231002: "OTHER", // "Remis lub powyżej X goli" - only 2.5 exists in catalog
  231003: "OTHER", // "Remis lub poniżej X goli" - no catalog counterpart
  231004: "OTHER", // "{away} wygra lub powyżej X goli" - side would be lost
  231005: "OTHER", // "{away} wygra lub poniżej X goli" - side would be lost
  693: "OTHER", // "Liczba goli od X:00 do Y:59 minuty" - minute intervals
  715: "OTHER", // minute-interval goals
  729: "OTHER", // minute-interval goals
  705: "OTHER", // "Gole od X do Y minuty"
  697: "OTHER", // "Mecz od 0:00 do 14:59 minuty"
  725: "OTHER", // "Mecz od X do Y minuty"

  // ===== Goals - ranges / exact =====
  200807: "GOAL_RANGE", // "Przedział goli"
  200818: "HOME_GOAL_RANGE", // "{home} - przedział goli"
  200831: "AWAY_GOAL_RANGE", // "{away} - przedział goli"
  200820: "HALF_TIME_GOAL_RANGE", // "1. połowa - przedział goli"
  200829: "SECOND_HALF_GOAL_RANGE", // "2.Połowa - przedział goli"
  200758: "HALF_TIME_TEAM_GOAL_RANGE", // "1.połowa - {home} przedział goli"
  200759: "HALF_TIME_TEAM_GOAL_RANGE", // "1.połowa - {away} przedział goli"
  200760: "SECOND_HALF_TEAM_GOAL_RANGE", // "2.połowa - {home} przedział goli"
  200761: "SECOND_HALF_TEAM_GOAL_RANGE", // "2.połowa - {away} przedział goli"
  201803: "OTHER", // "Przedział goli w każdej połowie" - no catalog counterpart
  201804: "OTHER", // team variant of the above
  201805: "OTHER", // team variant of the above
  558: "HALF_TIME_HOME_EXACT_GOALS", // "1.połowa - {home} - dokładna liczba goli"

  // ===== First/last goal =====
  538: "FIRST_TEAM_TO_SCORE", // "1. gol"
  200803: "LAST_TEAM_TO_SCORE", // "Ostatni gol"
  556: "HALF_TIME_FIRST_GOAL", // "1. połowa - 1. gol"
  735: "FIRST_GOAL_TIME", // "1. gol (przedziały 10-minutowe)"
  727: "FIRST_GOAL_TIME_ALT", // "1. gol (przedziały 15-minutowe)"
  2370: "FIRST_GOAL_METHOD", // "Sposób zdobycia 1. gola"
  200810: "FIRST_GOAL_AND_RESULT", // "1. gol & mecz"

  // ===== Halves =====
  574: "HALF_WITH_MORE_GOALS", // "Połowa z większą liczbą goli"
  200813: "HOME_HALF_WITH_MOST_GOALS", // "Połowa z największą liczbą goli {home}"
  200827: "AWAY_HALF_WITH_MOST_GOALS", // "Połowa z największą liczbą goli {away}"
  200830: "HOME_WIN_BOTH_HALVES", // "{home} wygra obie połowy"
  200794: "AWAY_WIN_BOTH_HALVES", // "{away} wygra obie połowy"
  200809: "HOME_WIN_AT_LEAST_ONE_HALF", // "{home} wygra przynajmniej jedną połowę"
  200826: "AWAY_WIN_AT_LEAST_ONE_HALF", // "{away} wygra przynajmniej jedną połowę"
  200811: "HOME_SCORE_BOTH_HALVES", // "{home} zdobędzie gola w obu połowach"
  200821: "AWAY_SCORE_BOTH_HALVES", // "{away} zdobędzie gola w obu połowach"

  // ===== Handicaps =====
  200736: "ASIAN_HANDICAP", // "Handicap"
  200737: "FIRST_HALF_ASIAN_HANDICAP", // "1.połowa - handicap"
  200739: "SECOND_HALF_ASIAN_HANDICAP", // "2.połowa - handicap"
  546: "EUROPEAN_HANDICAP", // "Handicap 1X2" (score-notation lines "A:B")
  550: "EUROPEAN_HANDICAP", // listing endpoint alias
  553: "FIRST_HALF_EUROPEAN_HANDICAP", // "1.połowa - handicap 1x2"
  551: "SECOND_HALF_EUROPEAN_HANDICAP", // "2.połowa - handicap 1X2"
  732: "CORNERS_HANDICAP", // "Rzuty rożne handicap"
  872: "HALF_TIME_CORNERS_HANDICAP", // "1. połowa - rzuty rożne - handicap"
  232924: "CARDS_HANDICAP", // "Liczba kartek - handicap"
  238707: "HALF_TIME_CARDS_HANDICAP", // "1. połowa - liczba kartek - handicap"
  201589: "SHOTS_HANDICAP", // "Strzały - Handicap"
  200701: "SHOTS_ON_TARGET_HANDICAP", // "Liczba celnych strzałów - handicap"
  201613: "HALF_TIME_SHOTS_HANDICAP", // "1. połowa - liczba strzałów - handicap"
  230932: "GOAL_KICKS_HANDICAP", // "Wybicia od bramki - handicap"
  200713: "OFFSIDES_HANDICAP", // "Liczba spalonych - handicap"

  // ===== Correct score =====
  200741: "CORRECT_SCORE", // "Dokładny wynik"
  537: "CORRECT_SCORE", // listing endpoint alias
  239911: "CORRECT_SCORE", // legacy alias
  1079: "HALF_TIME_CORRECT_SCORE", // "1.połowa - dokładny wynik"
  200819: "SECOND_HALF_CORRECT_SCORE", // "2. połowa - dokładny wynik"
  200815: "HT_FT_CORRECT_SCORE", // "1. połowa/mecz - dokładny wynik"
  240128: "ANYTIME_CORRECT_SCORE", // "Dokładny wynik w dowolnym momencie"

  // ===== Combos =====
  532: "RESULT_AND_BTTS", // "Mecz & obie drużyny strzelą"
  533: "DOUBLE_CHANCE_BTTS", // "Podwójna szansa & obie drużyny strzelą"
  557: "RESULT_AND_TOTAL", // "Mecz & liczba goli (X)"
  542: "DOUBLE_CHANCE_TOTAL", // "Podwójna szansa & liczba goli (X)"
  200571: "TOTAL_GOALS_AND_BTTS", // "Liczba goli & obie drużyny strzelą"
  200773: "RESULT_OR_TOTAL", // "Mecz lub liczba goli (X)"
  // "Mecz lub 1.połowa liczba goli (X)" combines the FULL-match result with a
  // FIRST-HALF goals line - mapping it to the full-match RESULT_OR_TOTAL mixed
  // two different bet definitions. No catalog counterpart exists.
  201519: "OTHER",
  201511: "HALFTIME_FULLTIME_AND_TOTAL", // "1. połowa/mecz & liczba goli (X)"
  200752: "RESULT_AND_GOAL_RANGE", // "Mecz & przedział goli"
  200764: "DOUBLE_CHANCE_GOAL_RANGE", // "Podwójna szansa & przedział goli"
  200755: "OTHER", // "Mecz & {home} liczba goli" - no catalog counterpart
  200756: "OTHER", // "Mecz & {away} liczba goli" - no catalog counterpart
  200762: "OTHER", // "Mecz & gol w każdej połowie" - no catalog counterpart
  200768: "OTHER", // "Podwójna szansa & gol w każdej połowie" - no catalog counterpart

  // ===== Corners =====
  704: "CORNERS_TOTAL", // "Liczba rzutów rożnych"
  878: "HALF_TIME_CORNERS_TOTAL", // "1. połowa - liczba rzutów rożnych"
  713: "CORNERS_TEAM", // "{home} - liczba rzutów rożnych"
  733: "CORNERS_TEAM", // "{away} - liczba rzutów rożnych"
  685: "CORNERS_TEAM", // "{home} - przedział rzutów rożnych"
  739: "CORNERS_TEAM", // "{away} - przedział rzutów rożnych"
  873: "HALF_TIME_CORNERS_TEAM", // "1. połowa - {home} liczba rzutów rożnych"
  884: "HALF_TIME_CORNERS_TEAM", // "1. połowa - {away} liczba rzutów rożnych"
  699: "CORNERS_RANGE", // "Liczba rzutów rożnych - przedziały"
  875: "HALF_TIME_CORNERS_RANGE", // "1.połowa - przedział rzutów rożnych"
  702: "CORNERS_ODD_EVEN", // "Nieparzysta/parzysta liczba rzutów rożnych"
  880: "HALF_TIME_CORNERS_ODD_EVEN", // "1.połowa - nieparzysta/parzysta liczba rożnych"
  717: "CORNERS_RACE", // "Liczba rzutów rożnych - H2H"
  882: "HALF_TIME_CORNERS_RACE", // "1. połowa - najwięcej rzutów rożnych"
  706: "NTH_CORNER", // "Kto pierwszy wykona X rzutów rożnych"
  232535: "FIRST_CORNER", // "Kto wykona 1. rzut rożny"
  200684: "LAST_CORNER", // "Ostatni rzut rożny"
  881: "OTHER", // "1.połowa - kto pierwszy wykona X rożnych" - no catalog counterpart
  711: "OTHER", // minute-interval corners count
  731: "OTHER", // minute-interval corners 1X2

  // ===== Cards =====
  690: "CARDS_TOTAL", // "Liczba kartek"
  1009: "HALF_TIME_CARDS_TOTAL", // "1. połowa - liczba kartek"
  700: "CARDS_TEAM", // "{home} - liczba kartek"
  708: "CARDS_TEAM", // "{away} - liczba kartek"
  1010: "HALF_TIME_HOME_TEAM_TOTAL_CARDS", // "1. połowa - {home} liczba kartek"
  1007: "HALF_TIME_AWAY_TEAM_CARDS", // "1. połowa - {away} liczba kartek"
  696: "CARDS_RACE", // "Najwięcej kartek"
  200840: "HALF_TIME_CARDS_RACE", // "1. połowa - najwięcej kartek"
  200246: "FIRST_CARD", // "1. kartka"
  233941: "RED_CARDS_TOTAL", // "Liczba czerwonych kartek"
  233942: "OTHER", // "{home} liczba czerwonych kartek" - no catalog counterpart
  233943: "OTHER", // "{away} liczba czerwonych kartek" - no catalog counterpart
  231045: "OTHER", // "Każda z drużyn powyżej X kartek - tak/nie" shape mismatch
  695: "OTHER", // minute-interval cards count
  723: "OTHER", // minute-interval cards 1X2

  // ===== Shots / fouls / offsides / throw-ins / goal kicks / saves =====
  201586: "MOST_SHOTS", // "Najwięcej strzałów"
  200698: "MOST_SHOTS_ON_TARGET", // "Najwięcej celnych strzałów"
  201587: "FIRST_SHOT", // "1. strzał"
  200699: "FIRST_SHOT_ON_TARGET", // "1. celny strzał"
  200702: "TOTAL_SHOTS_ON_TARGET", // "Liczba celnych strzałów"
  200703: "TEAM_TOTAL_SHOTS_ON_TARGET", // "Liczba celnych strzałów - {home}"
  200704: "TEAM_TOTAL_SHOTS_ON_TARGET", // "Liczba celnych strzałów - {away}"
  201526: "HALF_TIME_TOTAL_SHOTS_ON_TARGET", // "1. połowa - liczba celnych strzałów"
  201591: "TEAM_TOTAL_SHOTS", // "Liczba strzałów {home}"
  201592: "TEAM_TOTAL_SHOTS", // "Liczba strzałów {away}"
  201614: "OTHER", // "1. połowa - liczba strzałów" - no catalog counterpart
  201615: "OTHER", // "1. połowa - {home} liczba strzałów" - no catalog counterpart
  201616: "OTHER", // "1. połowa - {away} liczba strzałów" - no catalog counterpart
  200709: "EACH_TEAM_TOTAL_SHOTS_ON_TARGET_OVER", // "Każda z drużyn powyżej X celnych strzałów"
  201597: "OTHER", // "Każda z drużyn powyżej X strzałów" - no catalog counterpart
  201610: "OTHER", // "1. połowa - najwięcej strzałów" - no catalog counterpart
  230900: "THROW_INS_TOTAL", // "Liczba rzutów z autu"
  230901: "HOME_TEAM_TOTAL_THROW_INS", // "Liczba rzutów z autu - {home}"
  230902: "AWAY_TEAM_TOTAL_THROW_INS", // "Liczba rzutów z autu - {away}"
  230909: "OTHER", // "1. połowa - liczba rzutów z autu" - no catalog counterpart
  230910: "OTHER", // HT team throw-ins - no catalog counterpart
  230911: "OTHER", // HT team throw-ins - no catalog counterpart
  230904: "OTHER", // "Każda drużyna powyżej X rzutów z autu" - no catalog counterpart
  200690: "FOULS_TOTAL", // "Liczba fauli"
  200691: "HOME_TEAM_TOTAL_FOULS", // "Liczba fauli - {home}"
  200692: "AWAY_TEAM_TOTAL_FOULS", // "Liczba fauli - {away}"
  201568: "HALF_TIME_FOULS_TOTAL", // "1. połowa - liczba fauli"
  201569: "HALF_TIME_HOME_TEAM_FOULS_TOTAL", // "1. połowa - {home} liczba fauli"
  200687: "OTHER", // "1. faul" - no catalog counterpart
  200697: "BOTH_TEAMS_FOULS_OVER", // "Każda z drużyn powyżej X fauli"
  201659: "CLEARANCES_TOTAL", // "Liczba odbiorów"
  201660: "TEAM_TOTAL_TACKLES", // "{home} - liczba odbiorów"
  201661: "TEAM_TOTAL_TACKLES", // "{away} - liczba odbiorów"
  201683: "OTHER", // "1. połowa - liczba odbiorów" - no catalog counterpart
  201684: "OTHER", // "1. połowa - {home} liczba odbiorów" - no catalog counterpart
  201656: "OTHER", // "1. odbiór" - no catalog counterpart
  200714: "OFFSIDES_TOTAL", // "Liczba spalonych"
  200715: "HOME_TEAM_TOTAL_OFFSIDES", // "Spalone - {home}"
  200716: "AWAY_TEAM_TOTAL_OFFSIDES", // "Spalone - {away}"
  200721: "EACH_TEAM_OFFSIDES", // "Każda z drużyn powyżej X spalonych"
  200711: "FIRST_OFFSIDE", // "1. spalony"
  201763: "OTHER", // "1. połowa - liczba spalonych" - no catalog counterpart
  201765: "OTHER", // "1. połowa - {away} liczba spalonych" - no catalog counterpart
  230933: "GOAL_KICKS_TOTAL", // "Liczba wybić od bramki"
  230934: "HOME_TEAM_TOTAL_GOAL_KICKS", // "Liczba wybić z bramki {home}"
  230935: "AWAY_TEAM_GOAL_KICKS", // "Liczba wybić z bramki {away}"
  230930: "FIRST_GOAL_KICK", // "1. wybicie od bramki"
  230942: "OTHER", // "1. połowa - liczba wybić od bramki" - no catalog counterpart
  230943: "OTHER", // HT team goal kicks - no catalog counterpart
  230944: "OTHER", // HT team goal kicks - no catalog counterpart
  238103: "SAVES_TOTAL", // "Liczba obronionych strzałów przez bramkarza"
  234753: "OTHER", // "{home} - obronione strzały" - no catalog counterpart
  234754: "OTHER", // "{away} - obronione strzały" - no catalog counterpart
  238104: "OTHER", // "Każda z drużyn powyżej X obron" - no catalog counterpart
  238105: "OTHER", // HT team saves - no catalog counterpart
  238106: "OTHER", // HT team saves - no catalog counterpart
  238107: "OTHER", // "1. połowa - obronione strzały" - no catalog counterpart
  233527: "POST_OR_CROSSBAR_TOTAL", // "Liczba strzałów w obramowanie bramki"
  233528: "TEAM_TOTAL_WOODWORK_SHOTS", // "{home} - strzały w obramowanie"
  233529: "TEAM_TOTAL_WOODWORK_SHOTS", // "{away} - strzały w obramowanie"
  200743: "OTHER", // "Liczba przyznanych rzutów karnych" - no O/U penalties code
  233455: "OTHER", // team penalties awarded - no catalog counterpart
  233456: "OTHER", // team penalties awarded - no catalog counterpart
  233489: "OTHER", // HT penalties awarded - no catalog counterpart
  233490: "OTHER", // HT team penalties awarded - no catalog counterpart
  233491: "OTHER", // HT team penalties awarded - no catalog counterpart
  240046: "VAR_REVIEW", // "Sędzia podejdzie do monitora VAR co najmniej raz"

  // ===== Minute-interval micro markets (no catalog counterparts) =====
  238549: "OTHER", // "Liczba wybić od bramki od X do Y minuty"
  238550: "OTHER", // "Najwięcej wybić od bramki od X do Y minuty"
  238567: "OTHER", // "Liczba celnych strzałów od X do Y minuty"
  238568: "OTHER", // "Najwięcej celnych strzałów od X do Y minuty"
  238573: "OTHER", // "Liczba rzutów z autu od X do Y minuty"
  238574: "OTHER", // "Najwięcej rzutów z autu od X do Y minuty"
  238591: "OTHER", // "Liczba fauli od X do Y minuty"
  238592: "OTHER", // "Najwięcej fauli od X do Y minuty"

  // ===== Player markets =====
  600: "GOALSCORER_ANYTIME", // listing endpoint alias
  601: "GOALSCORER_FIRST", // listing endpoint alias
  236226: "GOALSCORER_ANYTIME", // "Zawodnik - strzeli gola"
  236424: "GOALSCORER_FIRST", // "Zawodnik - strzeli 1. gola"
  233486: "HALF_TIME_GOALSCORER_ANYTIME", // "Zawodnik - strzeli gola w 1. połowie"
  233487: "SECOND_HALF_GOALSCORER_ANYTIME", // "Zawodnik - strzeli gola w 2. połowie"
  233488: "PLAYER_SCORES_BOTH_HALVES", // "Zawodnik - strzeli gola w obu połowach"
  233482: "OTHER", // "Zawodnik - strzeli 1. gola dla {home}" - no catalog counterpart
  233483: "OTHER", // "Zawodnik - strzeli 1. gola dla {away}" - no catalog counterpart
  236240: "PLAYER_CARDS", // "Zawodnik - otrzyma kartkę"
  201787: "FIRST_PLAYER_CARDED", // "Zawodnik - otrzyma 1. kartkę"
  236242: "PLAYER_RED_CARD", // "Zawodnik - otrzyma czerwoną kartkę"
  239910: "PLAYER_OF_THE_MATCH", // "Zawodnik meczu"
  236230: "PLAYER_GOAL_OR_ASSIST", // "Zawodnik - strzeli gola lub zaliczy asystę"
  236232: "PLAYER_GOAL_AND_ASSIST", // "Zawodnik - strzeli gola & zaliczy asystę"
  236244: "PLAYER_2_OR_MORE_GOALS", // "Zawodnik - strzeli 2+ gole"
  236246: "PLAYER_3_OR_MORE_GOALS", // "Zawodnik - strzeli 3+ gole"
  236426: "PLAYER_HEADER_GOAL", // "Zawodnik - strzeli gola głową"
  237087: "PLAYER_HEADER_GOAL", // "Zawodnik - strzeli gola głową" (alt id)
  236428: "PLAYER_LEFT_FOOT_GOAL", // "Zawodnik - strzeli gola lewą nogą"
  236430: "PLAYER_RIGHT_FOOT_GOAL", // "Zawodnik - strzeli gola prawą nogą"
  236436: "PLAYER_GOAL_OUTSIDE_BOX", // "Zawodnik - strzeli gola spoza pola karnego"
  236432: "PENALTY_SCORER", // "Zawodnik - strzeli gola z rzutu karnego"
  237085: "PLAYER_FREE_KICK_GOAL", // "Zawodnik - strzeli gola bezpośrednio z rzutu wolnego"
  236218: "PLAYER_SHOTS", // "Zawodnik - liczba strzałów"
  236224: "PLAYER_OFFSIDES", // "Zawodnik - liczba spalonych"
  238465: "PLAYER_HEADER_SHOTS_ON_TARGET", // "Zawodnik - liczba celnych strzałów głową"
  238481: "OTHER", // "Zawodnik - liczba strzałów głową" - no catalog counterpart
  233484: "TWO_PLAYERS_ANYTIME", // "Którykolwiek z zawodników strzeli gola"
  233485: "BOTH_PLAYERS_ANYTIME", // "Obaj zawodnicy strzelą gola"
};

/**
 * Superbet publishes team-scoped markets under separate, side-specific ids.
 * For catalog codes whose selections are side-prefixed (HOME_OVER, AWAY_1-2)
 * the side is derived from the market id.
 */
const SUPERBET_SIDE_BY_MARKET_ID: Record<number, "HOME" | "AWAY"> = {
  700: "HOME", // "{home} - liczba kartek"
  708: "AWAY", // "{away} - liczba kartek"
  873: "HOME", // "1. połowa - {home} liczba rzutów rożnych"
  884: "AWAY", // "1. połowa - {away} liczba rzutów rożnych"
  200758: "HOME", // "1.połowa - {home} przedział goli"
  200759: "AWAY", // "1.połowa - {away} przedział goli"
  200760: "HOME", // "2.połowa - {home} przedział goli"
  200761: "AWAY", // "2.połowa - {away} przedział goli"
};

const SIDED_SELECTION_MARKETS = new Set<NormalizedMarketType>([
  "CARDS_TEAM",
  "HALF_TIME_CORNERS_TEAM",
  "HALF_TIME_TEAM_GOAL_RANGE",
  "SECOND_HALF_TEAM_GOAL_RANGE",
]);

const SUPERBET_SELECTION_OVERRIDES: Record<string, NormalizedSelection> = {
  "1x": "HOME_OR_DRAW",
  "x2": "DRAW_OR_AWAY",
  "12": "HOME_OR_AWAY",
  gg: "YES",
  ng: "NO",
  "0": "DRAW",
};

/**
 * Markets where the raw shorthand overrides above are meaningful. Range and
 * exact-count markets must NOT go through them ("0" is a valid goal count,
 * not a draw).
 */
const OVERRIDE_ELIGIBLE_MARKETS = new Set<NormalizedMarketType>([
  "MATCH_WINNER",
  "HALF_TIME_RESULT",
  "SECOND_HALF_RESULT",
  "DRAW_NO_BET",
  "HALF_TIME_DRAW_NO_BET",
  "SECOND_HALF_DRAW_NO_BET",
  "WIN_TO_NIL",
  "DOUBLE_CHANCE",
  "HALF_TIME_DOUBLE_CHANCE",
  "SECOND_HALF_DOUBLE_CHANCE",
  "BTTS",
  "HALF_TIME_BTTS",
  "SECOND_HALF_BTTS",
]);

/**
 * Name-based fallback routing, used only for market ids missing from the id
 * map. Half-scoped patterns are listed before the generic full-match ones.
 */
const SUPERBET_NAME_PATTERNS: Array<{ pattern: RegExp; code: NormalizedMarketType }> = [
  { pattern: /2\.?\s*polow.*podwojna szansa/, code: "SECOND_HALF_DOUBLE_CHANCE" },
  { pattern: /1\.?\s*polow.*podwojna szansa/, code: "HALF_TIME_DOUBLE_CHANCE" },
  { pattern: /2\.?\s*polow.*obie.*strzela/, code: "SECOND_HALF_BTTS" },
  { pattern: /obie.*strzela.*1\.?\s*polow|1\.?\s*polow.*obie.*strzela/, code: "HALF_TIME_BTTS" },
  { pattern: /handicap\s*1x2/, code: "EUROPEAN_HANDICAP" },
  { pattern: /2\.?\s*polow.*dokladny wynik/, code: "SECOND_HALF_CORRECT_SCORE" },
  { pattern: /1\.?\s*polow.*dokladny wynik/, code: "HALF_TIME_CORRECT_SCORE" },
  { pattern: /dokladny wynik|correct score/, code: "CORRECT_SCORE" },
  { pattern: /2\.?\s*polow.*liczba goli|liczba goli.*2\.?\s*polow/, code: "SECOND_HALF_TOTAL_GOALS" },
  { pattern: /liczba goli.*1\.?\s*polow|1\.?\s*polow.*liczba goli/, code: "HALF_TIME_TOTAL_GOALS" },
  { pattern: /2\.?\s*polow.*(1x2|wynik)/, code: "SECOND_HALF_RESULT" },
  { pattern: /wynik\s*1\.?\s*polow|1\.?\s*polow.*(1x2|wynik)/, code: "HALF_TIME_RESULT" },
  { pattern: /wynik meczu|koncowy wynik|zwyciezca meczu|^1x2$|^mecz$/, code: "MATCH_WINNER" },
  { pattern: /podwojna szansa|double chance/, code: "DOUBLE_CHANCE" },
  { pattern: /remis\s*=\s*zwrot|draw no bet|zaklad bez remisu/, code: "DRAW_NO_BET" },
  { pattern: /obie.*strzela|btts|gg\/?ng/, code: "BTTS" },
  { pattern: /liczba goli|suma goli|over\/?under|o\/?u/, code: "TOTAL_GOALS" },
  { pattern: /handicap azjatycki|asian handicap|^handicap$/, code: "ASIAN_HANDICAP" },
  { pattern: /handicap europejski|european handicap/, code: "EUROPEAN_HANDICAP" },
  { pattern: /parzyste\/?nieparzyste|nieparzysta\/?parzysta|odd\/?even/, code: "ODD_EVEN_GOALS" },
  { pattern: /wygrana do zera|win to nil/, code: "WIN_TO_NIL" },
  { pattern: /czyste konto|clean sheet/, code: "CLEAN_SHEET" },
  { pattern: /pierwszy strzelec|first goalscorer/, code: "GOALSCORER_FIRST" },
  { pattern: /strzelec|goalscorer/, code: "GOALSCORER_ANYTIME" },
];

const HANDICAP_MARKETS = new Set<NormalizedMarketType>([
  "ASIAN_HANDICAP",
  "FIRST_HALF_ASIAN_HANDICAP",
  "SECOND_HALF_ASIAN_HANDICAP",
  "EUROPEAN_HANDICAP",
  "FIRST_HALF_EUROPEAN_HANDICAP",
  "SECOND_HALF_EUROPEAN_HANDICAP",
  "CORNERS_HANDICAP",
  "HALF_TIME_CORNERS_HANDICAP",
  "CARDS_HANDICAP",
  "HALF_TIME_CARDS_HANDICAP",
  "SHOTS_HANDICAP",
  "HALF_TIME_SHOTS_HANDICAP",
  "SHOTS_ON_TARGET_HANDICAP",
  "GOAL_KICKS_HANDICAP",
  "OFFSIDES_HANDICAP",
]);

/** European-handicap ids quote the line in score notation, e.g. "(0:2)". */
const SCORE_HANDICAP_MARKETS = new Set<NormalizedMarketType>([
  "EUROPEAN_HANDICAP",
  "FIRST_HALF_EUROPEAN_HANDICAP",
  "SECOND_HALF_EUROPEAN_HANDICAP",
]);

const OVER_UNDER_MARKETS = new Set<NormalizedMarketType>([
  "TOTAL_GOALS",
  "TOTAL_GOALS_ASIAN",
  "HALF_TIME_TOTAL_GOALS",
  "SECOND_HALF_TOTAL_GOALS",
  "OWN_GOALS_TOTAL",
  "FIRST_30_MIN_TOTAL_GOALS",
  "TOTAL_GOALS_BY_60_MIN",
  "TEAM_TOTAL_GOALS",
  "HOME_TEAM_TOTAL_GOALS",
  "AWAY_TEAM_TOTAL_GOALS",
  "HALF_TIME_HOME_TEAM_TOTAL_GOALS",
  "HALF_TIME_AWAY_TEAM_TOTAL_GOALS",
  "SECOND_HALF_HOME_TEAM_TOTAL_GOALS",
  "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS",
  "CORNERS_TOTAL",
  "HALF_TIME_CORNERS_TOTAL",
  "CARDS_TOTAL",
  "HALF_TIME_CARDS_TOTAL",
  "CARDS_TEAM",
  "HALF_TIME_HOME_TEAM_TOTAL_CARDS",
  "HALF_TIME_AWAY_TEAM_CARDS",
  "HALF_TIME_CORNERS_TEAM",
  "RED_CARDS_TOTAL",
  "FOULS_TOTAL",
  "HOME_TEAM_TOTAL_FOULS",
  "AWAY_TEAM_TOTAL_FOULS",
  "HALF_TIME_FOULS_TOTAL",
  "HALF_TIME_HOME_TEAM_FOULS_TOTAL",
  "BOTH_TEAMS_FOULS_OVER",
  "OFFSIDES_TOTAL",
  "HOME_TEAM_TOTAL_OFFSIDES",
  "AWAY_TEAM_TOTAL_OFFSIDES",
  "EACH_TEAM_OFFSIDES",
  "THROW_INS_TOTAL",
  "HOME_TEAM_TOTAL_THROW_INS",
  "AWAY_TEAM_TOTAL_THROW_INS",
  "GOAL_KICKS_TOTAL",
  "HOME_TEAM_TOTAL_GOAL_KICKS",
  "AWAY_TEAM_GOAL_KICKS",
  "TOTAL_SHOTS",
  "TEAM_TOTAL_SHOTS",
  "TOTAL_SHOTS_ON_TARGET",
  "TEAM_TOTAL_SHOTS_ON_TARGET",
  "HALF_TIME_TOTAL_SHOTS_ON_TARGET",
  "EACH_TEAM_TOTAL_SHOTS_ON_TARGET_OVER",
  "CLEARANCES_TOTAL",
  "TEAM_TOTAL_TACKLES",
  "SAVES_TOTAL",
  "POST_OR_CROSSBAR_TOTAL",
  "TEAM_TOTAL_WOODWORK_SHOTS",
]);

const PARAMETERIZED_MARKETS = new Set<NormalizedMarketType>([
  ...OVER_UNDER_MARKETS,
  ...HANDICAP_MARKETS,
  "RESULT_AND_TOTAL",
  "DOUBLE_CHANCE_TOTAL",
  "TOTAL_GOALS_AND_BTTS",
  "RESULT_OR_TOTAL",
  "HALFTIME_FULLTIME_AND_TOTAL",
  "NTH_CORNER",
  "GOAL_BY_MINUTE",
]);

function extractSuperbetMarketId(marketName: string): number | null {
  const match = marketName.match(/^Rynek\s+(\d+)$/iu);
  return match ? Number(match[1]) : null;
}

/**
 * Goal O/U sliders that must only ever contain plain over/under goal lines.
 * Combined bets, exact-count variants and other-stat markets sharing goal
 * vocabulary poison best-odds when they land here.
 */
const GOALS_OVER_UNDER_FAMILY = new Set<NormalizedMarketType>([
  "TOTAL_GOALS",
  "HALF_TIME_TOTAL_GOALS",
  "SECOND_HALF_TOTAL_GOALS",
  "HOME_TEAM_TOTAL_GOALS",
  "AWAY_TEAM_TOTAL_GOALS",
  "HALF_TIME_HOME_TEAM_TOTAL_GOALS",
  "HALF_TIME_AWAY_TEAM_TOTAL_GOALS",
  "SECOND_HALF_HOME_TEAM_TOTAL_GOALS",
  "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS",
]);

/** Raw name is a combo / exact-count / non-goal stat, not an O/U goals line. */
function isNonGoalsLineName(rawName: string): boolean {
  const lowered = normalizeMarketName(rawName).replace(/ł/g, "l");
  return (
    /&|\blub\b/.test(lowered) ||
    lowered.includes("dokladna liczba") ||
    // Cross-stat leakage: corners/cards/offsides/shots/fouls/throw-ins/goal kicks
    /rozn|kartk|spalon|strzal|faul|autu|wybici/.test(lowered)
  );
}

/**
 * Superbet's "Liczba goli - do X minuty" family carries the real minute
 * checkpoint only in the selection names ("Powyżej 1.5 - do 40. minuty").
 * Resolve the minute and route the market to the matching catalog code -
 * checkpoints without a catalog counterpart (e.g. 40') must not stay in
 * GOAL_BY_MINUTE where they would only produce UNKNOWN selections.
 */
function resolveGoalByMinuteCode(raw: RawBookmakerMarket): NormalizedMarketType {
  const minutes = new Set<string>();
  for (const sel of raw.selections) {
    const match = sel.name.match(/do\s+(\d+)\.?\s*minut/iu);
    if (match) minutes.add(match[1]);
  }
  const list = Array.from(minutes);
  if (list.length > 0 && list.every((m) => ["1", "5", "10", "15"].includes(m))) {
    return "GOAL_BY_MINUTE";
  }
  if (list.length > 0 && list.every((m) => m === "30")) return "FIRST_30_MIN_TOTAL_GOALS";
  if (list.length > 0 && list.every((m) => m === "60")) return "TOTAL_GOALS_BY_60_MIN";
  return "OTHER";
}

/** "nikt", "żadna", "brak gola", "bez kartki", ... -> no-outcome selection */
function isNoneSelection(lower: string): boolean {
  return (
    lower === "nikt" ||
    lower === "żaden" ||
    lower === "zaden" ||
    lower === "żadna" ||
    lower === "zadna" ||
    lower.startsWith("brak") ||
    lower.startsWith("bez ")
  );
}

function map1x2Token(token: string): NormalizedSelection | null {
  if (token === "1") return "HOME";
  if (/^x$/i.test(token)) return "DRAW";
  if (token === "2") return "AWAY";
  return null;
}

/**
 * Convert Superbet time-range selections into catalog minute buckets:
 * "0:00 - 9:59 minuty" -> "1-10", "0:00 - 14:59 minuty" -> "1-15",
 * "75:00 - 90:00+ minuty" -> "76-90", "30:00 - 45:00+" -> "31-45".
 */
function normalizeTimeRangeBucket(name: string): string | null {
  const match = name.match(/^(\d+):\d+\s*-\s*(\d+)(?::\d+)?(\+)?/);
  if (!match) return null;
  const start = parseInt(match[1], 10) + 1;
  const endRaw = parseInt(match[2], 10);
  const end = match[3] ? endRaw : endRaw + 1;
  return `${start}-${end}`;
}

function resolveMarketCode(raw: RawBookmakerMarket): {
  marketCode: NormalizedMarketType;
  matchedBy: "id" | "name" | "pattern";
  rawId?: number;
} {
  const marketId = raw.bookmakerMarketId
    ? Number(raw.bookmakerMarketId)
    : extractSuperbetMarketId(raw.name);

  if (marketId && SUPERBET_MARKET_ID_TO_CODE[marketId]) {
    return {
      marketCode: SUPERBET_MARKET_ID_TO_CODE[marketId],
      matchedBy: "id",
      rawId: marketId,
    };
  }

  // normalizeMarketName strips combining diacritics via NFD, but "ł" has no
  // canonical decomposition and survives it. Fold it manually so patterns
  // written with "polow"/"dokladny" actually match "połowa"/"dokładny" -
  // without this every half-scoped name fell through to the generic
  // full-match patterns (e.g. "1.połowa liczba goli" -> TOTAL_GOALS).
  const normalizedName = normalizeMarketName(raw.name).replace(/ł/g, "l");

  // Combined bets ("A & B", "A lub B") and exact-count variants share goal
  // vocabulary with the O/U patterns below but are different bet shapes -
  // never let them resolve into an O/U goals market by name.
  if (
    /liczba goli|przedzial goli/.test(normalizedName) &&
    (/&|\blub\b/.test(normalizedName) || normalizedName.includes("dokladna liczba"))
  ) {
    return { marketCode: "OTHER", matchedBy: "name", rawId: marketId ?? undefined };
  }

  // Minute-interval micro markets ("... od 10:00 do 19:59 minuty") have no
  // catalog counterpart - never let them fall through into name patterns.
  if (/\bod\s+\d+:\d+\s+do\s+\d+/.test(normalizedName)) {
    return { marketCode: "OTHER", matchedBy: "name", rawId: marketId ?? undefined };
  }

  for (const { pattern, code } of SUPERBET_NAME_PATTERNS) {
    if (pattern.test(normalizedName)) {
      return { marketCode: code, matchedBy: "pattern", rawId: marketId ?? undefined };
    }
  }

  return {
    marketCode: "OTHER",
    matchedBy: "name",
    rawId: marketId ?? undefined,
  };
}

/** Strip a trailing parenthesised line, e.g. "Argentyna (-4.5)" / "Remis (0:2)". */
function stripLineSuffix(selectionName: string): string {
  return selectionName.replace(/\s*\([^)]*\)\s*$/u, "").trim();
}

function normalizeSuperbetHandicapSelection(
  trimmed: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const stripped = stripLineSuffix(trimmed);
  const token = map1x2Token(stripped);
  if (token) return token;
  if (/^remis$/i.test(stripped)) return "DRAW";
  return normalize1x2Selection(stripped || trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
}

function normalizeSelectionForMarket(
  selectionName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext
): NormalizedSelection {
  const trimmed = selectionName.trim();

  // Literal catalog-code passthrough: band/range/exact markets often quote
  // raw selection text that IS the catalog selection code ("0-2", "7+", "1+"),
  // and per-market cases below may miss them (falling through to UNKNOWN).
  const literalCatalogCodes = getMarketByCode(marketCode)?.selections;
  if (literalCatalogCodes && literalCatalogCodes.length > 0 && literalCatalogCodes.includes(trimmed)) {
    return trimmed as NormalizedSelection;
  }
  const lower = trimmed.toLowerCase();

  if (OVERRIDE_ELIGIBLE_MARKETS.has(marketCode)) {
    const override = SUPERBET_SELECTION_OVERRIDES[lower];
    if (override) return override;
  }

  if (OVER_UNDER_MARKETS.has(marketCode)) {
    // Team-scoped ranges ("<3", "3-4", "5+") share ids with plain O/U lines.
    const ou = normalizeOverUnderSelection(trimmed);
    if (ou !== "UNKNOWN") return ou;
    // "Każda z drużyn powyżej X ..." markets: the catalog defines OVER only
    // and the parser already drops the "nie" leg, but the surviving leg's
    // label embeds the full market phrase ("Każda z drużyn powyżej 8.5 fauli
    // - tak") instead of starting with "Powyżej", so it missed the O/U parse.
    if (
      marketCode === "BOTH_TEAMS_FOULS_OVER" ||
      marketCode === "EACH_TEAM_OFFSIDES" ||
      marketCode === "EACH_TEAM_TOTAL_SHOTS_ON_TARGET_OVER"
    ) {
      return /(^|[\s-])nie\s*$/iu.test(trimmed) ? "UNKNOWN" : "OVER";
    }
    if (marketCode === "CORNERS_TEAM") {
      return normalizeRangeSelection(trimmed, lower);
    }
    return "UNKNOWN";
  }

  if (HANDICAP_MARKETS.has(marketCode)) {
    return normalizeSuperbetHandicapSelection(trimmed, ctx);
  }

  switch (marketCode) {
    case "CLEAN_SHEET": {
      // The catalog defines CLEAN_SHEET as HOME/AWAY only - a draw-like
      // outcome ("remis" = neither keeps a clean sheet) has no code.
      const sel = normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
      return sel === "DRAW" ? "UNKNOWN" : sel;
    }

    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "SECOND_HALF_RESULT":
    case "DRAW_NO_BET":
    case "HALF_TIME_DRAW_NO_BET":
    case "SECOND_HALF_DRAW_NO_BET":
    case "WIN_TO_NIL":
    case "CORNERS_RACE":
    case "HALF_TIME_CORNERS_RACE":
    case "CARDS_RACE":
    case "HALF_TIME_CARDS_RACE":
    case "MOST_SHOTS":
    case "MOST_SHOTS_ON_TARGET":
    case "KICKOFF_TEAM":
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "FIRST_TEAM_TO_SCORE":
    case "LAST_TEAM_TO_SCORE":
    case "HALF_TIME_FIRST_GOAL":
    case "FIRST_CORNER":
    case "LAST_CORNER":
    case "FIRST_CARD":
    case "FIRST_SHOT":
    case "FIRST_SHOT_ON_TARGET":
      if (isNoneSelection(lower) || lower === "remis") return "NONE" as NormalizedSelection;
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "FIRST_OFFSIDE":
    case "FIRST_GOAL_KICK":
      // The catalog defines these as HOME/AWAY only - Superbet's extra
      // "Nikt" outcome has no canonical code.
      if (isNoneSelection(lower)) return "UNKNOWN";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "DOUBLE_CHANCE":
    case "HALF_TIME_DOUBLE_CHANCE":
    case "SECOND_HALF_DOUBLE_CHANCE":
      return normalizeDoubleChanceSelection(trimmed);

    case "BTTS":
    case "HALF_TIME_BTTS":
    case "SECOND_HALF_BTTS":
    case "BTTS_2PLUS_GOALS":
    case "BTTS_AT_LEAST_ONE_HALF":
    case "BTTS_OR_OVER_2_5":
    case "DRAW_OR_BTTS":
    case "DRAW_OR_CLEAN_SHEET":
    case "BOTH_HALVES_GOALS":
    case "HOME_TEAM_TO_SCORE":
    case "AWAY_TEAM_TO_SCORE":
    case "HOME_WIN_BOTH_HALVES":
    case "AWAY_WIN_BOTH_HALVES":
    case "HOME_WIN_AT_LEAST_ONE_HALF":
    case "AWAY_WIN_AT_LEAST_ONE_HALF":
    case "HOME_SCORE_BOTH_HALVES":
    case "AWAY_SCORE_BOTH_HALVES":
    case "VAR_REVIEW":
      return normalizeYesNoSelection(trimmed);

    case "ODD_EVEN_GOALS":
    case "HALF_TIME_ODD_EVEN_GOALS":
    case "HOME_TEAM_ODD_EVEN_GOALS":
    case "AWAY_TEAM_ODD_EVEN_GOALS":
    case "CORNERS_ODD_EVEN":
    case "HALF_TIME_CORNERS_ODD_EVEN":
      return normalizeOddEvenSelection(trimmed);

    case "CORRECT_SCORE":
    case "HALF_TIME_CORRECT_SCORE":
    case "SECOND_HALF_CORRECT_SCORE":
    case "ANYTIME_CORRECT_SCORE": {
      if (lower === "inne" || lower === "inny" || lower === "other") {
        return "OTHER" as NormalizedSelection;
      }
      const score = parseScoreSelection(trimmed);
      return (score ?? trimmed) as NormalizedSelection;
    }

    case "HT_FT_CORRECT_SCORE": {
      // Superbet uses compact "0:0/1:0"; catalog codes are "0:0 / 1:0".
      const match = trimmed.match(/^(\d+)\s*:\s*(\d+)\s*\/\s*(\d+)\s*:\s*(\d+)$/);
      if (match) {
        return `${match[1]}:${match[2]} / ${match[3]}:${match[4]}` as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "HALFTIME_FULLTIME":
    case "DOUBLE_RESULT": {
      const htft = parseHtFtSelection(trimmed);
      return (htft ?? trimmed) as NormalizedSelection;
    }

    case "HT_OR_FT_RESULT": {
      // "1 lub 1" / "X lub X" / "2 lub 2"
      const match = trimmed.match(/^([1X2])\s+lub\s+[1X2]$/i);
      if (match) return map1x2Token(match[1]) ?? "UNKNOWN";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
    }

    case "MULTI_RESULT":
      // Catalog codes are the literal Polish labels, e.g. "1:0, 2:0 lub 3:0",
      // plus "X" for the draw - Superbet quotes the draw as "Remis"/"0".
      if (/^(remis|x|0)$/i.test(trimmed)) return "X" as NormalizedSelection;
      return trimmed as NormalizedSelection;

    case "DOUBLE_RESULT_PAIR": {
      // "1/1 lub X/1" -> catalog code "1/1_OR_X/1". Superbet's raw market
      // name ("1. połowa/mecz - podwójna szansa") is misleading - selections
      // are pairs of HT/FT double-result outcomes joined by "lub".
      const match = trimmed.match(/^([1X2]\s*\/\s*[1X2])\s+lub\s+([1X2]\s*\/\s*[1X2])$/i);
      if (match) {
        const compact = (part: string) => part.replace(/\s+/g, "").toUpperCase();
        return `${compact(match[1])}_OR_${compact(match[2])}` as NormalizedSelection;
      }
      return "UNKNOWN";
    }

    case "GOAL_RANGE":
    case "HOME_GOAL_RANGE":
    case "AWAY_GOAL_RANGE":
    case "HALF_TIME_GOAL_RANGE":
    case "SECOND_HALF_GOAL_RANGE":
    case "HALF_TIME_TEAM_GOAL_RANGE":
    case "SECOND_HALF_TEAM_GOAL_RANGE":
    case "CORNERS_RANGE":
    case "HALF_TIME_CORNERS_RANGE":
      return normalizeRangeSelection(trimmed, lower);

    case "HALF_TIME_HOME_EXACT_GOALS": {
      // The catalog's top band is a bare count ("3"); Superbet quotes it as
      // "3+" - strip the "+" so the odds join the existing comparison column.
      const plusBand = trimmed.match(/^(\d+)\+$/);
      if (plusBand && literalCatalogCodes?.includes(plusBand[1])) {
        return plusBand[1] as NormalizedSelection;
      }
      return normalizeRangeSelection(trimmed, lower);
    }

    case "HALF_WITH_MORE_GOALS":
    case "HOME_HALF_WITH_MOST_GOALS":
    case "AWAY_HALF_WITH_MOST_GOALS":
      if (/1\.?\s*po[łl]owa/iu.test(lower)) return "1st" as NormalizedSelection;
      if (/2\.?\s*po[łl]owa/iu.test(lower)) return "2nd" as NormalizedSelection;
      if (lower === "równo" || lower === "rowno" || lower === "remis") {
        return "Draw" as NormalizedSelection;
      }
      return "UNKNOWN";

    case "BTTS_BY_HALF": {
      // "Tak/Nie" = both score in 1st half only, etc.
      const compact = lower.replace(/\s+/g, "");
      if (compact === "tak/tak") return "Both" as NormalizedSelection;
      if (compact === "tak/nie") return "1st" as NormalizedSelection;
      if (compact === "nie/tak") return "2nd" as NormalizedSelection;
      if (compact === "nie/nie") return "None" as NormalizedSelection;
      return "UNKNOWN";
    }

    case "FIRST_GOAL_TIME":
    case "FIRST_GOAL_TIME_ALT": {
      if (isNoneSelection(lower)) return "NONE" as NormalizedSelection;
      const bucket = normalizeTimeRangeBucket(trimmed);
      return (bucket ?? "UNKNOWN") as NormalizedSelection;
    }

    case "FIRST_GOAL_METHOD":
      if (lower.includes("głów") || lower.includes("glow")) return "HEADER" as NormalizedSelection;
      if (lower.includes("karny")) return "PENALTY" as NormalizedSelection;
      if (lower.includes("wolny")) return "FREE_KICK" as NormalizedSelection;
      if (lower === "strzał" || lower === "strzal") return "OTHER" as NormalizedSelection;
      return "UNKNOWN";

    case "FIRST_GOAL_AND_RESULT": {
      // "1 & X" = home scores first, draw; "bez gola"/"nie padnie gol" = no
      // goal (no other selection in this market starts with "nie").
      if (isNoneSelection(lower) || /^nie\s/.test(lower)) return "NONE" as NormalizedSelection;
      const match = trimmed.match(/^([12])\s*&\s*([1X2])$/i);
      if (match) {
        const first = match[1] === "1" ? "HOME" : "AWAY";
        const result = map1x2Token(match[2]);
        if (result) return `${first}_${result}` as NormalizedSelection;
      }
      return "UNKNOWN";
    }

    case "RESULT_AND_TOTAL":
    case "HALF_TIME_RESULT_AND_TOTAL": {
      // "Argentyna & powyżej 0.5" / "remis & poniżej 1.5"
      const parts = trimmed.split("&");
      if (parts.length === 2) {
        const result = normalize1x2Selection(parts[0].trim(), ctx.homeTeam, ctx.awayTeam, ctx.league);
        const overUnder = normalizeOverUnderSelection(parts[1].trim());
        if (result !== "UNKNOWN" && (overUnder === "OVER" || overUnder === "UNDER")) {
          return `${result}_${overUnder}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    case "RESULT_OR_TOTAL": {
      // "Argentyna lub poniżej 0.5"
      const parts = trimmed.split(/\s+lub\s+/i);
      if (parts.length === 2) {
        const result = normalize1x2Selection(parts[0].trim(), ctx.homeTeam, ctx.awayTeam, ctx.league);
        const overUnder = normalizeOverUnderSelection(parts[1].trim());
        if (result !== "UNKNOWN" && (overUnder === "OVER" || overUnder === "UNDER")) {
          return `${result}_${overUnder}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    case "RESULT_AND_BTTS": {
      // "Argentyna & tak" / "remis & nie"
      const parts = trimmed.split("&");
      if (parts.length === 2) {
        const result = normalize1x2Selection(parts[0].trim(), ctx.homeTeam, ctx.awayTeam, ctx.league);
        const yesNo = normalizeYesNoSelection(parts[1].trim());
        if (result !== "UNKNOWN" && (yesNo === "YES" || yesNo === "NO")) {
          return `${result}_${yesNo}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    case "RESULT_AND_GOAL_RANGE": {
      // "Argentyna & 2-3"
      const parts = trimmed.split("&");
      if (parts.length === 2) {
        const result = normalize1x2Selection(parts[0].trim(), ctx.homeTeam, ctx.awayTeam, ctx.league);
        const range = parts[1].trim().replace(/\s+/g, "");
        if (result !== "UNKNOWN" && /^\d+-\d+$/.test(range)) {
          return `${result}_${range}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    case "DOUBLE_CHANCE_TOTAL": {
      // "1X & poniżej 1.5"
      const match = trimmed.match(/^(1X|X2|12)\s*&\s*(.+)$/i);
      if (match) {
        const overUnder = normalizeOverUnderSelection(match[2].trim());
        if (overUnder === "OVER" || overUnder === "UNDER") {
          return `${match[1].toUpperCase()}_${overUnder}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    case "DOUBLE_CHANCE_BTTS": {
      // "1X & tak"
      const match = trimmed.match(/^(1X|X2|12)\s*&\s*(.+)$/i);
      if (match) {
        const yesNo = normalizeYesNoSelection(match[2].trim());
        if (yesNo === "YES" || yesNo === "NO") {
          return `${match[1].toUpperCase()}_${yesNo}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    case "DOUBLE_CHANCE_GOAL_RANGE": {
      // "1X & 2-3"
      const match = trimmed.match(/^(1X|X2|12)\s*&\s*(\d+\s*-\s*\d+)$/i);
      if (match) {
        return `${match[1].toUpperCase()}_${match[2].replace(/\s+/g, "")}` as NormalizedSelection;
      }
      return "UNKNOWN";
    }

    case "TOTAL_GOALS_AND_BTTS": {
      // "poniżej 2.5 & tak"
      const parts = trimmed.split("&");
      if (parts.length === 2) {
        const overUnder = normalizeOverUnderSelection(parts[0].trim());
        const yesNo = normalizeYesNoSelection(parts[1].trim());
        if ((overUnder === "OVER" || overUnder === "UNDER") && (yesNo === "YES" || yesNo === "NO")) {
          return `${overUnder}_${yesNo}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    case "HALFTIME_FULLTIME_AND_TOTAL": {
      // "1/1 & Poniżej 1.5" -> HOME_HOME_UNDER
      const match = trimmed.match(/^([1X2])\s*\/\s*([1X2])\s*&\s*(.+)$/i);
      if (match) {
        const ht = map1x2Token(match[1]);
        const ft = map1x2Token(match[2]);
        const overUnder = normalizeOverUnderSelection(match[3].trim());
        if (ht && ft && (overUnder === "OVER" || overUnder === "UNDER")) {
          return `${ht}_${ft}_${overUnder}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    case "GOAL_BY_MINUTE": {
      // "Poniżej 0.5 - do 5. minuty" -> UNDER_5MIN
      const match = trimmed.match(/^(powyżej|powyzej|poniżej|ponizej)\s+[\d.,]+\s*-\s*do\s+(\d+)\.?\s*minuty$/i);
      if (match) {
        const overUnder = /^pow/i.test(match[1]) ? "OVER" : "UNDER";
        if (["1", "5", "10", "15"].includes(match[2])) {
          return `${overUnder}_${match[2]}MIN` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    case "RESULT_AT_MINUTE": {
      // "1 - do 5. minuty" -> HOME
      const token = trimmed.replace(/\s*-\s*do\s+\d+\.?\s*minuty$/i, "").trim();
      const mapped = map1x2Token(token);
      if (mapped) return mapped;
      return normalize1x2Selection(token, ctx.homeTeam, ctx.awayTeam, ctx.league);
    }

    case "NTH_CORNER": {
      // "3 - Argentyna" / "3 - Nikt"
      const stripped = trimmed.replace(/^\d+\s*-\s*/, "").trim();
      if (isNoneSelection(stripped.toLowerCase())) return "NONE" as NormalizedSelection;
      return normalize1x2Selection(stripped, ctx.homeTeam, ctx.awayTeam, ctx.league);
    }

    case "TWO_PLAYERS_ANYTIME":
    case "BOTH_PLAYERS_ANYTIME": {
      // Each named pair must stay a distinct selection code - the shared
      // "PLAYER_PAIR" constant collapsed every pair into one aggregated row,
      // silently dropping all but the first quote. Canonicalize both names
      // ("Rodriguez, James i Ndoye, Dan" -> "James Rodriguez i Dan Ndoye").
      const cleanedPair = trimmed.replace(/^\d+\.\s*/, "").trim();
      return cleanedPair
        .split(/\s+i\s+/iu)
        .map((part) => canonicalizePlayerName(part.trim()))
        .join(" i ") as NormalizedSelection;
    }

    case "GOALSCORER_FIRST":
    case "GOALSCORER_ANYTIME":
    case "GOALSCORER_LAST":
    case "HALF_TIME_GOALSCORER_ANYTIME":
    case "SECOND_HALF_GOALSCORER_ANYTIME":
    case "PLAYER_SCORES_BOTH_HALVES":
    case "PLAYER_SHOTS":
    case "PLAYER_CARDS":
    case "PLAYER_RED_CARD":
    case "PLAYER_ASSISTS":
    case "PLAYER_SHOTS_ON_TARGET":
    case "PLAYER_HEADER_SHOTS_ON_TARGET":
    case "PLAYER_PASSES":
    case "PLAYER_OFFSIDES":
    case "PLAYER_2_OR_MORE_GOALS":
    case "PLAYER_3_OR_MORE_GOALS":
    case "PLAYER_GOAL_OR_ASSIST":
    case "PLAYER_GOAL_AND_ASSIST":
    case "PLAYER_HEADER_GOAL":
    case "PLAYER_LEFT_FOOT_GOAL":
    case "PLAYER_RIGHT_FOOT_GOAL":
    case "PLAYER_GOAL_OUTSIDE_BOX":
    case "PENALTY_SCORER":
    case "PLAYER_FREE_KICK_GOAL":
    case "FIRST_PLAYER_CARDED":
    case "PLAYER_OF_THE_MATCH": {
      if (isNoneSelection(lower)) return "NONE" as NormalizedSelection;
      const cleaned = trimmed.replace(/^\d+\.\s*/, "").trim();
      // Per-player stat lines arrive as "Lastname, Firstname - powyżej N.5".
      // Over 0.5 is the base "records at least one" bet peers quote under the
      // bare player name; higher lines keep an explicit "N+" suffix so a 3+
      // price is never merged into the 1+ comparison column.
      const withLine = cleaned.match(/^(.+?)\s*-\s*powy[żz]ej\s+(\d+(?:[.,]\d+)?)\s*$/iu);
      if (withLine) {
        const player = canonicalizePlayerName(withLine[1].trim());
        const atLeast = Math.floor(parseFloat(withLine[2].replace(",", "."))) + 1;
        return (atLeast <= 1 ? player : `${player} ${atLeast}+`) as NormalizedSelection;
      }
      // Superbet quotes players as "Lastname, Firstname"; canonicalize to
      // "Firstname Lastname" so selections line up across bookmakers.
      return canonicalizePlayerName(cleaned) as NormalizedSelection;
    }

    case "OTHER":
      return "UNKNOWN";

    default:
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
  }
}

/** Range/exact-count selections: "1-2", "6+", "<9" -> "0-8", "brak goli" -> "0". */
function normalizeRangeSelection(trimmed: string, lower: string): NormalizedSelection {
  if (isNoneSelection(lower)) return "0" as NormalizedSelection;
  const lessThan = trimmed.match(/^<\s*(\d+)$/);
  if (lessThan) return `0-${parseInt(lessThan[1], 10) - 1}` as NormalizedSelection;
  if (/^\d+\+$/.test(trimmed)) return trimmed as NormalizedSelection;
  const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) return `${range[1]}-${range[2]}` as NormalizedSelection;
  if (/^\d+$/.test(trimmed)) return trimmed as NormalizedSelection;
  return "UNKNOWN";
}

/**
 * European-handicap lines come in score notation on the selections,
 * e.g. "Argentyna (0:2)" = home receives a 2-goal deficit -> "-2".
 */
function extractScoreHandicapParam(selectionNames: string[]): string | undefined {
  for (const name of selectionNames) {
    const match = name.match(/\((\d+)\s*:\s*(\d+)\)/);
    if (match) {
      const home = parseInt(match[1], 10);
      const away = parseInt(match[2], 10);
      if (home > 0) return `+${home}`;
      if (away > 0) return `-${away}`;
      return "0";
    }
  }
  return undefined;
}

/**
 * Decimal handicap lines are attached per side ("Argentyna (-4.5)",
 * "Republika Zielonego Przylądka (4.5)"). Prefer the HOME selection so the
 * parameter sign is consistently expressed from the home perspective.
 */
function extractDecimalHandicapParam(
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): string | undefined {
  for (const sel of raw.selections) {
    const match = sel.name.match(/\(([+-]?\d+(?:[.,]\d+)?)\)\s*$/);
    if (!match) continue;
    const side = normalize1x2Selection(
      stripLineSuffix(sel.name),
      ctx.homeTeam,
      ctx.awayTeam,
      ctx.league
    );
    if (side === "HOME") {
      const value = match[1].replace(",", ".");
      if (!value.startsWith("+") && !value.startsWith("-") && parseFloat(value) > 0) {
        return `+${value}`;
      }
      return value;
    }
  }

  for (const sel of raw.selections) {
    const handicap = parseHandicapLine(sel.name);
    if (handicap) return handicap;
  }
  return parseHandicapLine(raw.name) ?? undefined;
}

function extractParamValue(
  marketCode: NormalizedMarketType,
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): string | undefined {
  if (!PARAMETERIZED_MARKETS.has(marketCode)) return undefined;

  const selectionNames = raw.selections.map((s) => s.name);

  if (HANDICAP_MARKETS.has(marketCode)) {
    if (SCORE_HANDICAP_MARKETS.has(marketCode)) {
      const scoreParam = extractScoreHandicapParam(selectionNames);
      if (scoreParam) return scoreParam;
    }
    return extractDecimalHandicapParam(raw, ctx);
  }

  if (marketCode === "NTH_CORNER") {
    for (const name of selectionNames) {
      const match = name.match(/^(\d+)\s*-\s/);
      if (match) return match[1];
    }
    return undefined;
  }

  const paramFromSelections = parseOverUnderLine(selectionNames);
  if (paramFromSelections) return paramFromSelections;

  // Strip half ordinals ("1.połowa", "2. połowa") so they are not mistaken
  // for a goals line when falling back to the market name.
  const nameForLine = raw.name.replace(/\b[12]\s*\.?\s*po[łl]ow\w*/giu, " ");
  const decimalLine = parseDecimalLine(nameForLine);
  if (decimalLine) return decimalLine;

  const integerLine = parseIntegerLine(nameForLine);
  if (integerLine) return integerLine;

  return undefined;
}

export const superbetNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "superbet",

  normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null {
    const resolved = resolveMarketCode(raw);
    let marketCode = resolved.marketCode;
    const { matchedBy, rawId } = resolved;

    // Guard: correct-score shaped entries ("Liczba goli 0:2") must never
    // enter goal-line markets - the digits are a scoreline, not a threshold.
    if (
      (marketCode === "TOTAL_GOALS" ||
        marketCode === "HALF_TIME_TOTAL_GOALS" ||
        marketCode === "SECOND_HALF_TOTAL_GOALS") &&
      /\d+\s*:\s*\d+/.test(raw.name)
    ) {
      marketCode = "OTHER";
    }

    // Guard: a bare yes/no pair can never form a handicap market.
    if (
      HANDICAP_MARKETS.has(marketCode) &&
      raw.selections.length > 0 &&
      raw.selections.every((s) => /^(tak|nie)$/i.test(s.name.trim()))
    ) {
      marketCode = "OTHER";
    }

    // Guard: goal O/U sliders accept only plain over/under goal lines.
    // Superbet groups combo variants ("{team} - 1.połowa liczba goli &
    // 2.połowa liczba goli", "... lub ...") and exact-count markets under
    // ids/names that resolve to the goals family - exclude them.
    if (GOALS_OVER_UNDER_FAMILY.has(marketCode) && isNonGoalsLineName(raw.name)) {
      marketCode = "OTHER";
    }

    // Route minute-checkpoint goal totals by the actual minute value.
    if (marketCode === "GOAL_BY_MINUTE") {
      marketCode = resolveGoalByMinuteCode(raw);
    }

    if (!isValidMarketCode(marketCode)) {
      console.error(`[superbet] Market code "${marketCode}" not in catalog`);
      return null;
    }

    const marketMetadata = getMarketMetadata(marketCode);
    const marketName = marketMetadata?.labels.pl ?? raw.name;

    const paramValue = extractParamValue(marketCode, raw, ctx);
    const marketKey = buildMarketKey(marketCode, paramValue);

    const side = rawId !== undefined ? SUPERBET_SIDE_BY_MARKET_ID[rawId] : undefined;

    const selections = raw.selections.map((sel) => {
      let code = normalizeSelectionForMarket(sel.name, marketCode, ctx);
      // Side-specific market ids feed catalog codes with side-prefixed
      // selections (HOME_OVER, AWAY_1-2, ...).
      if (side && SIDED_SELECTION_MARKETS.has(marketCode) && code !== "UNKNOWN") {
        code = `${side}_${code}` as NormalizedSelection;
      }
      return {
        code,
        label: sel.name,
        odds: sel.odds,
      };
    });

    if (marketCode === "OTHER" && matchedBy !== "id") {
      console.warn(`[superbet] Unmapped market "${raw.name}" (id: ${rawId ?? "none"})`);
    }

    return {
      marketCode,
      paramValue,
      marketKey,
      marketName,
      selections,
      debug: {
        rawName: raw.name,
        rawId: rawId ?? undefined,
        matchedBy,
      },
    } as NormalizedMarketOutput;
  },

};

export default superbetNormalizer;
