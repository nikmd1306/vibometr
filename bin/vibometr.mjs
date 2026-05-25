#!/usr/bin/env node
// Vibometr launcher: makes sure the engine bundle exists, starts the local
// server, and opens the dashboard in the default browser. Zero network calls —
// everything runs on localhost and reads logs straight off your disk.

import { spawnSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT) || 5274;

// The engine bundle is normally produced by `npm install` (prepare script).
// Build it on first run as a safety net so the tool works even if that was skipped.
if (!existsSync(join(root, "engine", "dist", "engine.mjs"))) {
  console.log("Building the analysis engine (first run only)…");
  const r = spawnSync(process.execPath, [join(root, "engine", "build.mjs")], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error("Failed to build the engine. Run `npm install` and try again.");
    process.exit(1);
  }
}

// Open the dashboard once the server is up (the first analysis runs lazily on load).
function openBrowser(url) {
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "cmd" : "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
}
setTimeout(() => openBrowser(`http://localhost:${PORT}`), 1200);

// Start the server in-process (it begins listening on import).
await import(join(root, "src", "server.ts"));
