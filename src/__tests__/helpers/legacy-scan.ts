/**
 * Plan 10 Part B: a TypeScript-AST scan of the legacy 1X2 path (scrapeLeague & co.):
 * where its methods still live, who still calls them, and which exported helpers only
 * they use. Test/tooling code: the guard test and scripts/legacy-lines.ts use it.
 * Paths in results are relative to the repo root, with forward slashes.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

export const LEGACY_METHODS: readonly string[] = [
  "scrapeLeague",
  "scrapeMatch",
  "scrapeMatchDetails",
  "extractEventUrls",
  "scrapeEkstraklasa",
  "scrapePremierLeague",
];
const LEGACY = new Set(LEGACY_METHODS);

export interface LegacyMethodHit {
  file: string;
  className: string;
  method: string;
  startLine: number;
  endLine: number;
}

export interface LegacyHelperHit {
  file: string;
  name: string;
  startLine: number;
  endLine: number;
}

const toRel = (repoRoot: string, abs: string) => relative(repoRoot, abs).split(sep).join("/");

function isTestPath(rel: string): boolean {
  return rel.includes("/__tests__/") || /\.(test|spec)\.ts$/.test(rel);
}

/** .ts files under `dir` (recursive unless `shallow`), without tests and declaration files. */
function tsFiles(repoRoot: string, dir: string, shallow = false): string[] {
  const abs = join(repoRoot, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) {
        if (!shallow && name !== "node_modules" && name !== "__tests__") walk(p);
      } else if (name.endsWith(".ts") && !name.endsWith(".d.ts") && !isTestPath(toRel(repoRoot, p))) {
        out.push(p);
      }
    }
  };
  walk(abs);
  return out;
}

const parse = (abs: string) => ts.createSourceFile(abs, readFileSync(abs, "utf8"), ts.ScriptTarget.ES2022, true);
const lineOf = (sf: ts.SourceFile, pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;

function legacyMethodName(n: ts.Node): string | null {
  return ts.isMethodDeclaration(n) && ts.isIdentifier(n.name) && LEGACY.has(n.name.text) ? n.name.text : null;
}

/** The legacy method this node sits in, if any. */
function enclosingLegacyMethod(n: ts.Node): ts.MethodDeclaration | null {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (legacyMethodName(p) !== null) return p as ts.MethodDeclaration;
  }
  return null;
}

function className(n: ts.Node): string {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isClassDeclaration(p) || ts.isClassExpression(p)) return p.name?.text ?? "<anonymous>";
  }
  return "<none>";
}

const byFileThenLine = <T extends { file: string }>(key: (x: T) => number) => (a: T, b: T) =>
  a.file < b.file ? -1 : a.file > b.file ? 1 : key(a) - key(b);

