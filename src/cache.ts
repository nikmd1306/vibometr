// Analysis cache. Two layers, both memory + disk:
//   1. The parsed log model (parseAll, ~40s) — the expensive part. Cached on disk
//      keyed by a source fingerprint, so a restart skips reparsing unless logs changed.
//   2. The per-period analysis built from the parse (fast, but ~1–9s for big windows) —
//      cached by (period, lang). Background-warmed so period/language switches are instant.

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseAll, analyze, sourcesSignature, ensureEngineReady, type ParsedData, type VibeAnalysis } from "./engine-analysis.ts";
import type { Lang } from "./catalog.ts";

const DIR = join(tmpdir(), "vibometr");
const PARSED_FILE = join(DIR, "parsed-v1.json");
const META_FILE = join(DIR, "meta.json");

export interface Period {
  key: string;
  from: number;
  to: number;
  label: string;
  lang: Lang;
}

let parsed: ParsedData | null = null;
let parsing: Promise<ParsedData> | null = null;
const memo = new Map<string, VibeAnalysis>();

// Source fingerprint, computed once per process (cheap, but no need to rewalk).
let sigChecked = false;
let currentSig = "";

function diskFile(key: string): string {
  return join(DIR, `analysis-v3-${key}.json`);
}

// --- ParsedData (de)serialization ---------------------------------------------
// workspaces is a Map<string, Workspace> and editLocIndex is a Map<string, Map>;
// JSON.stringify would silently drop both, so we round-trip them as entry arrays.
function serializeParsed(p: ParsedData, sig: string): string {
  const ws = p.workspaces as Map<string, unknown>;
  const eli = p.editLocIndex as Map<string, Map<string, number>>;
  return JSON.stringify({
    sig,
    sessions: p.sessions,
    workspaces: [...ws],
    editLocIndex: [...eli].map(([k, v]) => [k, [...v]]),
  });
}

function reviveParsed(o: any): ParsedData {
  return {
    sessions: o.sessions,
    workspaces: new Map(o.workspaces),
    editLocIndex: new Map((o.editLocIndex as [string, [string, number][]][]).map(([k, v]) => [k, new Map(v)])),
  };
}

function loadParsedDisk(sig: string): ParsedData | null {
  try {
    if (!existsSync(PARSED_FILE)) return null;
    const o = JSON.parse(readFileSync(PARSED_FILE, "utf8"));
    if (o.sig !== sig) return null;
    return reviveParsed(o);
  } catch {
    return null;
  }
}

function saveParsedDisk(p: ParsedData, sig: string): void {
  try {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(PARSED_FILE, serializeParsed(p, sig));
  } catch {
    /* best-effort */
  }
}

// --- Disk freshness ------------------------------------------------------------
// Wipe every cached artifact (parse + all per-period analyses + meta).
function wipeDiskCache(): void {
  try {
    for (const f of readdirSync(DIR)) {
      if (f.startsWith("analysis-v3-") || f === "parsed-v1.json" || f === "meta.json") {
        rmSync(join(DIR, f), { force: true });
      }
    }
  } catch {
    /* nothing to clean */
  }
}

// First call per process: if the sources changed since the last run, the whole
// disk cache is stale (analyses included) — drop it. This also fixes the case
// where a per-period analysis on disk would otherwise outlive a log change.
function ensureFreshDisk(): void {
  if (sigChecked) return;
  currentSig = sourcesSignature();
  sigChecked = true;
  let prev = "";
  try {
    if (existsSync(META_FILE)) prev = JSON.parse(readFileSync(META_FILE, "utf8")).sig || "";
  } catch {
    /* no/garbled meta → treat as changed */
  }
  if (prev !== currentSig) {
    wipeDiskCache();
    try {
      mkdirSync(DIR, { recursive: true });
      writeFileSync(META_FILE, JSON.stringify({ sig: currentSig }));
    } catch {
      /* best-effort */
    }
  }
}

// Guarantees the expensive parse runs exactly once (even under a request race).
function ensureParsed(): Promise<ParsedData> {
  if (parsed) return Promise.resolve(parsed);
  if (!parsing) {
    parsing = (async () => {
      ensureFreshDisk();
      const disk = loadParsedDisk(currentSig);
      if (disk) {
        ensureEngineReady(); // parseAll is skipped on this path → register rules here
        parsed = disk;
        return disk;
      }
      const p = await parseAll();
      saveParsedDisk(p, currentSig);
      parsed = p;
      return p;
    })().finally(() => {
      parsing = null;
    });
  }
  return parsing;
}

export function readDiskCache(key = "all-ru"): VibeAnalysis | null {
  try {
    ensureFreshDisk();
    const f = diskFile(key);
    if (!existsSync(f)) return null;
    return JSON.parse(readFileSync(f, "utf8")) as VibeAnalysis;
  } catch {
    return null;
  }
}

// Is a usable parse already on disk for the current sources? (For the startup
// banner — a fresh parse cache means the next launch skips the ~40s reparse.)
export function isParsedCached(): boolean {
  try {
    ensureFreshDisk();
    if (!existsSync(PARSED_FILE)) return false;
    return JSON.parse(readFileSync(PARSED_FILE, "utf8")).sig === currentSig;
  } catch {
    return false;
  }
}

export async function compute(p: Period): Promise<VibeAnalysis> {
  const data = await ensureParsed();
  const a = analyze(data, p.from, p.to, p.label, p.lang);
  memo.set(p.key, a);
  try {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(diskFile(p.key), JSON.stringify(a));
  } catch {
    /* cache is best-effort */
  }
  return a;
}

export async function getAnalysis(p: Period): Promise<VibeAnalysis> {
  if (memo.has(p.key)) return memo.get(p.key)!;
  const disk = readDiskCache(p.key);
  if (disk) {
    memo.set(p.key, disk);
    return disk;
  }
  return compute(p);
}

// Background-precompute the given periods so later switches are instant. Yields
// the event loop between each (heavy) analysis to keep the server responsive,
// and skips anything already cached. Idempotent — safe to call on every request.
let warming = false;
export async function warm(periods: Period[]): Promise<void> {
  if (warming) return;
  warming = true;
  try {
    await ensureParsed();
    for (const p of periods) {
      if (memo.has(p.key)) continue;
      const disk = readDiskCache(p.key);
      if (disk) {
        memo.set(p.key, disk);
        continue;
      }
      await new Promise((r) => setImmediate(r)); // let pending requests through
      await compute(p);
    }
  } finally {
    warming = false;
  }
}

// Full reset: new logs on disk → reparse and recompute everything.
export function invalidate(): void {
  parsed = null;
  parsing = null;
  memo.clear();
  sigChecked = false;
  currentSig = "";
  wipeDiskCache();
}
