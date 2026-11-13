import { ALL_POLISH_BOOKMAKERS } from "../../config/index.js";
import type { Eligibility, Promotion } from "../../types/promotions.js";

/** Words that must never appear in OUR text (labels, notes, coupon actions). */
export const FORBIDDEN_WORDS = [
  "darmow",
  "gratis",
  "bezpłat",
  "bez ryzyka",
  "pewny zysk",
  "zarabiaj",
] as const;

type Catalog = readonly Promotion[];

const SHA256_HEX = /^[0-9a-f]{64}$/;

function isDate(value: string | undefined): boolean {
  return value !== undefined && !Number.isNaN(Date.parse(value));
}

export function findDuplicateIds(catalog: Catalog): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const p of catalog) {
    if (seen.has(p.id)) dups.add(p.id);
    seen.add(p.id);
  }
  return [...dups];
}

export function findBadIdPrefixes(catalog: Catalog): string[] {
  return catalog.filter((p) => !p.id.startsWith(`${p.bookmaker}-`)).map((p) => p.id);
}

export function findUnknownBookmakers(catalog: Catalog): string[] {
  const known: readonly string[] = ALL_POLISH_BOOKMAKERS;
  return catalog.filter((p) => !known.includes(p.bookmaker)).map((p) => p.id);
}

export function findBadVerifiedSources(catalog: Catalog): string[] {
  const out: string[] = [];
  for (const p of catalog) {
    if (p.review.status !== "verified") continue;
    const problems: string[] = [];
    if (!p.source.termsUrl.startsWith("https://")) problems.push("termsUrl");
    if (!SHA256_HEX.test(p.source.termsHash)) problems.push("termsHash");
    if (!isDate(p.source.fetchedAt)) problems.push("fetchedAt");
    if (!isDate(p.review.verifiedAt)) problems.push("verifiedAt");
    if (problems.length > 0) out.push(`${p.id}: ${problems.join(", ")}`);
  }
  return out;
}

export function findFullEffectsWithoutEvidence(catalog: Catalog): string[] {
  const out: string[] = [];
  for (const p of catalog) {
    const keys = Object.keys(p.source.evidence);
    p.effects.forEach((entry, i) => {
      if (entry.valuation !== "full") return;
      const prefix = `effects[${i}]`;
      const has = keys.some((k) => k === prefix || k.startsWith(`${prefix}.`) || k.startsWith(`${prefix}[`));
      if (!has) out.push(`${p.id} ${prefix}`);
    });
  }
  return out;
}

export function findBadAccaTiers(catalog: Catalog): string[] {
  const out: string[] = [];
  for (const p of catalog) {
    p.effects.forEach((entry, i) => {
      if (entry.effect.type !== "ACCA_BONUS") return;
      const { tiers } = entry.effect;
      for (let t = 1; t < tiers.length; t++) {
        if (tiers[t].minLegs <= tiers[t - 1].minLegs || tiers[t].percent < tiers[t - 1].percent) {
          out.push(`${p.id} effects[${i}] tier ${t}`);
          break;
        }
      }
    });
  }
  return out;
}

export function findBadValidityWindows(catalog: Catalog): string[] {
  return catalog
    .filter((p) => p.validFrom && p.validTo && !(Date.parse(p.validTo) > Date.parse(p.validFrom)))
    .map((p) => p.id);
}

export function findMixedExclusiveGroups(catalog: Catalog): string[] {
  const groups = new Map<string, Set<string>>();
  for (const p of catalog) {
    const g = p.stacking.exclusiveGroup;
    if (!g) continue;
    if (!groups.has(g)) groups.set(g, new Set());
    groups.get(g)!.add(p.bookmaker);
  }
  return [...groups].filter(([, bookmakers]) => bookmakers.size > 1).map(([g]) => g);
}

export function findDanglingCombinableWith(catalog: Catalog): string[] {
  const ids = new Set(catalog.map((p) => p.id));
  const out: string[] = [];
  for (const p of catalog) {
    for (const ref of p.stacking.combinableWith) {
      if (!ids.has(ref)) out.push(`${p.id} -> ${ref}`);
    }
  }
  return out;
}

function eligibilityTexts(e: Partial<Eligibility>): string[] {
  return [
    ...(e.requiresConfirmation ?? []).map((c) => c.label),
    ...(e.notes ?? []),
    ...(e.couponAction ? [e.couponAction] : []),
  ];
}

export function findForbiddenWords(catalog: Catalog): string[] {
  const out: string[] = [];
  for (const p of catalog) {
    const texts = [
      ...eligibilityTexts(p.eligibility),
      ...p.effects.flatMap((e) => (e.extraEligibility ? eligibilityTexts(e.extraEligibility) : [])),
    ];
    for (const text of texts) {
      const lower = text.toLowerCase();
      const hit = FORBIDDEN_WORDS.find((w) => lower.includes(w));
      if (hit) out.push(`${p.id}: "${hit}" in "${text}"`);
    }
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Promo codes must never appear in OUR text (name and evidence quotes are exempt). */
export function findPromoCodesInOurText(catalog: Catalog): string[] {
  const out: string[] = [];
  for (const p of catalog) {
    if (p.activation.kind !== "registration_code" && p.activation.kind !== "promo_code") continue;
    const code = p.activation.code;
    if (!code) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(code)}(?![\\p{L}\\p{N}_])`, "iu");
    const check = (text: string | undefined, field: string) => {
      if (text && re.test(text)) out.push(`${p.id}: ${field}`);
    };
    const checkElig = (e: Partial<Eligibility>, prefix: string) => {
      (e.requiresConfirmation ?? []).forEach((c, i) =>
        check(c.label, `${prefix}.requiresConfirmation[${i}].label`),
      );
      (e.notes ?? []).forEach((n, i) => check(n, `${prefix}.notes[${i}]`));
      check(e.couponAction, `${prefix}.couponAction`);
    };
    checkElig(p.eligibility, "eligibility");
    p.effects.forEach((entry, i) => {
      if (entry.extraEligibility) checkElig(entry.extraEligibility, `effects[${i}].extraEligibility`);
      const ef = entry.effect;
      if (ef.type === "FREEBET_GRANT") check(ef.trigger, `effects[${i}].trigger`);
      else if (ef.type === "TASK_REWARD") check(ef.task, `effects[${i}].task`);
      else if (ef.type === "OTHER") check(ef.description, `effects[${i}].description`);
    });
  }
  return out;
}
