// Analysis cache. The expensive log parsing (~50s) runs ONCE and stays in
// memory (parsed); the per-period analysis is built from it quickly and cached
// by period key (memory + disk). Warm start is instant.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseAll, analyze, type ParsedData, type VibeAnalysis } from "./engine-analysis.ts";
import type { Lang } from "./catalog.ts";

const DIR = join(tmpdir(), "vibometr");

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

function diskFile(key: string): string {
  return join(DIR, `analysis-v3-${key}.json`);
}

// Guarantees the expensive parse runs exactly once (even under a request race).
function ensureParsed(): Promise<ParsedData> {
  if (parsed) return Promise.resolve(parsed);
  if (!parsing) {
    parsing = parseAll().then((p) => {
      parsed = p;
      parsing = null;
      return p;
    });
  }
  return parsing;
}

export function readDiskCache(key = "all-ru"): VibeAnalysis | null {
  try {
    const f = diskFile(key);
    if (!existsSync(f)) return null;
    return JSON.parse(readFileSync(f, "utf8")) as VibeAnalysis;
  } catch {
    return null;
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

// Full reset: new logs on disk → reparse and recompute everything.
export function invalidate(): void {
  parsed = null;
  parsing = null;
  memo.clear();
}
