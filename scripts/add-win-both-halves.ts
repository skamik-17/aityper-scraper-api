
import "dotenv/config";
import { getSupabase } from "../src/config/database.js";

const marketsToUpsert = [
  {
    id: 229,
    code: "HOME_WIN_BOTH_HALVES",
    name_pl: "Gospodarz wygra obie połowy",
    name_en: "Home Win Both Halves",
    description_pl: "Czy gospodarz wygra obie połowy?",
    description_en: "Will home team win both halves?",
    view_type: 'BINARY_BUTTONS',
    category: 'WYNIK_MECZU',
    has_parameter: false,
    param_type: null,
    selections: ["YES", "NO"],
    display_order: 229
  },
  {
    id: 230,
    code: "AWAY_WIN_BOTH_HALVES",
    name_pl: "Gość wygra obie połowy",
    name_en: "Away Win Both Halves",
    description_pl: "Czy gość wygra obie połowy?",
    description_en: "Will away team win both halves?",
    view_type: 'BINARY_BUTTONS',
    category: 'WYNIK_MECZU',
    has_parameter: false,
    param_type: null,
    selections: ["YES", "NO"],
    display_order: 230
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
  
  console.log('Successfully added separate home/away win both halves markets!');
  process.exit(0);
}

run();
