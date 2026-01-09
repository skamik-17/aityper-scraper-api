import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { CONFIG } from "./index.js";
import type { Database } from "../types/database.js";

let supabaseClient: SupabaseClient<Database> | null = null;

export function getSupabase(): SupabaseClient<Database> {
  if (!supabaseClient) {
    supabaseClient = createClient<Database>(
      CONFIG.SUPABASE_URL,
      CONFIG.SUPABASE_SERVICE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
  }
  return supabaseClient;
}

export async function testConnection(): Promise<boolean> {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("market_types").select("id").limit(1);

    if (error && error.code !== "PGRST116") {
      console.error("Database connection test failed:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Database connection error:", error);
    return false;
  }
}
