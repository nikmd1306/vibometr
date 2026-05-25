// Vibometr local server: serves the dashboard static files and the analysis
// JSON. No outbound requests — data never leaves the machine.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getAnalysis, compute, invalidate, readDiskCache, type Period } from "./cache.ts";
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

// ?period=all|1y|6m|3m|1m|custom (+ from/to for custom) & ?lang=ru|en → date window.
function resolvePeriod(params: URLSearchParams): Period {
  const now = Date.now();
  const lang: Lang = params.get("lang") === "en" ? "en" : "ru";
  const make = (base: string, from: number, to: number, keySuffix = base): Period => ({
    key: `${keySuffix}-${lang}`,
    from,
    to,
    label: PERIOD_LABEL[base][lang],
    lang,
  });
  switch (params.get("period")) {
    case "1y": return make("1y", now - 365 * DAY, Infinity);
    case "6m": return make("6m", now - 183 * DAY, Infinity);
    case "3m": return make("3m", now - 91 * DAY, Infinity);
    case "1m": return make("1m", now - 30 * DAY, Infinity);
    case "custom": {
      const from = Date.parse(params.get("from") || "") || 0;
      const to = Date.parse(params.get("to") || "") || now;
      return make("custom", from, to, `c_${from}_${to}`);
    }
    default: return make("all", 0, Infinity);
  }
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
  const warm = readDiskCache() ? "warm cache" : "cold start (~30s for the first run)";
  console.log(`\n  VIBOMETR running → http://localhost:${PORT}  (${warm})\n`);
});
