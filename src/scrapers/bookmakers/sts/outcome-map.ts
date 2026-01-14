/**
 * STS Global Outcome ID Mapping
 * 
 * STS uses global outcome IDs that have consistent meanings across markets.
 * This map provides selection names based on outcomeId when outcome.n is empty.
 */

export const STS_OUTCOME_ID_TO_SELECTION: Record<number, string> = {
  // 1X2 selections (Market 1, 71, 102, etc.)
  1: "1",      // HOME
  2: "X",      // DRAW  
  3: "2",      // AWAY
  
  // Draw No Bet / 2-way (Market 11, 75, 105)
  4: "1",      // HOME
  5: "2",      // AWAY
  
  // First/Last goal (Market 8, 9)
  6: "1",      // HOME scores first/last
  7: "Bez gola", // No goal
  8: "2",      // AWAY scores first/last
  
  // Double Chance (Market 10, 74)
  9: "1X",     // HOME_OR_DRAW
  10: "12",    // HOME_OR_AWAY
  11: "X2",    // DRAW_OR_AWAY
  
  // Over/Under (Market 25, 23, 82, 112, etc.)
  12: "Powyżej",  // OVER
  13: "Poniżej",  // UNDER
  
  // Odd/Even (Market 40, 41, 42)
  24: "Nieparzyste",  // ODD
  25: "Parzyste",     // EVEN
  
  // Yes/No (Market 43, 47, 48, 95, 121, 1229, 1224)
  26: "Tak",   // YES
  27: "Nie",   // NO
  
  // Result + BTTS (Market 49)
  28: "1 i Tak",   // HOME + BTTS Yes
  29: "1 i Nie",   // HOME + BTTS No
  30: "X i Tak",   // DRAW + BTTS Yes
  31: "X i Nie",   // DRAW + BTTS No
  32: "2 i Tak",   // AWAY + BTTS Yes
  33: "2 i Nie",   // AWAY + BTTS No
  
  // HT/FT (Market 58)
  138: "1/1",  // HOME/HOME
  139: "1/X",  // HOME/DRAW
  140: "1/2",  // HOME/AWAY
  141: "X/1",  // DRAW/HOME
  142: "X/X",  // DRAW/DRAW
  143: "X/2",  // DRAW/AWAY
  144: "2/1",  // AWAY/HOME
  145: "2/X",  // AWAY/DRAW
  146: "2/2",  // AWAY/AWAY
  
  // First team to score (Market 44)
  231: "1",    // HOME
  232: "2",    // AWAY
  233: "Bez gola", // No goal
  234: "Remis", // Draw
  
  // Goal range outcomes (Market 33, 90, 94)
  1217: "0",
  1218: "1",
  1219: "2",
  1220: "3",
  1221: "4",
  1222: "5",
  1223: "6+",
  
  // Team goal range (Market 35, 36)
  1237: "0",
  1238: "1",
  1239: "2",
  1240: "3+",
  
  // Winning margin (Market 17)
  1262: "1 o 1",
  1263: "1 o 2",
  1264: "1 o 3+",
  1265: "Remis",
  1266: "2 o 1",
  1267: "2 o 2",
  1268: "2 o 3+",

  213: "0-1",
  214: "2-3",
  215: "4-5",
  216: "6-7",
  217: "8+",
  218: "0-2",
  219: "3-4",
  220: "5-6",
  221: "7+",
  222: "9+",
  223: "0",
  224: "1",
  225: "2",
  226: "3+",

  // Corners range (Market 235, 256)
  1521: "0-3",
  1522: "4-6",
  1523: "7+",
  1524: "0",
  1525: "1",
  1526: "2",
  1527: "3+",
  1528: "0-2",
  1529: "3-4",
  1530: "5+",

  // BOTH_HALVES_GOALS outcomes (92-137) - HT/FT exact score combos
  147: "Tak",
  148: "Nie",
  149: "Remis",

  // Goal range outcomes for combo markets (941-960)
  941: "1-2",
  942: "1-3",
  943: "1-4",
  944: "1-5",
  945: "1-6",
  946: "2-3",
  947: "2-4",
  948: "2-5",
  949: "2-6",
  950: "3-4",
  951: "3-5",
  952: "3-6",
  953: "4-5",
  954: "4-6",
  955: "5-6",
  956: "7+",
  1008: "0",

  1009: "3+",

  961: "1 o 1 gol",
  962: "2 o 1 gol",
  963: "1 o 2+ gole",
  964: "2 o 2+ gole",
  965: "Remis 0:0",
  966: "Remis 1:1",
  967: "Remis 2:2",
  968: "Remis 3+",
  1007: "Inne",

  // First goal and result combo (Market 258)
  245: "1 i 1",
  246: "1 i X",
  247: "1 i 2",
  248: "2 i 1",
  249: "2 i X",
  250: "2 i 2",
  251: "Bez gola",

  // Double chance + BTTS (929-934)
  929: "1X i Tak",
  930: "1X i Nie",
  931: "12 i Tak",
  932: "12 i Nie",
  933: "X2 i Tak",
  934: "X2 i Nie",

  // First goal time ranges (Market 125, 126)
  180: "1-15",
  181: "16-30",
  182: "31-45",
  183: "46-60",
  184: "61-75",
  185: "76-90",
  186: "Bez gola",
  187: "1-10",
  188: "11-20",
  189: "21-30",
  190: "31-40",
  191: "41-50",
  192: "51-60",
  193: "61-70",
  194: "71-80",
  195: "81-90",
  196: "Bez gola",

  // Half with more goals (Market 63-66) - 241-244
  241: "1. połowa",
  242: "2. połowa",
  243: "Równo",
  244: "Bez goli",

  // 2nd half team exact goals (Market 119)
  1234: "0",
  1235: "1",
  1236: "2+",

  // HT/FT exact score combo (Market 57) - format: HT score / FT score
  92: "0:0 / 0:0",
  93: "0:0 / 1:0",
  94: "0:0 / 2:0",
  95: "0:0 / 3:0",
  96: "0:0 / 0:1",
  97: "0:0 / 1:1",
  98: "0:0 / 2:1",
  99: "0:0 / 0:2",
  100: "0:0 / 1:2",
  101: "0:0 / 0:3",
  102: "1:0 / 1:0",
  103: "1:0 / 2:0",
  104: "1:0 / 3:0",
  105: "1:0 / 1:1",
  106: "1:0 / 2:1",
  107: "1:0 / 3:1",
  108: "1:0 / 1:2",
  109: "1:0 / 2:2",
  110: "1:0 / 1:3",
  111: "0:1 / 0:1",
  112: "0:1 / 1:1",
  113: "0:1 / 0:2",
  114: "0:1 / 1:2",
  115: "0:1 / 0:3",
  116: "0:1 / 1:3",
  117: "0:1 / 2:1",
  118: "0:1 / 2:2",
  119: "0:1 / 3:1",
  120: "1:1 / 1:1",
  121: "1:1 / 2:1",
  122: "1:1 / 1:2",
  123: "1:1 / 2:2",
  124: "1:1 / 3:1",
  125: "1:1 / 1:3",
  126: "1:1 / 3:2",
  127: "1:1 / 2:3",
  128: "2:0 / 2:0",
  129: "2:0 / 3:0",
  130: "2:0 / 2:1",
  131: "2:0 / 3:1",
  132: "2:0 / 2:2",
  133: "0:2 / 0:2",
  134: "0:2 / 0:3",
  135: "0:2 / 1:2",
  136: "0:2 / 1:3",
  137: "0:2 / 2:2",
};

