// Cursor chat parser → MS engine data model (Session/SessionRequest).
// Their code doesn't read Cursor at all, so this is our addition. Source:
// ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb
//   composerData:<id>  — conversation (conversation[]: type 1=user, 2=assistant, text, bubbleId)
//   bubbleId:<cid>:<bid> — message, including tokenCount {inputTokens, outputTokens}

import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

const CURSOR_USER = join(homedir(), "Library/Application Support/Cursor/User");
const DB = join(CURSOR_USER, "globalStorage/state.vscdb");
const WS_ROOT = join(CURSOR_USER, "workspaceStorage");

// Cursor parse inputs — used by the cache to fingerprint sources for invalidation.
export const CURSOR_SOURCES = [DB, WS_ROOT];

// Cursor tools that mean a file edit (→ editedFiles).
const EDIT_TOOLS = new Set(["edit_file", "reapply", "delete_file", "search_replace", "create_file"]);

interface BubbleData {
  text: string;
  i: number;
  o: number;
  tool: string | null;
  edited: string | null;
  files: string[]; // base names → referencedFiles
  abs: string[];   // absolute paths → for project detection
}

function decodePath(p: string): string {
  try {
    return decodeURIComponent(p.replace(/^file:\/\//, ""));
  } catch {
    return p.replace(/^file:\/\//, "");
  }
}

function baseName(p: string): string {
  return basename(decodePath(p));
}

// Pulls files from three bubble sources. Each is a JSON string (json_extract):
// relevantFiles — array of path strings (relative), attachedFileCodeChunksUris —
// array of {path} (absolute), context.fileSelections — array of {uri:{path}} (absolute).
// names → referencedFiles, abs → project detection by path prefix.
function collectFiles(relevant: string | null, attached: string | null, selections: string | null): { names: string[]; abs: string[] } {
  const names: string[] = [], abs: string[] = [];
  const addAbs = (p: unknown) => {
    if (typeof p === "string" && p) { abs.push(decodePath(p)); names.push(baseName(p)); }
  };
  try {
    if (relevant) for (const f of JSON.parse(relevant)) if (typeof f === "string" && f) names.push(baseName(f));
  } catch { /* malformed JSON — skip */ }
  try {
    if (attached) for (const u of JSON.parse(attached)) addAbs(u?.path || u?.external);
  } catch { /* skip */ }
  try {
    if (selections) for (const s of JSON.parse(selections)) addAbs(s?.uri?.path);
  } catch { /* skip */ }
  return { names, abs };
}

interface Project {
  folder: string; // absolute path
  name: string;
}

interface WorkspaceMap {
  byComposer: Map<string, string>; // composerId → project name (authoritative)
  projects: Project[];             // all known project folders (for path-based fallback)
}

// Authoritative source: each workspaceStorage/<hash> stores workspace.json
// (project path), and its state.vscdb holds composer.composerData.allComposers —
// the conversations of that project. In parallel we collect a folder list for path-based fallback.
function buildWorkspaceMap(): WorkspaceMap {
  const byComposer = new Map<string, string>();
  const projects: Project[] = [];
  let dirs: string[];
  try {
    dirs = readdirSync(WS_ROOT);
  } catch {
    return { byComposer, projects };
  }
  for (const hash of dirs) {
    const folderJson = join(WS_ROOT, hash, "workspace.json");
    const wsDb = join(WS_ROOT, hash, "state.vscdb");
    let folder = "", name = "";
    try {
      const f = JSON.parse(readFileSync(folderJson, "utf8"));
      if (typeof f.folder === "string") {
        folder = decodePath(f.folder);
        name = basename(folder);
      }
    } catch {
      continue;
    }
    if (!name) continue;
    if (!projects.some((p) => p.folder === folder)) projects.push({ folder, name });
    try {
      const db = new DatabaseSync(wsDb, { readOnly: true });
      const row = db
        .prepare("SELECT value FROM ItemTable WHERE key='composer.composerData'")
        .get() as { value?: string } | undefined;
      db.close();
      if (row?.value) {
        const data = JSON.parse(row.value);
        for (const c of data.allComposers || []) {
          if (c?.composerId) byComposer.set(c.composerId, name);
        }
      }
    } catch {
      /* no conversations for the project — skip */
    }
  }
  // Longest paths first: on prefix matching a nested project should
  // win over the parent folder.
  projects.sort((a, b) => b.folder.length - a.folder.length);
  return { byComposer, projects };
}

// Determines a conversation's project from absolute paths of mentioned files: find the project
// whose folder is a prefix of some path. Returns the project name or "".
function inferProject(absPaths: Iterable<string>, projects: Project[]): string {
  for (const ap of absPaths) {
    for (const proj of projects) {
      if (ap === proj.folder || ap.startsWith(proj.folder + "/")) return proj.name;
    }
  }
  return "";
}

// Absolute paths from composer-level context.fileSelections and
// allAttachedFileCodeChunksUris (present even when the conversation has no bubble attachments).
function composerAbsPaths(data: any): string[] {
  const out: string[] = [];
  const sel = data?.context?.fileSelections;
  if (Array.isArray(sel)) for (const s of sel) {
    const p = s?.uri?.fsPath || s?.uri?.path;
    if (typeof p === "string" && p) out.push(p);
  }
  const att = data?.allAttachedFileCodeChunksUris;
  if (Array.isArray(att)) for (const u of att) {
    const p = u?.fsPath || u?.path || u?.external;
    if (typeof p === "string" && p) out.push(decodePath(p));
  }
  return out;
}

// A full SessionRequest with sensible defaults for the optional fields.
function mkRequest(over: Record<string, unknown>): any {
  return {
    requestId: "",
    timestamp: null,
    messageText: "",
    responseText: "",
    isCanceled: false,
    agentName: "cursor",
    agentMode: "agent",
    modelId: "",
    toolsUsed: [],
    editedFiles: [],
    referencedFiles: [],
    slashCommand: "",
    variableKinds: {},
    customInstructions: [],
    skillsUsed: [],
    firstProgress: null,
    totalElapsed: null,
    messageLength: 0,
    responseLength: 0,
    userCode: [],
    aiCode: [],
    toolConfirmations: [],
    promptTokens: null,
    completionTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    compaction: null,
    todoSnapshot: null,
    workType: "",
    ...over,
  };
}

export function parseCursorSessions(): any[] {
  if (!existsSync(DB)) return [];
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(DB, { readOnly: true });
  } catch {
    return [];
  }

  const wsMap = buildWorkspaceMap();
  const sessions: any[] = [];
  try {
    // 1) A single bubble map: text, tokens, tools and files. Covers both
    // conversation formats — inline (text in conversation[]) and header-only (text in
    // separate bubbles, where all Cursor tokens live too). Key = "<composerId>:<bubbleId>".
    // Tools are in toolFormerData.name (edit_file/read_file/...), files are
    // in relevantFiles, attachedFileCodeChunksUris, context.fileSelections, and for
    // edits — in toolFormerData.params.relativeWorkspacePath.
    const bubbles = new Map<string, BubbleData>();
    const bStmt = db.prepare(
      `SELECT substr(key, 10) AS bid,
              json_extract(value,'$.text') AS text,
              CAST(json_extract(value,'$.tokenCount.inputTokens') AS INTEGER) AS i,
              CAST(json_extract(value,'$.tokenCount.outputTokens') AS INTEGER) AS o,
              json_extract(value,'$.toolFormerData.name') AS tool,
              json_extract(value,'$.toolFormerData.params.relativeWorkspacePath') AS toolPath,
              json_extract(value,'$.relevantFiles') AS relevantFiles,
              json_extract(value,'$.attachedFileCodeChunksUris') AS attachedUris,
              json_extract(value,'$.context.fileSelections') AS fileSelections
       FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'`,
    );
    type Row = {
      bid: string; text: string | null; i: number; o: number;
      tool: string | null; toolPath: string | null;
      relevantFiles: string | null; attachedUris: string | null; fileSelections: string | null;
    };
    for (const r of bStmt.iterate() as Iterable<Row>) {
      const text = typeof r.text === "string" ? r.text : "";
      const tool = typeof r.tool === "string" ? r.tool : null;
      const { names, abs } = collectFiles(r.relevantFiles, r.attachedUris, r.fileSelections);
      // read_file also enriches context — the path goes into referencedFiles.
      if (tool === "read_file" && r.toolPath) names.push(baseName(r.toolPath));
      const edited = tool && EDIT_TOOLS.has(tool) && r.toolPath ? baseName(r.toolPath) : null;
      if (!text && !r.i && !r.o && !tool && !names.length) continue;
      bubbles.set(r.bid, { text, i: r.i || 0, o: r.o || 0, tool, edited, files: names, abs });
    }

    // 2) Conversations.
    const stmt = db.prepare(
      "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'",
    );
    for (const row of stmt.iterate() as Iterable<{ key: string; value: string }>) {
      let data: any;
      try {
        data = JSON.parse(row.value);
      } catch {
        continue;
      }
      if (!data || typeof data !== "object") continue;
      // Cursor stores messages in two formats: the old one — inline in conversation[]
      // (with text), the new one — headers only in fullConversationHeadersOnly[]
      // (text and tokens in separate bubble records).
      const conv: any[] =
        Array.isArray(data.conversation) && data.conversation.length
          ? data.conversation
          : Array.isArray(data.fullConversationHeadersOnly)
            ? data.fullConversationHeadersOnly
            : [];
      if (!conv.length) continue;

      const composerId: string = data.composerId || row.key.slice("composerData:".length);
      const createdAt: number | null = typeof data.createdAt === "number" ? data.createdAt : null;
      const updatedAt: number | null =
        typeof data.lastUpdatedAt === "number" ? data.lastUpdatedAt : createdAt;

      const requests: any[] = [];
      let pending: any = null;
      // Accumulators for the current turn: tokens and file/tool sets
      // are gathered across all assistant bubbles between two user messages.
      let oSum = 0, iMax = 0, anyAgentic = false;
      const refSet = new Set<string>(), editSet = new Set<string>(), tools: string[] = [];
      const sessionAbs = new Set<string>(); // absolute file paths of the whole conversation — for project detection
      const flush = () => {
        if (pending) {
          pending.referencedFiles = [...refSet];
          pending.editedFiles = [...editSet];
          pending.toolsUsed = tools.slice();
          pending.agentMode = anyAgentic || tools.length ? "agent" : "ask";
          if (oSum) pending.completionTokens = oSum;
          if (iMax) pending.promptTokens = iMax;
          requests.push(pending);
        }
        pending = null;
        oSum = 0; iMax = 0; anyAgentic = false;
        refSet.clear(); editSet.clear(); tools.length = 0;
      };

      for (const item of conv) {
        const bubbleId: string = item.bubbleId || "";
        const bm = bubbles.get(`${composerId}:${bubbleId}`);
        // Text: inline from the header, or from the bubble record (header-only format).
        const inline = typeof item.text === "string" ? item.text.trim() : "";
        const text = inline || (bm ? bm.text.trim() : "");
        if (item.type === 1) {
          flush();
          if (!text) {
            pending = null;
            continue;
          }
          pending = mkRequest({
            requestId: `${composerId}:${bubbleId}`,
            timestamp: createdAt,
            messageText: text,
            messageLength: text.length,
          });
          // Files attached to the user message itself (@file, IDE selection).
          if (bm) { for (const f of bm.files) refSet.add(f); for (const a of bm.abs) sessionAbs.add(a); }
        } else if (item.type === 2 && pending) {
          if (text) {
            pending.responseText = text;
            pending.responseLength = text.length;
          }
          if (bm) {
            oSum += bm.o;                       // sum generation across all steps of the turn
            if (bm.i > iMax) iMax = bm.i;       // context is cumulative → take the max
            if (bm.tool) { tools.push(bm.tool); anyAgentic = true; }
            if (bm.edited) editSet.add(bm.edited);
            for (const f of bm.files) refSet.add(f);
            for (const a of bm.abs) sessionAbs.add(a);
          }
        }
      }
      flush();
      if (!requests.length) continue;

      // Project: authoritative mapping, otherwise fall back to absolute file paths
      // (both from bubbles and from composer-level context.fileSelections / allAttached).
      for (const a of composerAbsPaths(data)) sessionAbs.add(a);
      const wsName =
        wsMap.byComposer.get(composerId) ||
        inferProject(sessionAbs, wsMap.projects) ||
        "Cursor (no project)";
      // customInstructions are set centrally (markInstructions) by
      // project name — uniformly across all sources.
      sessions.push({
        sessionId: composerId,
        workspaceId: wsName,
        workspaceName: wsName,
        location: composerId,
        harness: "Cursor",
        creationDate: createdAt,
        lastMessageDate: updatedAt,
        requestCount: requests.length,
        requests,
      });
    }
  } finally {
    db.close();
  }
  return sessions;
}