/** Legacy method declarations WITH a body under src/scrapers (tests excluded). */
export function findLegacyMethods(repoRoot: string): LegacyMethodHit[] {
  const hits: LegacyMethodHit[] = [];
  for (const abs of tsFiles(repoRoot, "src/scrapers")) {
    const sf = parse(abs);
    const visit = (n: ts.Node) => {
      const method = legacyMethodName(n);
      if (method !== null && (n as ts.MethodDeclaration).body) {
        hits.push({
          file: toRel(repoRoot, abs),
          className: className(n),
          method,
          startLine: lineOf(sf, n.getStart(sf)),
          endLine: lineOf(sf, n.getEnd()),
        });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return hits.sort(byFileThenLine((h) => h.startLine));
}

/** "bookmakers/forbet" for src/scrapers/bookmakers/forbet/index.ts. */
export function legacyDirOf(file: string): string {
  const under = file.replace(/\\/g, "/").replace(/^.*?src\/scrapers\//, "");
  return under.split("/").slice(0, 2).join("/");
}

/** Property-access calls of a legacy method in src/ and scripts/*.ts, outside legacy method bodies. */
export function findLegacyCalls(repoRoot: string): Array<{ file: string; line: number; method: string }> {
  const hits: Array<{ file: string; line: number; method: string }> = [];
  for (const abs of [...tsFiles(repoRoot, "scripts", true), ...tsFiles(repoRoot, "src")]) {
    const sf = parse(abs);
    const visit = (n: ts.Node) => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        LEGACY.has(n.expression.name.text) &&
        enclosingLegacyMethod(n) === null
      ) {
        hits.push({ file: toRel(repoRoot, abs), line: lineOf(sf, n.getStart(sf)), method: n.expression.name.text });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return hits.sort(byFileThenLine((h) => h.line));
}

function hasExport(n: ts.Node): boolean {
  return ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/**
 * Exported function declarations under src/scrapers whose every reference (resolved with
 * the type checker; imports, re-exports and tests ignored) sits inside a legacy method or
 * inside another legacy-only helper, iterated to a fixpoint. A helper nothing legacy uses
 * is never reported. `pathFilter` keeps helpers whose file path contains it.
 */
export function findLegacyOnlyHelpers(repoRoot: string, pathFilter?: string): LegacyHelperHit[] {
  const rootNames = [...tsFiles(repoRoot, "src"), ...tsFiles(repoRoot, "scripts", true)];
  const program = ts.createProgram(rootNames, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    noLib: true,
    types: [],
    skipLibCheck: true,
    allowImportingTsExtensions: false,
  });
  const checker = program.getTypeChecker();
  const roots = new Set(rootNames.map((f) => f.split(sep).join("/")));
  const sources = program.getSourceFiles().filter((sf) => roots.has(sf.fileName.split(sep).join("/")));

  interface Candidate {
    id: number;
    hit: LegacyHelperHit;
    decl: ts.FunctionDeclaration;
  }
  const candidates: Candidate[] = [];
  const bySymbol = new Map<ts.Symbol, Candidate>();
  const byDecl = new Map<ts.Node, Candidate>();
  for (const sf of sources) {
    const rel = toRel(repoRoot, sf.fileName);
    if (!rel.startsWith("src/scrapers/")) continue;
    for (const st of sf.statements) {
      if (!ts.isFunctionDeclaration(st) || !st.name || !st.body || !hasExport(st)) continue;
      const symbol = checker.getSymbolAtLocation(st.name);
      if (!symbol) continue;
      const c: Candidate = {
        id: candidates.length,
        decl: st,
        hit: { file: rel, name: st.name.text, startLine: lineOf(sf, st.getStart(sf)), endLine: lineOf(sf, st.getEnd()) },
      };
      candidates.push(c);
      bySymbol.set(symbol, c);
      byDecl.set(st, c);
    }
  }
  const names = new Set(candidates.map((c) => c.hit.name));

  // Each reference: inside a legacy method, inside a candidate helper (its id), or elsewhere
  type Ref = { legacy: true } | { helper: number } | { other: true };
  const refs = new Map<number, Ref[]>(candidates.map((c) => [c.id, []]));
  const isImportOrExport = (id: ts.Identifier) =>
    ts.isImportSpecifier(id.parent) ||
    ts.isImportClause(id.parent) ||
    ts.isNamespaceImport(id.parent) ||
    ts.isExportSpecifier(id.parent);
  for (const sf of sources) {
    const visit = (n: ts.Node) => {
      if (ts.isIdentifier(n) && names.has(n.text) && !isImportOrExport(n)) {
        let symbol = checker.getSymbolAtLocation(n);
        if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
        const target = symbol ? bySymbol.get(symbol) : undefined;
        if (target && target.decl.name !== n) {
          let ref: Ref = { other: true };
          if (enclosingLegacyMethod(n) !== null) ref = { legacy: true };
          else {
            for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
              const owner = byDecl.get(p);
              if (owner) {
                ref = { helper: owner.id };
                break;
              }
            }
          }
          refs.get(target.id)!.push(ref);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  const legacyOnly = new Set<number>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const c of candidates) {
      if (legacyOnly.has(c.id)) continue;
      const rs = refs.get(c.id)!;
      const allLegacy = rs.every((r) => "legacy" in r || ("helper" in r && (r.helper === c.id || legacyOnly.has(r.helper))));
      const usedByLegacy = rs.some((r) => "legacy" in r || ("helper" in r && r.helper !== c.id && legacyOnly.has(r.helper)));
      if (rs.length > 0 && allLegacy && usedByLegacy) {
        legacyOnly.add(c.id);
        changed = true;
      }
    }
  }

  return candidates
    .filter((c) => legacyOnly.has(c.id) && (pathFilter === undefined || c.hit.file.includes(pathFilter) || `/${c.hit.file}`.includes(pathFilter)))
    .map((c) => c.hit)
    .sort(byFileThenLine((h) => h.startLine));
}

/** Names of the exported declarations of one file (no program). */
export function exportedNames(repoRoot: string, file: string): string[] {
  const sf = parse(join(repoRoot, file));
  const out: string[] = [];
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st)) {
      if (st.exportClause && ts.isNamedExports(st.exportClause)) for (const el of st.exportClause.elements) out.push(el.name.text);
      continue;
    }
    if (!hasExport(st)) continue;
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) out.push(d.name.text);
    } else if (
      (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) ||
        ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) &&
      st.name
    ) {
      out.push(st.name.text);
    }
  }
  return out;
}
