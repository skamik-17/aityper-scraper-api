import { getSupabase } from "./src/config/database.js";

async function main() {
  const sb = getSupabase();
  let total = 0;
  for (;;) {
    const { data, error } = await (sb as any)
      .from("odds")
      .select("id")
      .eq("league_slug", "world-cup-2026")
      .limit(500);
    if (error) throw error;
    if (!data || data.length === 0) break;
    const ids = data.map((r: any) => r.id);
    const { error: delErr } = await (sb as any).from("odds").delete().in("id", ids);
    if (delErr) throw delErr;
    total += ids.length;
    console.log(`deleted ${total}...`);
  }
  const { count } = await (sb as any)
    .from("odds")
    .select("id", { count: "exact", head: true })
    .eq("league_slug", "world-cup-2026");
  console.log(`DONE. total deleted=${total}, remaining=${count}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
