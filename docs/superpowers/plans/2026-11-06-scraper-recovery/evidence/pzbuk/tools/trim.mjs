// Build durable, trimmed frame fixtures from the full capture.
// Frames are stored as decoded UTF-8 text (they are JSON on the wire) plus the
// original byteLength and binary flag. Trimming keeps original object shapes.
import fs from "node:fs";
const [capPath, outDir] = process.argv.slice(2);
const cap = JSON.parse(fs.readFileSync(capPath, "utf8"));
const KEEP_EVENT_IDS = new Set([4408475]); // Everton FC - Coventry City (always kept)
const GROUP28_KEEP_TYPES = new Set([36, 37, 2179]); // first/last scorer + sure-sub anytime scorer

function text(f) { return Buffer.from(f.b64, "base64").toString("utf8"); }

function trimMultiEvent(env, extraIds) {
  for (const m of env.payload) {
    const p = m.payload;
    const keep = new Set([...KEEP_EVENT_IDS, ...extraIds]);
    p.events = p.events.filter((e) => keep.has(e.id));
    p.markets = (p.markets || []).filter((x) => keep.has(x.eventId));
    p.selections = (p.selections || []).filter((x) => keep.has(x.eventId));
  }
  return env;
}

function build(phase) {
  const out = [];
  // Pick two extra fixtures from the first multi-event snapshot to keep listings realistic
  let extra = [];
  for (const f of cap.frames[phase]) {
    if (f.dir !== "recv") continue;
    const s = text(f);
    let env; try { env = JSON.parse(s); } catch { continue; }
    const st = env?.payload?.[0]?.payload;
    if (st?.events?.length > 1) { extra = st.events.map((e) => e.id).filter((id) => !KEEP_EVENT_IDS.has(id)).slice(0, 2); break; }
  }
  for (const f of cap.frames[phase]) {
    const s = text(f);
    let t = s;
    let trimmed = false;
    if (f.dir === "recv") {
      let env = null; try { env = JSON.parse(s); } catch { /* keep verbatim */ }
      const st = env?.payload?.[0]?.payload;
      if (env?.type === "DATA" && st?.events?.length > 1) { t = JSON.stringify(trimMultiEvent(env, extra)); trimmed = true; }
      else if (env?.type === "DATA" && env.streamId === 11 && phase === "event") {
        for (const m of env.payload) {
          const p = m.payload;
          p.markets = p.markets.filter((x) => GROUP28_KEEP_TYPES.has(x.marketType?.id));
          const ids = new Set(p.markets.map((x) => x.id));
          p.selections = p.selections.filter((x) => ids.has(x.marketId));
        }
        t = JSON.stringify(env); trimmed = true;
      }
    }
    out.push({ dir: f.dir, binary: f.binary, originalByteLength: f.byteLength, trimmed, text: t });
  }
  return { capturedAt: cap.capturedAt, phase, socketUrl: cap.sockets.find((x) => x.phase === phase)?.url, pageUrl: phase === "league" ? cap.leagueMeta.finalUrl : cap.eventMeta.finalUrl, keptExtraEventIds: extra, frames: out };
}
for (const phase of ["league", "event"]) {
  const data = build(phase);
  const p = `${outDir}/ws-${phase}-frames.json`;
  fs.writeFileSync(p, JSON.stringify(data, null, 1) + "\n");
  console.log(p, fs.statSync(p).size, "bytes", data.frames.length, "frames");
}