export const STS_HT_FT_OUTCOMES: Record<number, string> = {
  138: "1/1", 139: "1/X", 140: "1/2",
  141: "X/1", 142: "X/X", 143: "X/2",
  144: "2/1", 145: "2/X", 146: "2/2",
};

export const STS_CORRECT_SCORE_OUTCOMES: Record<number, string> = {
  // Full match (Market 283)
  1783: "0:0", 1784: "0:1", 1785: "0:2", 1786: "0:3", 1787: "0:4", 1788: "0:5",
  1789: "1:0", 1790: "1:1", 1791: "1:2", 1792: "1:3", 1793: "1:4", 1794: "1:5",
  1795: "2:0", 1796: "2:1", 1797: "2:2", 1798: "2:3", 1799: "2:4", 1800: "2:5",
  1801: "3:0", 1802: "3:1", 1803: "3:2", 1804: "3:3", 1805: "3:4", 1806: "3:5",
  1807: "4:0", 1808: "4:1", 1809: "4:2", 1810: "4:3", 1811: "4:4", 1812: "4:5",
  1813: "5:0", 1814: "5:1", 1815: "5:2", 1816: "5:3", 1817: "5:4",
  
  // Half-time (Market 101, 124)
  160: "0:0", 161: "0:1", 162: "0:2",
  163: "1:0", 164: "1:1", 165: "1:2",
  166: "2:0", 167: "2:1", 168: "2:2",
  169: "Inne",
};

export function getSelectionNameByOutcomeId(outcomeId: number): string | null {
  return STS_OUTCOME_ID_TO_SELECTION[outcomeId] 
    || STS_CORRECT_SCORE_OUTCOMES[outcomeId] 
    || null;
}
