# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Vibometr is a local analyzer of "vibe-coding". It reads Claude Code / Codex / Cursor logs from disk, runs them through a rule engine, and serves a bilingual (English/Russian) dashboard. **Invariants that must never break:** the tool is read-only, makes zero network requests, and has no telemetry — data never leaves the machine.

Requires **Node ≥ 22.18** (uses native `node:sqlite` and runs `.ts` directly via type stripping, which is unflagged from 22.18 / 23.6).

## Commands

```bash
npm install            # installs deps AND builds the engine bundle (prepare hook)
npm start              # bin/vibometr.mjs: starts the server + opens the browser
npm run serve          # node src/server.ts: server only (no browser) — handy in dev
npm run build:engine   # rebuild the vendored engine → engine/dist/engine.mjs (~37ms)
```

Dev loop and its gotchas:
- **After editing `engine/core/**` → `npm run build:engine`.** The engine is bundled by esbuild into one ESM file; it can't be imported by node directly (extension-less imports + reads its rules via `__dirname`). The markdown rules/metrics in `engine/core/{rules,metrics}` are copied into `engine/dist` at build time and read at runtime, so even rule-only edits need a rebuild to take effect.
- **After editing `src/**` → restart the server** (`pkill -f server.ts`, then `npm run serve`): `src/` modules are cached in the process.
- The expensive parse (`parseAll`, ~50s) is memoized in memory + on disk (`$TMPDIR/vibometr/analysis-v3-<period>-<lang>.json`). To reset and reparse, hit the API with `?fresh=1` (calls `invalidate()`), or delete the cache files.

API: `GET /api/analysis?period=all|1y|6m|3m|1m|custom[&from=&to=]&lang=ru|en[&fresh=1]`. `3m` = `now − 91 days`. **The dashboard always loads `all` on first paint — it does not apply a `?period=` URL param** (periods are switched by the in-page buttons).

## Architecture

One pipeline feeds the dashboard: `src/server.ts` → `src/cache.ts` → `src/engine-analysis.ts`.

`engine-analysis.ts` is the assembler: it runs the vendored Microsoft [`ai-engineering-coach`](https://github.com/microsoft/ai-engineering-coach) engine (45 rules, code-production, group-scores) from `engine/dist/engine.mjs`, adds our own Cursor parser and bilingual language split, localizes everything, and returns one `VibeAnalysis` JSON. `parseAll()` parses the logs once → `analyze(parsed, from, to, label, lang)` filters by period and computes.

Files:
- `engine/core/` — the vendored MS engine (TS). `engine/entry.ts` re-exports only what we need (`Analyzer`, `findLogsDirs`, `parseAllLogs(Async)`, `loadAllRuleLayers`, `registerAllBuiltinRules/Metrics`). DSL helpers (`matchesAny`, `capsWordRatio`, …) are NOT exported — edit them inside `engine/core/dsl/`.
- `engine/build.mjs` — the esbuild build (injects `__dirname`/`require` shims for the ESM bundle).
- `src/engine-analysis.ts` — the main assembler + the `VibeAnalysis` interface.
- `src/catalog.ts` — the bilingual i18n catalog (see below).
- `src/cursor-sessions.ts` — Cursor parser: reads the SQLite `state.vscdb` via `node:sqlite`.
- `src/instructions.ts` — detects project instruction files (CLAUDE.md / AGENTS.md / .cursorrules) so we don't falsely report "no instructions".
- `src/nlp/lang.ts` — bilingual language detection (via `franc`); the only `src/nlp/` file (the old standalone analyzer was removed).
- `bin/vibometr.mjs` — launcher (builds the engine if missing, starts the server, opens the browser).
- `web/index.html` — the entire dashboard in one file (static, rendered from the JSON).

### Internationalization

Two layers:
1. **Data strings** (rule names, descriptions, group/severity labels, units, verdict, coverage labels) are localized **server-side** by the `?lang=` param. The engine emits English text; for English we pass it through, for Russian `src/catalog.ts` overrides names and re-translates descriptions/suggestions. Switching language is a cheap recompute (the parse is memoized; only `analyze()` reruns), cached per `(period, lang)`.
2. **Static UI chrome** lives in `web/index.html` as an `I18N = { ru, en }` table with a `t()` helper; a RU/EN toggle persists the choice in `localStorage` and refetches with the new `lang`.

When adding a new rule label or UI string, add **both** languages — `catalog.ts` for data, the `I18N` table for chrome.

### Rule DSL — a critical parser gotcha

Engine rules are markdown with a YAML-ish frontmatter (`thresholds`, `patterns`) and a ` ```detect ` block. **The frontmatter parser in `engine/core/rule-parser.ts` is line-based and does `value.slice(1,-1).split(',')` — it splits on EVERY comma (including commas inside regex quantifiers `{n,}`/`{n,m}`) and does NO escape processing.** So in pattern strings:
- **no commas** — use `{3}` or repeated characters instead of `{3,}`; separate alternatives with `|`;
- **backslashes pass straight into `new RegExp`** — `\?` is a literal `?`, `\\?` is an optional backslash.

This is how `frustration-signals.md` was once broken (`"!{3,}"` fragmented into a junk `}` that matched any brace) — fixed by switching to `"!{3}"`.

### Cursor token limitation

`cursor-sessions.ts` reads `tokenCount.input/outputTokens` from `bubbleId:%` rows. **Cursor stopped writing `tokenCount` to its local DB around 2026-01-11** (data moved to cursor.com). So Cursor spend isn't visible for recent periods — only activity. This is surfaced in the `coverage` matrix in `VibeAnalysis`: each cell is `yes`/`rare`/`no` by the share of non-empty requests (the 20% threshold separates a structural gap from natural rarity), and sources with `< 10` requests are filtered out.
