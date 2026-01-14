
import "dotenv/config";
import { getSupabase } from "../src/config/database.js";

const marketsToUpsert = [
  {
    id: 231,
    code: "HOME_WIN_TO_NIL",
    name_pl: "Gospodarz wygra do zera",
    name_en: "Home Win To Nil",
    description_pl: "Czy gospodarz wygra do zera?",
    description_en: "Will home team win to nil?",
    view_type: 'BINARY_BUTTONS',
    category: 'WYNIK_MECZU',
    has_parameter: false,
    param_type: null,
    selections: ["YES", "NO"],
    display_order: 231
  },
  {
    id: 232,
    code: "AWAY_WIN_TO_NIL",
    name_pl: "Gość wygra do zera",
    name_en: "Away Win To Nil",
    description_pl: "Czy gość wygra do zera?",
    description_en: "Will away team win to nil?",
    view_type: 'BINARY_BUTTONS',
    category: 'WYNIK_MECZU',
    has_parameter: false,
    param_type: null,
    selections: ["YES", "NO"],
    display_order: 232
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
  
  console.log('Successfully added separate home/away win to nil markets!');
  process.exit(0);
}

run();
