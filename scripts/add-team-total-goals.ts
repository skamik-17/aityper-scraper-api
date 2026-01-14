
import "dotenv/config";
import { getSupabase } from "../src/config/database.js";

const marketsToUpsert = [
  {
    id: 244,
    code: "HOME_TEAM_TOTAL_GOALS",
    name_pl: "Gole gospodarzy",
    name_en: "Home Team Goals",
    description_pl: "Liczba goli gospodarzy",
    description_en: "Home team goal count",
    view_type: 'PARAMETER_SLIDER',
    category: 'GOLE',
    has_parameter: true,
    param_type: 'decimal',
    selections: ["OVER", "UNDER"],
    display_order: 244
  },
  {
    id: 245,
    code: "AWAY_TEAM_TOTAL_GOALS",
    name_pl: "Gole gości",
    name_en: "Away Team Goals",
    description_pl: "Liczba goli gości",
    description_en: "Away team goal count",
    view_type: 'PARAMETER_SLIDER',
    category: 'GOLE',
    has_parameter: true,
    param_type: 'decimal',
    selections: ["OVER", "UNDER"],
    display_order: 245
  },
  {
    id: 246,
    code: "HALF_TIME_HOME_TEAM_TOTAL_GOALS",
    name_pl: "1. połowa - gole gospodarzy",
    name_en: "1st Half Home Team Goals",
    description_pl: "Liczba goli gospodarzy w 1. połowie",
    description_en: "Home team goals in 1st half",
    view_type: 'PARAMETER_SLIDER',
    category: 'PIERWSZA_POLOWA',
    has_parameter: true,
    param_type: 'decimal',
    selections: ["OVER", "UNDER"],
    display_order: 246
  },
  {
    id: 247,
    code: "HALF_TIME_AWAY_TEAM_TOTAL_GOALS",
    name_pl: "1. połowa - gole gości",
    name_en: "1st Half Away Team Goals",
    description_pl: "Liczba goli gości w 1. połowie",
    description_en: "Away team goals in 1st half",
    view_type: 'PARAMETER_SLIDER',
    category: 'PIERWSZA_POLOWA',
    has_parameter: true,
    param_type: 'decimal',
    selections: ["OVER", "UNDER"],
    display_order: 247
  },
  {
    id: 248,
    code: "SECOND_HALF_HOME_TEAM_TOTAL_GOALS",
    name_pl: "2. połowa - gole gospodarzy",
    name_en: "2nd Half Home Team Goals",
    description_pl: "Liczba goli gospodarzy w 2. połowie",
    description_en: "Home team goals in 2nd half",
    view_type: 'PARAMETER_SLIDER',
    category: 'PIERWSZA_POLOWA',
    has_parameter: true,
    param_type: 'decimal',
    selections: ["OVER", "UNDER"],
    display_order: 248
  },
  {
    id: 249,
    code: "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS",
    name_pl: "2. połowa - gole gości",
    name_en: "2nd Half Away Team Goals",
    description_pl: "Liczba goli gości w 2. połowie",
    description_en: "Away team goals in 2nd half",
    view_type: 'PARAMETER_SLIDER',
    category: 'PIERWSZA_POLOWA',
    has_parameter: true,
    param_type: 'decimal',
    selections: ["OVER", "UNDER"],
    display_order: 249
  }
];

async function run() {
  console.log('Connecting to Supabase...');
  const supabase = getSupabase();
  
  const { error } = await supabase
    .from('market_types')
    .upsert(marketsToUpsert, { onConflict: 'id' });
    
  if (error) {
    console.error('Error updating markets:', error);
    process.exit(1);
  }
  
  console.log('Successfully added team total goals markets!');
  process.exit(0);
}

run();
