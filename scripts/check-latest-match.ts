import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

// Pobierz ostatni mecz z Betclic
const { data, error } = await supabase
  .from('matches')
  .select('id, bookmaker_id, home_team, away_team, start_time')
  .eq('bookmaker', 'betclic')
  .order('start_time', { ascending: false })
  .limit(1);

if (error) console.error('Error:', error);
else console.log(JSON.stringify(data, null, 2));
