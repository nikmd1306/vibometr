// Vibometr local server: serves the dashboard static files and the analysis
// JSON. No outbound requests — data never leaves the machine.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getAnalysis, compute, invalidate, warm, isParsedCached, type Period } from "./cache.ts";
import type { Lang } from "./catalog.ts";

const DAY = 86400000;

// Bilingual period labels keyed by base period.
const PERIOD_LABEL: Record<string, Record<Lang, string>> = {
  all: { ru: "всё время", en: "all time" },
  "1y": { ru: "за год", en: "last year" },
  "6m": { ru: "за 6 месяцев", en: "last 6 months" },
  "3m": { ru: "за 3 месяца", en: "last 3 months" },
  "1m": { ru: "за месяц", en: "last month" },
  custom: { ru: "произвольный период", en: "custom range" },
};

// The fixed presets and their date windows (custom is handled separately).
const PRESET_FROM: Record<string, () => number> = {
  all: () => 0,
  "1y": () => Date.now() - 365 * DAY,
  "6m": () => Date.now() - 183 * DAY,
  "3m": () => Date.now() - 91 * DAY,
  "1m": () => Date.now() - 30 * DAY,
};

function makePeriod(base: string, from: number, to: number, lang: Lang, keySuffix = base): Period {
  return { key: `${keySuffix}-${lang}`, from, to, label: PERIOD_LABEL[base][lang], lang };
}

// ?period=all|1y|6m|3m|1m|custom (+ from/to for custom) & ?lang=ru|en → date window.
function resolvePeriod(params: URLSearchParams): Period {
  const lang: Lang = params.get("lang") === "en" ? "en" : "ru";
  const period = params.get("period") || "all";
  if (period === "custom") {
    const from = Date.parse(params.get("from") || "") || 0;
    const to = Date.parse(params.get("to") || "") || Date.now();
    return makePeriod("custom", from, to, lang, `c_${from}_${to}`);
  }
  const base = PRESET_FROM[period] ? period : "all";
  return makePeriod(base, PRESET_FROM[base](), Infinity, lang);
}

// Every preset × both languages — the set we precompute in the background.
// Smallest windows first: each analysis briefly blocks the event loop, so doing
// the cheap ones first keeps any concurrent user request from waiting long.
const WARM_ORDER = ["1m", "3m", "6m", "1y", "all"];
function standardPeriods(): Period[] {
  const out: Period[] = [];
  for (const lang of ["ru", "en"] as Lang[])
    for (const base of WARM_ORDER)
      out.push(makePeriod(base, PRESET_FROM[base](), Infinity, lang));
  return out;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dirname, "..", "web");
const PORT = Number(process.env.PORT) || 5274;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  // API: analysis for the selected period.
  if (url.pathname === "/api/analysis") {
    const fresh = url.searchParams.get("fresh") === "1";
    const period = resolvePeriod(url.searchParams);
    try {
      if (fresh) invalidate(); // new logs → reparse
      const data = fresh ? await compute(period) : await getAnalysis(period);
      res.writeHead(200, { "content-type": MIME[".json"] });
      res.end(JSON.stringify(data));
      // Then warm the other presets/languages in the background (idempotent).
      void warm(standardPeriods());
    } catch (e) {
      res.writeHead(500, { "content-type": MIME[".json"] });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  // Static files.
  let path = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = join(WEB, path);
  if (!filePath.startsWith(WEB)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

server.listen(PORT, () => {
  const state = isParsedCached() ? "warm cache" : "cold start (~40s for the first run)";
  console.log(`\n  VIBOMETR running → http://localhost:${PORT}  (${state})\n`);
});
