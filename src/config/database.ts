import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { CONFIG } from "./index.js";
import type { Database } from "../types/database.js";

let supabaseClient: SupabaseClient<Database> | null = null;

/**
 * Get Supabase client with service role key
 * Service role bypasses RLS for backend operations
 */
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

/**
 * Test database connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("scraped_odds").select("id").limit(1);

    if (error && error.code !== "PGRST116") {
      // PGRST116 = table doesn't exist yet (before migration)
      console.error("Database connection test failed:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Database connection error:", error);
    return false;
  }
}
