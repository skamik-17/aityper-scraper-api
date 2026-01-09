#!/usr/bin/env npx tsx
/**
 * Apply migration 005 - Add missing market types
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const MARKET_TYPES = [
  {
    id: 46,
    code: "FIRST_TEAM_TO_SCORE",
    name_pl: "Która drużyna strzeli gola",
    name_en: "First Team To Score",
    description_pl: "Która drużyna strzeli pierwszego gola?",
    description_en: "Which team will score first?",
    category: "GOLE",
    selections: ["HOME", "AWAY", "NONE", "BOTH"],
    view_type: "TRIPLE_BUTTONS",
    has_parameter: false,
    param_type: null,
    display_order: 21,
  },
  {
    id: 47,
    code: "FIRST_GOAL_TIME",
    name_pl: "Czas pierwszego gola",
    name_en: "First Goal Time",
    description_pl: "W którym przedziale czasowym padnie pierwszy gol?",
    description_en: "In which time period will the first goal be scored?",
    category: "GOLE",
    selections: ["0-15", "16-30", "31-45", "46-60", "61-75", "76-90", "NONE"],
    view_type: "TRIPLE_BUTTONS",
    has_parameter: false,
    param_type: null,
    display_order: 22,
  },
  {
    id: 48,
    code: "TIME_PERIOD_RESULT",
    name_pl: "Wynik w przedziale czasowym",
    name_en: "Time Period Result",
    description_pl: "Jaki będzie wynik w określonym przedziale czasowym?",
    description_en: "What will be the result in a specific time period?",
    category: "GOLE",
    selections: ["HOME", "DRAW", "AWAY"],
    view_type: "TRIPLE_BUTTONS",
    has_parameter: true,
    param_type: "integer",
    display_order: 23,
  },
  {
    id: 49,
    code: "FIRST_GOAL_AND_RESULT",
    name_pl: "Pierwszy gol i wynik",
    name_en: "First Goal & Result",
    description_pl: "Która drużyna strzeli pierwszego gola i jaki będzie wynik?",
    description_en: "Which team scores first and what will be the result?",
    category: "KOMBINACJE",
    selections: ["HOME_HOME", "HOME_DRAW", "HOME_AWAY", "AWAY_HOME", "AWAY_DRAW", "AWAY_AWAY", "NONE"],
    view_type: "COMBINATION",
    has_parameter: false,
    param_type: null,
    display_order: 86,
  },
  {
    id: 50,
    code: "PLAYER_GOAL_AND_RESULT",
    name_pl: "Gol zawodnika i wynik",
    name_en: "Player Goal & Result",
    description_pl: "Zawodnik strzeli gola i jaki będzie wynik meczu?",
    description_en: "Player scores and what will be the match result?",
    category: "ZAWODNICY",
    selections: ["PLAYER_HOME", "PLAYER_DRAW", "PLAYER_AWAY"],
    view_type: "PLAYER_DROPDOWN",
    has_parameter: true,
    param_type: "player",
    display_order: 66,
  },
  {
    id: 51,
    code: "PLAYER_SHOTS_ON_TARGET",
    name_pl: "Celne strzały zawodnika",
    name_en: "Player Shots On Target",
    description_pl: "Liczba celnych strzałów zawodnika",
    description_en: "Player shots on target count",
    category: "ZAWODNICY",
    selections: ["OVER", "UNDER"],
    view_type: "PLAYER_DROPDOWN",
    has_parameter: true,
    param_type: "player",
    display_order: 67,
  },
  {
    id: 52,
    code: "PLAYER_PASSES",
    name_pl: "Podania zawodnika",
    name_en: "Player Passes",
    description_pl: "Liczba podań zawodnika",
    description_en: "Player pass count",
    category: "ZAWODNICY",
    selections: ["OVER", "UNDER"],
    view_type: "PLAYER_DROPDOWN",
    has_parameter: true,
    param_type: "player",
    display_order: 68,
  },
];

async function main() {
  console.log("=".repeat(60));
  console.log("Applying Migration 005: Add Missing Market Types");
  console.log("=".repeat(60));
  console.log();

  for (const mt of MARKET_TYPES) {
    const { data: existing } = await supabase
      .from("market_types")
      .select("id")
      .eq("id", mt.id)
      .single();

    if (existing) {
      // Update existing
      const { error } = await supabase
        .from("market_types")
        .update({
          code: mt.code,
          name_pl: mt.name_pl,
          name_en: mt.name_en,
          description_pl: mt.description_pl,
          description_en: mt.description_en,
          category: mt.category,
          selections: mt.selections,
          view_type: mt.view_type,
          has_parameter: mt.has_parameter,
          param_type: mt.param_type,
          display_order: mt.display_order,
        })
        .eq("id", mt.id);

      if (error) {
        console.log(`  ❌ [${mt.id}] ${mt.code}: Update failed - ${error.message}`);
      } else {
        console.log(`  ✅ [${mt.id}] ${mt.code}: Updated`);
      }
    } else {
      // Insert new
      const { error } = await supabase.from("market_types").insert(mt);

      if (error) {
        console.log(`  ❌ [${mt.id}] ${mt.code}: Insert failed - ${error.message}`);
      } else {
        console.log(`  ✅ [${mt.id}] ${mt.code}: Inserted`);
      }
    }
  }

  console.log();
  console.log("Verification:");
  console.log("-".repeat(60));

  const { data: result } = await supabase
    .from("market_types")
    .select("id, code, category, display_order")
    .gte("id", 46)
    .lte("id", 52)
    .order("id");

  if (result && result.length > 0) {
    result.forEach((t) => {
      console.log(`  [${t.id}] ${t.code} (${t.category}) - order: ${t.display_order}`);
    });
    console.log();
    console.log(`✅ Migration complete: ${result.length} market types added/updated`);
  } else {
    console.log("  No market types found in range 46-52");
  }
}

main().catch(console.error);
