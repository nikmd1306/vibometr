// Server-side assembler: the vendored MS engine + Cursor sessions → a single
// JSON for the dashboard. We take the engine's rich analytics (45 rules, code
// production, group scores) and add our Cursor parser and bilingual language split.

import * as E from "../engine/dist/engine.mjs";
import { parseCursorSessions } from "./cursor-sessions.ts";
import { buildProjectInstrNames, markInstructions } from "./instructions.ts";
import { detectLang } from "./nlp/lang.ts";
import * as C from "./catalog.ts";
import type { Lang } from "./catalog.ts";

export interface VibeAnalysis {
  generatedAt: number;
  range: { from: number; to: number; label: string };
  score: number;
  verdict: string;
  groupScores: { group: string; groupLabel: string; score: number; patternCount: number }[];
  totals: {
    sessions: number;
    requests: number;
    byHarness: Record<string, number>;
  };
  tokens: { prompt: number; completion: number };
  code: { aiLoc: number; aiBlocks: number; byLanguage: { name: string; loc: number }[] };
  langSplit: Record<string, number>;
  models: { name: string; count: number }[];
  workspaces: { name: string; count: number }[];
  harnessStats: { harness: string; sessions: number; requests: number; completion: number }[];
  coverage: {
    harnesses: string[];
    features: { name: string; states: Record<string, "yes" | "rare" | "no"> }[];
    note: string;
  };
  modelStats: { name: string; requests: number; completion: number }[];
  projectStats: { name: string; requests: number; completion: number }[];
  activity: { byHour: number[]; byDay: { date: string; count: number }[]; tokensByDay: { date: string; tokens: number }[]; weekendPct: number; lateNightPct: number };
  antiPatterns: {
    id: string; name: string; group: string; groupLabel: string; severity: string; severityLabel: string;
    occurrences: number; pct: number; unit: string; description: string; suggestion: string; examples: string[];
  }[];
}

function topCounts(items: string[], limit = 8) {
  const m = new Map<string, number>();
  for (const it of items) {
    if (!it) continue;
    m.set(it, (m.get(it) || 0) + 1);
  }
  return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, limit);
}

