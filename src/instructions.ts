// Detect PROJECT-LEVEL instruction files: CLAUDE.md / AGENTS.md / .cursorrules /
// .cursor/rules / .github/copilot-instructions.md. This is what actually gives the agent
// persistent project context. Global ones (~/.claude, ~/.codex) are NOT counted —
// by requirement, project instructions are what matter.
//
// Needed because their no-custom-instructions rule fills the per-request field
// only for the Copilot IDE chat (requiresIdeContext), while for Claude/Codex/
// Cursor CLI logs it's always empty → false "no instructions" 100% of the time.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

const INSTR_FILES = ["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", ".cursorrules", ".github/copilot-instructions.md"];
const INSTR_DIRS = [".cursor/rules", ".github/instructions"];

const instrCache = new Map<string, boolean>();

export function hasInstructions(folder: string): boolean {
  const cached = instrCache.get(folder);
  if (cached !== undefined) return cached;
  let found = false;
  try {
    for (const f of INSTR_FILES) {
      const p = join(folder, f);
      // A 0-size (empty) CLAUDE.md doesn't count as an instruction.
      if (existsSync(p) && statSync(p).size > 0) { found = true; break; }
    }
    if (!found) for (const d of INSTR_DIRS) {
      const p = join(folder, d);
      if (existsSync(p) && statSync(p).isDirectory() && readdirSync(p).length) { found = true; break; }
    }
  } catch { /* no access — assume none */ }
  instrCache.set(folder, found);
  return found;
}

function decodePath(p: string): string {
  try {
    return decodeURIComponent(p.replace(/^file:\/\//, ""));
  } catch {
    return p.replace(/^file:\/\//, "");
  }
}

// All known project folders on the machine from several sources:
// Cursor workspaceStorage (real paths), Claude ~/.claude/projects (name =
// encoded path), and a direct scan of typical roots (~/Documents etc.) —
// to cover projects from any source, including names with hyphens.
const SCAN_ROOTS = ["Documents", "Projects", "projects", "code", "dev", "Desktop", "work", "repos", "src"];

function knownProjectFolders(): string[] {
  const folders = new Set<string>();
  const home = homedir();
  const wsRoot = join(home, "Library/Application Support/Cursor/User/workspaceStorage");
  try {
    for (const h of readdirSync(wsRoot)) {
      try {
        const f = JSON.parse(readFileSync(join(wsRoot, h, "workspace.json"), "utf8"));
        if (typeof f.folder === "string") folders.add(decodePath(f.folder));
      } catch { /* no workspace.json — skip */ }
    }
  } catch { /* no Cursor — skip */ }
  // Claude encodes the project path into the folder name: /Users/nikmd/vibometr → -Users-nikmd-vibometr.
  const claudeRoot = join(home, ".claude/projects");
  try {
    for (const d of readdirSync(claudeRoot)) {
      const cand = d.replace(/^-/, "/").replace(/-/g, "/");
      if (existsSync(cand)) folders.add(cand);
    }
  } catch { /* no Claude — skip */ }
  // Direct scan of project roots: each first-level subfolder is a candidate.
  for (const root of SCAN_ROOTS) {
    const base = join(home, root);
    try {
      for (const d of readdirSync(base, { withFileTypes: true })) {
        if (d.isDirectory() && !d.name.startsWith(".")) folders.add(join(base, d.name));
      }
    } catch { /* no such root — skip */ }
  }
  return [...folders];
}

// Project names (basename) that actually have instruction files.
export function buildProjectInstrNames(): Set<string> {
  const names = new Set<string>();
  for (const f of knownProjectFolders()) if (hasInstructions(f)) names.add(basename(f));
  return names;
}

// Marks customInstructions on requests of sessions whose project has instruction files.
// Works for all sources: look up the session's project name (or its basename) in the set.
export function markInstructions(sessions: any[], names: Set<string>): number {
  let marked = 0;
  for (const s of sessions) {
    const wn = String(s.workspaceName || "");
    if (names.has(wn) || names.has(basename(wn))) {
      for (const r of s.requests) {
        if (!r.customInstructions?.length) { r.customInstructions = ["project-rules"]; marked++; }
      }
    }
  }
  return marked;
}
