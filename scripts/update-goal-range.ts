
import "dotenv/config";
import { getSupabase } from "../src/config/database.js";

const marketsToUpsert = [
  {
    id: 12,
    code: "GOAL_RANGE",
    name_pl: "Przedział goli",
    name_en: "Goal Range",
    description_pl: "W jakim przedziale będzie liczba goli?",
    description_en: "Goal range bracket",
    view_type: 'COMBINATION',
    category: 'GOLE',
    has_parameter: false,
    param_type: null,
    selections: ["0", "1", "2", "3", "4", "5", "6+", "7+", "0-1", "0-2", "1-2", "1-3", "1-4", "1-5", "1-6", "2-3", "2-4", "2-5", "2-6", "3-4", "3-5", "3-6", "4-5", "4-6", "5-6", "5+"],
    display_order: 19
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
  
  console.log('Successfully updated GOAL_RANGE market!');
  process.exit(0);
}

run();