// Non-prompts that pollute the stats and examples: quick-edit auto-commands
// (Cursor "/fix", "/explain" with no payload) and service wrappers from
// multi-agent orchestration (<teammate-message ...>, <command-name ...>).
// The Claude/Codex parsers strip some of this via slashCommand, Cursor doesn't;
// we clean it uniformly across sources BEFORE the Analyzer.
function isJunkPrompt(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return true;
  if (/^\/[\w-]+$/.test(t)) return true; // bare slash command with no arguments
  if (t.startsWith("<teammate-message")) return true; // subagent reply
  if (/^<(command-name|command-message|system-reminder|local-command|task-notification)/.test(t)) return true;
  // Pure injections/automation, not a user prompt: compaction summary, subagent
  // auto-prompt, skill/slash-template content, AGENTS.md injection.
  if (/^This session is being continued/.test(t)) return true;
  if (/^READ-ONLY task/.test(t)) return true;
  if (/^Base directory for this skill:/.test(t)) return true;
  if (/^#?\s*AGENTS\.md instructions for/i.test(t)) return true;
  if (/^# Simplify:/.test(t)) return true;
  return false;
}

// Codex wraps the real prompt in "# In app browser: …\n## My request for
// Codex:\n<TEXT>". Extract just the user's text, otherwise all 500+ such requests
// look identical (false "duplicates") and pollute the other rules.
const CODEX_WRAP_RE = /## My request for Codex:\s*([\s\S]*)$/;
function normalizeMessage(text: string): string {
  const t = text || "";
  const m = t.match(CODEX_WRAP_RE);
  if (m) return m[1].trim();
  return t;
}

function sanitizeSessions(sessions: any[]): any[] {
  const out: any[] = [];
  for (const s of sessions) {
    const requests: any[] = [];
    for (const r of s.requests || []) {
      const msg = normalizeMessage(r.messageText);
      if (isJunkPrompt(msg)) continue;
      // The text changed (wrapper removed) — update messageText and messageLength
      // so the rules (prompt length, duplicates, profanity) see the real input.
      requests.push(msg === r.messageText ? r : { ...r, messageText: msg, messageLength: [...msg].length });
    }
    if (!requests.length) continue;
    out.push({ ...s, requests, requestCount: requests.length });
  }
  return out;
}

// "Models" that aren't really models: Claude Code service messages with no LLM
// call. Excluded from the per-model breakdown.
const FAKE_MODELS = new Set(["<synthetic>", ""]);

// Rules that aren't measurable from CLI logs (Claude/Codex/Cursor) and would lie
// at 100%, plus rules that on CLI data measure the agent's ARCHITECTURE rather
// than user behavior and are therefore misleading:
//  no-slash-commands  — the slashCommand field is never filled by the parsers (always 0);
//  slow-responses     — >30s is normal for an agentic loop (reads files, runs commands);
//  agentic-no-tools   — agentMode="agent" is set on ALL CLI requests → flags "replied with text";
//  verbose-output     — completionTokens = the sum of the tool loop, not answer "wordiness";
//  low-markdown-ratio — the markdown share of a reply is model behavior, not the vibe-coder's.
// (no-custom-instructions IS measured — we detect instruction files on disk.)
const SUPPRESS = new Set([
  "no-slash-commands", "slow-responses", "agentic-no-tools", "verbose-output", "low-markdown-ratio",
  // excessive-file-context — about user-attached #file (Copilot/IDE). On CLI it
  // catches large agentic moves (the agent itself read/edited 30+ files), which is
  // normal work, not "attached too much". It fired once we learned to extract
  // Codex files; on CLI data it carries no meaning.
  "excessive-file-context",
]);

// Rules whose unit is "session"/"workspace": their occurrences are NOT requests,
// so dividing by the total request count is unfair (understates them several-fold).
// The denominator is the session count (or workspace count for low-markdown-ratio).
const SCOPE_SESSIONS = new Set([
  "mega-sessions", "session-drift", "vibe-coding", "copy-paste-blindness", "runaway-context", "context-bloat",
]);
const SCOPE_WORKSPACES = new Set(["low-markdown-ratio"]);

// The engine reports low-context-provision as a separate rule per harness
// (low-context-provision-cursor/-codex). Merge them into one. Base text is kept
// in English; the catalog localizes name/description/suggestion downstream.
function mergeLowContext(patterns: any[]): any[] {
  const lc = patterns.filter((p) => typeof p.id === "string" && p.id.startsWith("low-context-provision-"));
  if (lc.length <= 1) return patterns;
  const rest = patterns.filter((p) => !(typeof p.id === "string" && p.id.startsWith("low-context-provision-")));
  const occ = lc.reduce((a, p) => a + (p.occurrences || 0), 0);
  const sev = lc.some((p) => p.severity === "high") ? "high" : lc.some((p) => p.severity === "medium") ? "medium" : "low";
  const harnesses = lc.map((p) => p.id.replace("low-context-provision-", "")).join(", ");
  rest.push({
    id: "low-context-provision",
    name: "Low Context Provided",
    group: lc[0].group,
    severity: sev,
    occurrences: occ,
    description: `${occ} requests with low context score (${harnesses}): few file references and custom instructions.`,
    suggestion: "Give more context up front: which files, what to change, what constraints.",
    examples: [],
  });
  return rest;
}

// Keep only requests within the window [from, to]. For requests without a
// timestamp we use the session date. For the "all time" window (from<=0, to=∞)
// we return everything as-is.
function filterByDate(sessions: any[], from: number, to: number): any[] {
  if (from <= 0 && !Number.isFinite(to)) return sessions;
  const out: any[] = [];
  for (const s of sessions) {
    const reqs = (s.requests || []).filter((r: any) => {
      const t = r.timestamp ?? s.creationDate ?? s.lastMessageDate;
      return typeof t === "number" && t >= from && t <= to;
    });
    if (reqs.length) out.push({ ...s, requests: reqs, requestCount: reqs.length });
  }
  return out;
}

export interface ParsedData {
  sessions: any[];
  editLocIndex: any;
  workspaces: any;
}

// The expensive part (~50s): parse all logs + Cursor + sanitize. Runs ONCE, the
// result is cached in memory; per-period analysis is built from it quickly.
export async function parseAll(): Promise<ParsedData> {
  E.registerAllBuiltinRules();
  E.registerAllBuiltinMetrics();
  const pr = await E.parseAllLogsAsync(E.findLogsDirs());
  const sessions = sanitizeSessions([...pr.sessions, ...parseCursorSessions()]);
  // Set customInstructions for projects that have instruction files (all sources).
  markInstructions(sessions, buildProjectInstrNames());
  return { sessions, editLocIndex: pr.editLocIndex, workspaces: pr.workspaces };
}

export function analyze(parsed: ParsedData, from = 0, to = Infinity, label = "all time", lang: Lang = "ru"): VibeAnalysis {
  const sessions = filterByDate(parsed.sessions, from, to);
  const az = new E.Analyzer(sessions, parsed.editLocIndex, parsed.workspaces);

  const ap = az.getAntiPatterns();
  const cp = az.getCodeProduction();

  // Overall score = average of the per-group scores (the engine's own scoring).
  const gs: any[] = ap.groupScores || [];
  const score = gs.length ? Math.round(gs.reduce((a, g) => a + (g.score || 0), 0) / gs.length) : 0;

  // Flatten sessions into requests for our own aggregates.
  const reqs: any[] = [];
  const byHarness: Record<string, number> = {};
  for (const s of sessions) {
    byHarness[s.harness] = (byHarness[s.harness] || 0) + 1;
    for (const r of s.requests) reqs.push(r);
  }

  // Tokens + per-model / per-project / per-harness stats.
  let prompt = 0, completion = 0;
  const modelAgg = new Map<string, { requests: number; completion: number }>();
  const projAgg = new Map<string, { requests: number; completion: number }>();
  const tokDay = new Map<string, number>();
  for (const r of reqs) {
    prompt += r.promptTokens || 0;
    completion += r.completionTokens || 0;
    if (r.modelId && !FAKE_MODELS.has(r.modelId)) {
      const m = modelAgg.get(r.modelId) || { requests: 0, completion: 0 };
      m.requests++; m.completion += r.completionTokens || 0;
      modelAgg.set(r.modelId, m);
    }
    if (r.timestamp) {
      const day = new Date(r.timestamp).toISOString().slice(0, 10);
      tokDay.set(day, (tokDay.get(day) || 0) + (r.completionTokens || 0));
    }
  }
  // Projects with tokens.
  const harnessAgg = new Map<string, { sessions: number; requests: number; completion: number }>();
  for (const s of sessions) {
    const h = harnessAgg.get(s.harness) || { sessions: 0, requests: 0, completion: 0 };
    h.sessions++;
    const p = projAgg.get(s.workspaceName) || { requests: 0, completion: 0 };
    for (const r of s.requests) {
      h.requests++; h.completion += r.completionTokens || 0;
      p.requests++; p.completion += r.completionTokens || 0;
    }
    harnessAgg.set(s.harness, h);
    projAgg.set(s.workspaceName, p);
  }
  const harnessStats = [...harnessAgg.entries()].map(([harness, v]) => ({ harness, ...v })).sort((a, b) => b.requests - a.requests);
  const modelStats = [...modelAgg.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.completion - a.completion).slice(0, 12);
  const projectStats = [...projAgg.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.requests - a.requests).slice(0, 14);
  const tokensByDay = [...tokDay.entries()].map(([date, tokens]) => ({ date, tokens })).sort((a, b) => a.date.localeCompare(b.date)).slice(-90);

  // Data coverage "source × field": what each source actually provides in THIS
  // period. Distinguishes a structural gap (a field is never written → 0%) from
  // natural frequency (edits/code aren't in every request). The 20% threshold
  // splits "supported" (✓) from "rare" (~); 0% → "not in logs" (—). Period-aware:
  // Cursor tokens are ✓ over "all time" but "—" in a recent window (stopped being
  // written). Feature keys are localized on the client via the catalog.
  const COVERAGE_FEATURES: { key: C.CoverageKey; has: (r: any) => boolean }[] = [
    { key: "model",        has: (r) => !!r.modelId && !FAKE_MODELS.has(r.modelId) },
    { key: "tokens",       has: (r) => (r.completionTokens || 0) > 0 },
    { key: "reasoning",    has: (r) => !!r.reasoningEffort },
    { key: "aiLoc",        has: (r) => (r.aiCode || []).length > 0 },
    { key: "edits",        has: (r) => (r.editedFiles || []).length > 0 },
    { key: "contextFiles", has: (r) => (r.referencedFiles || []).length > 0 },
    { key: "duration",     has: (r) => r.totalElapsed != null },
    { key: "tools",        has: (r) => (r.toolsUsed || []).length > 0 },
  ];
  // Sources with a single request (Xcode=1) are hidden: one sample can't judge a
  // capability, so a column of "—" would be misleading.
  const covHarnesses = harnessStats.filter((h) => h.requests >= 10).map((h) => h.harness);
  const covTotals: Record<string, number> = {};
  const covHits: Record<string, Record<string, number>> = {};
  for (const f of COVERAGE_FEATURES) covHits[f.key] = {};
  for (const s of sessions) {
    covTotals[s.harness] = (covTotals[s.harness] || 0) + s.requests.length;
    for (const r of s.requests)
      for (const f of COVERAGE_FEATURES) if (f.has(r)) covHits[f.key][s.harness] = (covHits[f.key][s.harness] || 0) + 1;
  }
  const covState = (pct: number): "yes" | "rare" | "no" => (pct === 0 ? "no" : pct < 0.2 ? "rare" : "yes");
  const coverage = {
    harnesses: covHarnesses,
    features: COVERAGE_FEATURES.map((f) => ({
      name: C.coverageFeatureLabel(f.key, lang),
      states: Object.fromEntries(
        covHarnesses.map((h) => {
          const t = covTotals[h] || 0;
          return [h, covState(t ? (covHits[f.key][h] || 0) / t : 0)];
        }),
      ) as Record<string, "yes" | "rare" | "no">,
    })),
    // Historical gap: Cursor structurally supports tokens but stopped writing them
    // locally — without the "—" footnote a recent window reads as "never supported".
    note:
      covHarnesses.includes("Cursor") && !covHits["tokens"]["Cursor"]
        ? C.coverageNote(lang)
        : "",
  };

  // Language — our bilingual detector over the prompt text.
  const langSplit: Record<string, number> = { ru: 0, en: 0, mixed: 0, other: 0 };
  // Activity over time.
  const byHour = new Array(24).fill(0);
  const dayMap = new Map<string, number>();
  let weekend = 0, lateNight = 0, withTs = 0;
  for (const r of reqs) {
    const txt = r.messageText || "";
    if (txt) langSplit[detectLang(txt)]++;
    if (r.timestamp) {
      withTs++;
      const dt = new Date(r.timestamp);
      byHour[dt.getHours()]++;
      dayMap.set(dt.toISOString().slice(0, 10), (dayMap.get(dt.toISOString().slice(0, 10)) || 0) + 1);
      const wd = dt.getDay();
      if (wd === 0 || wd === 6) weekend++;
      if (dt.getHours() < 5) lateNight++;
    }
  }
  const byDay = [...dayMap.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)).slice(-90);

  // Models and projects (excluding Claude Code's service "models").
  const models = topCounts(reqs.map((r) => r.modelId).filter((m) => m && !FAKE_MODELS.has(m)));
  const workspaces = topCounts(sessions.flatMap((s) => Array(s.requests.length).fill(s.workspaceName)));

  // Code languages (from the engine's code production), localized for unknown/text.
  const byLanguage: { name: string; loc: number }[] = [];
  const bl = cp.byLanguage || {};
  if (Array.isArray(bl.labels) && Array.isArray(bl.aiLoc)) {
    for (let i = 0; i < bl.labels.length; i++) byLanguage.push({ name: C.codeLangLabel(bl.labels[i], lang), loc: bl.aiLoc[i] || 0 });
    byLanguage.sort((a, b) => b.loc - a.loc);
  }

  // Anti-patterns: merge low-context-*, sort by coverage, localize. The pct
  // denominator depends on the rule's unit: requests / sessions / workspaces.
  const totalReq = reqs.length || 1;
  const totalSessions = sessions.length || 1;
  const totalWorkspaces = new Set(sessions.map((s) => s.workspaceName)).size || 1;
  const scopeOf = (id: string): C.Scope =>
    SCOPE_SESSIONS.has(id) ? "sessions" : SCOPE_WORKSPACES.has(id) ? "workspaces" : "requests";
  const denomFor = (id: string) =>
    SCOPE_SESSIONS.has(id) ? totalSessions : SCOPE_WORKSPACES.has(id) ? totalWorkspaces : totalReq;
  const antiPatterns = mergeLowContext(ap.patterns || [])
    .filter((p: any) => !SUPPRESS.has(p.id))
    .map((p: any) => ({
      id: p.id,
      name: C.localizeName(p.id, p.name, lang),
      group: p.group,
      groupLabel: C.groupLabel(p.group, lang),
      severity: p.severity,
      severityLabel: C.severityLabel(p.severity, lang),
      occurrences: p.occurrences || 0,
      pct: (p.occurrences || 0) / denomFor(p.id),
      unit: C.unitLabel(scopeOf(p.id), lang),
      description: C.localizeDesc(p.id, p.description || "", lang),
      suggestion: C.localizeFix(p.id, p.suggestion || "", lang),
      examples: (p.examples || []).slice(0, 3),
    }))
    .sort((a, b) => b.pct - a.pct);

  return {
    generatedAt: Date.now(),
    range: { from, to: Number.isFinite(to) ? to : Date.now(), label },
    score,
    verdict: C.verdict(score, lang),
    groupScores: gs.map((g) => ({ group: g.group, groupLabel: C.groupLabel(g.group, lang), score: g.score, patternCount: g.patternCount })),
    totals: { sessions: sessions.length, requests: reqs.length, byHarness },
    tokens: { prompt, completion },
    code: { aiLoc: cp.summary?.totalAiLoc || 0, aiBlocks: cp.summary?.aiBlocks || 0, byLanguage: byLanguage.slice(0, 10) },
    langSplit,
    models,
    workspaces,
    harnessStats,
    coverage,
    modelStats,
    projectStats,
    activity: { byHour, byDay, tokensByDay, weekendPct: withTs ? weekend / withTs : 0, lateNightPct: withTs ? lateNight / withTs : 0 },
    antiPatterns,
  };
}
