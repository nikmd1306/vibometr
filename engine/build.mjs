// Bundle the vendored MS engine into a single ESM file.
// Their code uses extension-less imports (./types) and __dirname to read
// rules from disk — so we build with esbuild and inject __dirname/require shims.

import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [join(root, "entry.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: join(dist, "engine.mjs"),
  // CJS global shims for the ESM bundle: their rule-loader reads __dirname/rules.
  banner: {
    js: [
      "import{createRequire as __cr}from'module';",
      "import{fileURLToPath as __f}from'url';",
      "import{dirname as __dn}from'path';",
      "const require=__cr(import.meta.url);",
      "const __filename=__f(import.meta.url);",
      "const __dirname=__dn(__filename);",
    ].join(""),
  },
  logLevel: "info",
});

// Rules and metrics are read at runtime from __dirname/rules and __dirname/metrics.
cpSync(join(root, "core", "rules"), join(dist, "rules"), { recursive: true });
cpSync(join(root, "core", "metrics"), join(dist, "metrics"), { recursive: true });

console.log("✓ engine built → engine/dist/engine.mjs (+ rules, metrics)");
