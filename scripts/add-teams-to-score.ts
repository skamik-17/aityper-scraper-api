
import "dotenv/config";
import { getSupabase } from "../src/config/database.js";

const marketsToUpsert = [
  {
    id: 251,
    code: "TEAMS_TO_SCORE",
    name_pl: "Która drużyna strzeli",
    name_en: "Teams To Score",
    description_pl: "Które drużyny strzelą gola?",
    description_en: "Which teams will score?",
    view_type: 'COMBINATION',
    category: 'GOLE',
    has_parameter: false,
    param_type: null,
    selections: ["HOME_ONLY", "AWAY_ONLY", "BOTH", "NONE"],
    display_order: 251
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
  
  console.log('Successfully added TEAMS_TO_SCORE market!');
  process.exit(0);
}

run();
