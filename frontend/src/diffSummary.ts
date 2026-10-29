// Rule-based plain-language explanation of a unified diff; no model or network involved.
// It reads declarations, calls and code patterns from the changed lines, so it explains
// what changed structurally, not why.

export type FileSummary = {
  path: string;
  status: "added" | "deleted" | "renamed" | "modified";
  from?: string;
  add: number;
  del: number;
  notes: string[];
};
export type DiffSummary = { overview: string[]; files: FileSummary[] };

type Scope = { kind?: string; add: string[]; del: string[]; declAdded: boolean; declRemoved: boolean };
type File = Omit<FileSummary, "notes"> & { scopes: Map<string, Scope> };

// Declarations across JS/TS, Rust, Python, Go, Java/C#-style languages, on +, - or context lines.
const DECL =
  /^[+\- ]\s*(?:export\s+|default\s+|pub(?:\([^)]*\))?\s+|async\s+|static\s+|public\s+|private\s+|protected\s+|abstract\s+|unsafe\s+)*(function\*?|class|interface|type|enum|fn|struct|trait|impl|def|func|mod)\s+([A-Za-z_$][\w$]*)/;
// `const name = (...) =>` and `const name = function` count as functions.
const ARROW =
  /^[+\- ]\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|function\b)/;
const KIND: Record<string, string> = { "function*": "function", fn: "function", def: "function", func: "function", mod: "module" };
const CALL = /((?:[A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*!?))\s*\(/g;
const NOT_CALLS = new Set(
  "if for while switch catch return function match typeof new await async Some Ok Err Box Vec String super this self loop sizeof".split(" "),
);
// Code patterns that describe an approach; each is reported when it appears on one side only.
const PATTERNS: [string, RegExp][] = [
  ["error handling", /\btry\b|\bcatch\b|\bthrow\b|\braise\b|\bexcept\b|\?;|\?\)|\bErr\(|\.map_err\(|\.unwrap_or|\.catch\(/],
  ["a loop", /\b(for|while|loop)\b|\.(map|forEach|filter|reduce|flatMap|iter)\(/],
  ["a condition", /\b(if|else|match|switch|case)\b/],
  ["async/await", /\bawait\b|\basync\b|\.then\(|\.await\b/],
  ["logging", /console\.\w+\(|\b(e?println|dbg|log::\w+)!|\blogger\.|\bprint\(/],
  ["an unwrap/non-null assertion", /\.unwrap\(\)|\.expect\(|\w!\./],
];
const COMMENT = /^\s*(\/\/|\/\*|\*|#(?!\[)|--|<!--)/;
const TEST = /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.[a-z]+$|_test\.(go|py|rs)$/i;
const MANIFEST = /(^|\/)(package\.json|Cargo\.toml)$/;
// shortcut: version-looking values only, so a version-like key outside the dependency sections can still be listed; parse whole manifests if that matters.
const NPM_DEP = /^([+-])\s*"([^"]+)":\s*"([\^~>=<*]?\s*\d[^"]*|workspace:[^"]*|latest)",?$/;
const CARGO_DEP = /^([+-])\s*([A-Za-z0-9_-]+)\s*=\s*(?:"(\d[^"]*)"|\{[^}]*version\s*=\s*"([^"]+)")/;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const list = (names: string[], max = 4) =>
  names.length > max ? `${names.slice(0, max).join(", ")} and ${names.length - max} more` : names.join(", ");
const code = (names: string[]) => list(names.map((n) => "`" + n + "`"));

function declOf(line: string): { name: string; kind: string } | undefined {
  const d = DECL.exec(line);
  if (d) return { name: d[2], kind: KIND[d[1]] ?? d[1] };
  const a = ARROW.exec(line);
  return a ? { name: a[1], kind: "function" } : undefined;
}

function calls(lines: string[], self: string) {
  const out = new Set<string>();
  for (const line of lines) {
    if (COMMENT.test(line)) continue;
    for (const m of line.matchAll(CALL)) if (!NOT_CALLS.has(m[2]) && m[2] !== self) out.add(m[1]);
  }
  return out;
}

const has = (lines: string[], re: RegExp) => lines.some((l) => !COMMENT.test(l) && re.test(l));

// What a brand-new function or type contains.
function describeNew(name: string, body: string[]) {
  const parts: string[] = [];
  const called = [...calls(body, name)];
  if (called.length) parts.push(`calls ${code(called)}`);
  const uses = PATTERNS.filter(([, re]) => has(body, re)).map(([label]) => label);
  if (uses.length) parts.push(`uses ${list(uses, 6)}`);
  return parts.length ? ` — ${parts.join("; ")}` : "";
}

// How the approach inside an existing function changed between its removed and added lines.
function describeChange(name: string, s: Scope): string | undefined {
  const strip = (l: string) => l.replace(/\s+/g, "");
  if (s.add.join("\n") === s.del.join("\n")) return undefined;
  if (s.add.map(strip).join() === s.del.map(strip).join()) return "formatting only";
  if ([...s.add, ...s.del].every((l) => COMMENT.test(l) || !l.trim())) return "comments only";
  const before = calls(s.del, name);
  const after = calls(s.add, name);
  const gained = [...after].filter((c) => !before.has(c));
  const lost = [...before].filter((c) => !after.has(c));
  const parts: string[] = [];
  if (gained.length && lost.length) parts.push(`now calls ${code(gained)} instead of ${code(lost)}`);
  else if (gained.length) parts.push(`now also calls ${code(gained)}`);
  else if (lost.length) parts.push(`no longer calls ${code(lost)}`);
  for (const [label, re] of PATTERNS) {
    const a = has(s.add, re);
    const d = has(s.del, re);
    if (a && !d) parts.push(`adds ${label}`);
    else if (d && !a) parts.push(`removes ${label}`);
  }
  if (!parts.length) {
    const changed = Math.max(s.add.length, s.del.length);
    parts.push(
      !s.del.length ? `adds ${plural(s.add.length, "line")}` : !s.add.length ? `removes ${plural(s.del.length, "line")}` : `rewrites ${plural(changed, "line")}`,
    );
  }
  return parts.join("; ");
}

export function summarizeDiff(text: string): DiffSummary {
  const files: File[] = [];
  const deps = new Map<string, { from?: string; to?: string }>();
  let todos = 0;
  let file: File | undefined;
  let scope = "";
  const scopeOf = (f: File, name: string, kind?: string) => {
    let s = f.scopes.get(name);
    if (!s) f.scopes.set(name, (s = { kind, add: [], del: [], declAdded: false, declRemoved: false }));
    if (kind) s.kind ??= kind;
    return s;
  };
  for (const line of text.split("\n")) {
    const head = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (head) {
      file = { path: head[2], status: "modified", add: 0, del: 0, scopes: new Map() };
      files.push(file);
      scope = "";
      continue;
    }
    // Untracked-file previews and bare hunks have no header; treat them as one unnamed file.
    if (!file && /^[+\-@]/.test(line)) {
      file = { path: "", status: "modified", add: 0, del: 0, scopes: new Map() };
      files.push(file);
    }
    if (!file) continue;
    if (line.startsWith("new file mode")) file.status = "added";
    else if (line.startsWith("deleted file mode")) file.status = "deleted";
    else if (line.startsWith("rename from ")) {
      file.status = "renamed";
      file.from = line.slice(12);
    } else if (/^(\+\+\+ (b\/|\/dev\/null)|--- (a\/|\/dev\/null)|\\)/.test(line)) continue;
    else if (line.startsWith("@@")) {
      // git puts the enclosing function or class after the hunk header.
      const ctx = /^@@[^@]*@@\s*(.*)$/.exec(line)?.[1];
      scope = (ctx && declOf(" " + ctx)?.name) || "";
    } else {
      const d = declOf(line);
      if (d) {
        scope = d.name;
        const s = scopeOf(file, d.name, d.kind);
        if (line[0] === "+") s.declAdded = true;
        if (line[0] === "-") s.declRemoved = true;
      }
      if (line[0] !== "+" && line[0] !== "-") continue;
      const added = line[0] === "+";
      if (added) file.add++;
      else file.del++;
      const s = scopeOf(file, scope);
      (added ? s.add : s.del).push(line.slice(1));
      if (added && /\b(TODO|FIXME|HACK|XXX)\b/.test(line)) todos++;
      const dep = MANIFEST.test(file.path) && (NPM_DEP.exec(line) ?? CARGO_DEP.exec(line));
      if (dep && dep[2] !== "version") {
        const v = deps.get(dep[2]) ?? {};
        v[added ? "to" : "from"] = dep[3] ?? dep[4];
        deps.set(dep[2], v);
      }
    }
  }

  const summaries: FileSummary[] = files.map((f) => {
    const notes: string[] = [];
    if (f.status === "renamed") notes.push(`Renamed from ${f.from}.`);
    for (const [name, s] of f.scopes) {
      if (!name) continue;
      const label = `${s.kind ?? "function"} \`${name}\``;
      if (s.declAdded && !s.declRemoved) notes.push(`Adds ${label}${describeNew(name, s.add)}.`);
      else if (s.declRemoved && !s.declAdded) notes.push(`Removes ${label}.`);
      else {
        const how = describeChange(name, s);
        if (s.declAdded && s.declRemoved) notes.push(`Changes the signature of ${label}${how ? `; ${how}` : ""}.`);
        else if (how) notes.push(`In ${label}: ${how}.`);
      }
    }
    const top = f.scopes.get("");
    if (top && f.status === "modified" && !MANIFEST.test(f.path)) {
      const how = describeChange("", top);
      if (how) notes.push(`Outside any function: ${how}.`);
    }
    if (f.status === "added" && !notes.length) notes.push(`New file with ${plural(f.add, "line")}.`);
    if (f.status === "deleted" && !notes.length) notes.push(`Deleted file with ${plural(f.del, "line")}.`);
    return { path: f.path, status: f.status, from: f.from, add: f.add, del: f.del, notes };
  });

  const overview: string[] = [];
  if (files.length) {
    const add = files.reduce((n, f) => n + f.add, 0);
    const del = files.reduce((n, f) => n + f.del, 0);
    overview.push(`${plural(files.length, "file")} changed: ${plural(add, "line")} added, ${plural(del, "line")} removed.`);
    const counts = (["added", "deleted", "renamed"] as const)
      .map((st) => [st, files.filter((f) => f.status === st).length] as const)
      .filter(([, n]) => n)
      .map(([st, n]) => `${n} ${st}`);
    if (counts.length) overview.push(`Files: ${counts.join(", ")}.`);
  }
  const depLines = [...deps]
    .map(([name, v]) => (v.from && v.to ? (v.from === v.to ? "" : `${name} ${v.from} → ${v.to}`) : v.to ? `adds ${name} ${v.to}` : `removes ${name}`))
    .filter(Boolean);
  if (depLines.length) overview.push(`Dependencies: ${list(depLines)}.`);
  const tests = files.filter((f) => TEST.test(f.path)).length;
  const sources = files.filter((f) => f.path && !MANIFEST.test(f.path) && !/\.(md|txt|lock|json|ya?ml|toml|css|svg|png)$/i.test(f.path));
  if (tests) overview.push(`Touches ${plural(tests, "test file")}.`);
  else if (sources.length) overview.push("No test files changed.");
  if (todos) overview.push(`Adds ${plural(todos, "TODO/FIXME note")}.`);
  return { overview, files: summaries };
}
