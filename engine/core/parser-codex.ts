/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Codex CLI session parser
 *
 * Data layout (macOS):
 *   ~/.codex/sessions/<year>/<month>/<day>/rollout-<timestamp>-<uuid>.jsonl
 *
 * Each .jsonl file is a session. Lines have { type, timestamp, payload }
 *
 * type=session_meta:    payload.id, payload.cwd, payload.cli_version, payload.source, payload.model_provider
 * type=turn_context:    payload.model, payload.effort
 * type=event_msg:       payload.type = user_message|agent_reasoning|function_call|function_call_output|
 *                                      task_started|task_complete|token_count|turn_aborted|error|assistant_message
 * type=response_item:   payload.role, payload.content[]
 */

import * as fs from 'fs';
import * as path from 'path';
import { ModelUsage, Session, SessionRequest } from './types';
import { assertTrustedPath, readFileSafe, createRequest, createSession, detectDevcontainerFromRequests } from './parser-shared';
import { canonicalizeReasoningEffort, extractReasoningEffortFromModelId } from './helpers';

interface CodexLine {
  type: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
}

interface CodexSessionMeta {
  sessionId: string;
  cwd: string;
  source: string;
  model: string;
}

interface CodexContentItem {
  type: string;
  text?: string;
}

interface CodexParseState {
  requests: SessionRequest[];
  firstTs: number | null;
  lastTs: number | null;
  currentUserMessage: string;
  currentAssistantTexts: string[];
  currentToolsUsed: string[];
  currentEditedFiles: string[];
  currentReferencedFiles: string[];
  turnModel: string;
  turnEffort: 'max' | 'high' | 'medium' | 'low' | null;
  turnStartTs: number | null;
  turnEndTs: number | null;
  turnCanceled: boolean;
  prevTotalInput: number;
  prevTotalOutput: number;
  curTotalInput: number;
  curTotalOutput: number;
  curTotalCachedInput: number;
  hasTokenData: boolean;
  // Per-turn tokens from token_count.info.last_token_usage (real per-call input,
  // not the cumulative total). Output accumulates across tool rounds in a turn.
  turnLastInput: number;
  turnLastCached: number;
  turnSumOutput: number;
  turnHasLast: boolean;
}

/** Tool names (lowercase) that actually write/edit files. */
const CODEX_WRITE_TOOLS = new Set([
  'write', 'write_file', 'create_file', 'edit', 'edit_file',
  'apply_diff', 'patch', 'multi_edit', 'create', 'overwrite',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function parseCodexLine(rawLine: string): CodexLine | null {
  try {
    const parsed: unknown = JSON.parse(rawLine);
    if (!isRecord(parsed) || typeof parsed.type !== 'string') return null;
    let timestamp: string | undefined;
    if (typeof parsed.timestamp === 'string') {
      timestamp = parsed.timestamp;
    } else if (typeof parsed.timestamp === 'number') {
      timestamp = new Date(parsed.timestamp).toISOString();
    }
    return {
      type: parsed.type,
      timestamp,
      payload: recordValue(parsed.payload),
    };
  } catch {
    return null;
  }
}

function parseCodexLines(raw: string): CodexLine[] {
  const lines: CodexLine[] = [];
  for (const rawLine of raw.split('\n')) {
    if (!rawLine.trim()) continue;
    const parsed = parseCodexLine(rawLine);
    if (parsed) lines.push(parsed);
  }
  return lines;
}

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function projectNameFromCwd(cwd: string): string {
  return cwd.replaceAll('\\', '/').replace(/\/+$/, '').split('/').pop() || 'unknown';
}

function createCodexState(initialModel: string): CodexParseState {
  return {
    requests: [],
    firstTs: null,
    lastTs: null,
    currentUserMessage: '',
    currentAssistantTexts: [],
    currentToolsUsed: [],
    currentEditedFiles: [],
    currentReferencedFiles: [],
    turnModel: initialModel,
    turnEffort: null,
    turnStartTs: null,
    turnEndTs: null,
    turnCanceled: false,
    prevTotalInput: 0,
    prevTotalOutput: 0,
    curTotalInput: 0,
    curTotalOutput: 0,
    curTotalCachedInput: 0,
    hasTokenData: false,
    turnLastInput: 0,
    turnLastCached: 0,
    turnSumOutput: 0,
    turnHasLast: false,
  };
}

function computeModelUsage(state: CodexParseState, model: string): Record<string, ModelUsage> | undefined {
  if (!state.hasTokenData || (state.curTotalInput <= 0 && state.curTotalOutput <= 0)) return undefined;
  const billingModel = state.turnModel || model || 'untracked';
  const uncachedInput = Math.max(0, state.curTotalInput - state.curTotalCachedInput);
  return {
    [billingModel]: {
      inputTokens: uncachedInput,
      outputTokens: state.curTotalOutput,
      cacheReadTokens: state.curTotalCachedInput,
      cacheWriteTokens: 0,
    },
  };
}

function computeEndReason(
  modelUsage: Record<string, ModelUsage> | undefined,
  requests: SessionRequest[],
): 'shutdown' | 'aborted' | 'unknown' {
  if (modelUsage) return 'unknown';
  const everyRequestEmpty = requests.every(request =>
    !request.responseText && request.toolsUsed.length === 0 && request.editedFiles.length === 0,
  );
  return everyRequestEmpty ? 'aborted' : 'unknown';
}

function updateTimestamps(state: CodexParseState, ts: number | null): void {
  if (!ts) return;
  if (!state.firstTs || ts < state.firstTs) state.firstTs = ts;
  if (!state.lastTs || ts > state.lastTs) state.lastTs = ts;
}

function isTurnEmpty(state: CodexParseState): boolean {
  return state.currentAssistantTexts.length === 0
    && state.currentToolsUsed.length === 0
    && state.currentEditedFiles.length === 0
    && state.currentReferencedFiles.length === 0
    && !state.turnCanceled
    && state.curTotalInput === state.prevTotalInput
    && state.curTotalOutput === state.prevTotalOutput;
}

function flushCodexTurn(state: CodexParseState, defaultModel: string): void {
  if (!state.currentUserMessage && state.currentAssistantTexts.length === 0) return;

  const responseText = state.currentAssistantTexts.join('\n');

  // Prefer real per-turn tokens from last_token_usage; fall back to total-delta
  // for older logs / token_count events without last_token_usage.
  let reqPromptTokens: number | null;
  let reqCompletionTokens: number | null;
  if (state.turnHasLast) {
    reqPromptTokens = state.turnLastInput > 0 ? state.turnLastInput : null;
    reqCompletionTokens = state.turnSumOutput > 0 ? state.turnSumOutput : null;
  } else {
    reqPromptTokens = state.hasTokenData && state.curTotalInput > state.prevTotalInput
      ? state.curTotalInput - state.prevTotalInput
      : null;
    reqCompletionTokens = state.hasTokenData && state.curTotalOutput > state.prevTotalOutput
      ? state.curTotalOutput - state.prevTotalOutput
      : null;
  }
  state.prevTotalInput = state.curTotalInput;
  state.prevTotalOutput = state.curTotalOutput;

  // Turn end = last in-turn event (task_complete/tool/assistant), NOT the global
  // lastTs (which the next user_message would have advanced before this flush).
  const turnEnd = state.turnEndTs ?? state.lastTs;

  state.requests.push(createRequest({
    requestId: `codex-${state.requests.length}`,
    timestamp: state.turnStartTs,
    messageText: state.currentUserMessage,
    responseText,
    isCanceled: state.turnCanceled,
    agentName: 'Codex',
    agentMode: 'agent',
    modelId: state.turnModel || defaultModel,
    toolsUsed: state.currentToolsUsed,
    editedFiles: [...new Set(state.currentEditedFiles)],
    referencedFiles: [...new Set(state.currentReferencedFiles)],
    totalElapsed: state.turnStartTs && turnEnd && turnEnd > state.turnStartTs ? turnEnd - state.turnStartTs : null,
    promptTokens: reqPromptTokens,
    completionTokens: reqCompletionTokens,
    cacheReadTokens: state.turnHasLast && state.turnLastCached > 0 ? state.turnLastCached : null,
    reasoningEffort: state.turnEffort ?? extractReasoningEffortFromModelId(state.turnModel || defaultModel),
  }));

  state.currentUserMessage = '';
  state.currentAssistantTexts = [];
  state.currentToolsUsed = [];
  state.currentEditedFiles = [];
  state.currentReferencedFiles = [];
  state.turnStartTs = null;
  state.turnEndTs = null;
  state.turnCanceled = false;
  state.turnLastInput = 0;
  state.turnLastCached = 0;
  state.turnSumOutput = 0;
  state.turnHasLast = false;
}

function extractContentItems(value: unknown): CodexContentItem[] {
  if (!Array.isArray(value)) return [];
  const items: CodexContentItem[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.type !== 'string') continue;
    items.push({
      type: item.type,
      text: typeof item.text === 'string' ? item.text : undefined,
    });
  }
  return items;
}

function extractFilePath(args: Record<string, unknown> | null | undefined): string | null {
  if (!args) return null;
  if (typeof args.file_path === 'string') return args.file_path;
  if (typeof args.path === 'string') return args.path;
  if (typeof args.filename === 'string') return args.filename;
  return null;
}

function numValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Parse an apply_patch body ("*** Add/Update/Delete File: <path>", "*** Move to: <path>")
 *  into the absolute/relative file paths it touches. Codex sends edits this way
 *  (custom_tool_call name=apply_patch), so without this editedFiles stays empty. */
function extractPatchPaths(patch: string): string[] {
  const out: string[] = [];
  const re = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(patch)) !== null) {
    const p = m[1].trim();
    if (p) out.push(p);
  }
  return out;
}

/** Pull file-path-like tokens from a shell command string (Codex exec_command).
 *  Conservative: only absolute paths and relative paths with a slash + extension,
 *  so globs like `src/**` or `docs/**` are ignored. Enough to break the
 *  "Codex referencedFiles always empty" artifact without overcounting. */
const CMD_PATH_RE = /(?:\/[\w.\-]+)+\.[\w]{1,6}\b|\b[\w.\-]+\/[\w./\-]+\.[\w]{1,6}\b/g;
function extractPathsFromCmd(cmd: string): string[] {
  const found = cmd.match(CMD_PATH_RE);
  // Cap per command: for no-file-context we only need to know files were touched.
  // A listing command (rg --files / ls) can name dozens of paths — keeping them
  // all would masquerade as "attached 30+ files" and misfire excessive-file-context.
  return found ? [...new Set(found)].slice(0, 5) : [];
}

function handleUserMessageEvent(payload: Record<string, unknown>, state: CodexParseState, ts: number | null, defaultModel: string): void {
  const newMessage = stringValue(payload.message) || stringValue(payload.text);
  if (state.currentUserMessage && state.currentUserMessage === newMessage && isTurnEmpty(state)) {
    if (state.turnStartTs == null) state.turnStartTs = ts;
    return;
  }

  flushCodexTurn(state, defaultModel);
  state.currentUserMessage = newMessage;
  state.turnStartTs = ts;
}

/** Resolve a possibly-relative path against the turn's exec workdir. */
function resolveExecPath(p: string, workdir: string): string {
  if (p.startsWith('/')) return p;
  if (workdir) return path.join(workdir, p);
  return p;
}

/** Unified processing of a Codex tool call from any source (event_msg
 *  function_call, response_item function_call, response_item custom_tool_call).
 *  Populates toolsUsed plus edited/referenced files for the two tools Codex
 *  actually uses for the filesystem: apply_patch (writes) and exec_command (reads). */
function processToolCall(state: CodexParseState, toolName: string, rawArgs: unknown): void {
  if (!toolName) return;
  state.currentToolsUsed.push(toolName);
  const tool = toolName.toLowerCase();
  const args = typeof rawArgs === 'string' ? parseJsonRecord(rawArgs) : recordValue(rawArgs);

  if (tool === 'apply_patch') {
    // input is the patch body; may arrive as a raw string or as { input: "..." }.
    const patch = typeof rawArgs === 'string' ? rawArgs : stringValue(args?.input);
    for (const p of extractPatchPaths(patch)) {
      state.currentEditedFiles.push(p);
      state.currentReferencedFiles.push(p);
    }
    return;
  }
  if (tool === 'exec_command' || tool === 'shell' || tool === 'local_shell') {
    const cmd = stringValue(args?.cmd) || stringValue(args?.command);
    const workdir = stringValue(args?.workdir) || stringValue(args?.cwd);
    for (const p of extractPathsFromCmd(cmd)) state.currentReferencedFiles.push(resolveExecPath(p, workdir));
    return;
  }
  if (CODEX_WRITE_TOOLS.has(tool)) {
    const filePath = extractFilePath(args);
    if (filePath) { state.currentEditedFiles.push(filePath); state.currentReferencedFiles.push(filePath); }
  }
}

function handleFunctionCallEvent(payload: Record<string, unknown>, state: CodexParseState): void {
  processToolCall(state, stringValue(payload.name) || 'unknown', payload.arguments);
}

function handleAssistantMessageEvent(payload: Record<string, unknown>, state: CodexParseState): void {
  const content = payload.content;
  if (typeof content === 'string') state.currentAssistantTexts.push(content);
}

function handleTokenCountEvent(payload: Record<string, unknown>, state: CodexParseState): void {
  const info = recordValue(payload.info);
  if (!info) return; // some token_count events carry info:null — skip

  // Session-level cumulative totals (used for billing modelUsage).
  const totalUsage = recordValue(info.total_token_usage);
  if (totalUsage) {
    state.curTotalInput = numValue(totalUsage.input_tokens);
    state.curTotalOutput = numValue(totalUsage.output_tokens);
    state.curTotalCachedInput = numValue(totalUsage.cached_input_tokens);
    state.hasTokenData = true;
  }

  // Per-turn real usage from last_token_usage (the latest API call's own counts,
  // not the cumulative total). input = context size of that call; output sums
  // across the tool rounds within a turn. Preferred over total-delta for the
  // per-request promptTokens/completionTokens fields.
  const last = recordValue(info.last_token_usage);
  if (last) {
    state.turnLastInput = numValue(last.input_tokens);
    state.turnLastCached = numValue(last.cached_input_tokens) || numValue(last.cache_read_input_tokens);
    state.turnSumOutput += numValue(last.output_tokens);
    state.turnHasLast = true;
  }
}

/** event_msg:patch_apply_end — the applied edit; payload.changes maps absolute
 *  file paths to {type:add|update|delete,...}. Most reliable source of edited files. */
function handlePatchApplyEnd(payload: Record<string, unknown>, state: CodexParseState): void {
  const changes = recordValue(payload.changes);
  if (!changes) return;
  for (const p of Object.keys(changes)) {
    if (!p) continue;
    state.currentEditedFiles.push(p);
    state.currentReferencedFiles.push(p);
  }
}

function handleEventMsg(payload: Record<string, unknown>, state: CodexParseState, ts: number | null, defaultModel: string): void {
  const eventType = stringValue(payload.type);
  if (eventType === 'user_message') {
    handleUserMessageEvent(payload, state, ts, defaultModel);
    return;
  }
  // Everything below belongs to the in-progress turn — its timestamp marks the
  // turn's end (NOT the next user_message ts, which used to pollute totalElapsed
  // and force every speed-accept gap to 0).
  if (ts != null) state.turnEndTs = ts;
  if (eventType === 'agent_reasoning') {
    state.currentAssistantTexts.push(stringValue(payload.text));
    return;
  }
  if (eventType === 'function_call') {
    handleFunctionCallEvent(payload, state);
    return;
  }
  if (eventType === 'assistant_message') {
    handleAssistantMessageEvent(payload, state);
    return;
  }
  if (eventType === 'token_count') {
    handleTokenCountEvent(payload, state);
    return;
  }
  if (eventType === 'patch_apply_end') {
    handlePatchApplyEnd(payload, state);
    return;
  }
  if (eventType === 'turn_aborted') state.turnCanceled = true;
}

function handleTurnContext(payload: Record<string, unknown>, state: CodexParseState): void {
  const model = stringValue(payload.model);
  if (model) state.turnModel = model;
  const effort = payload.effort;
  if (effort !== undefined && effort !== null) {
    state.turnEffort = canonicalizeReasoningEffort(stringValue(effort));
  }
}

function handleUserResponseItem(payload: Record<string, unknown>, state: CodexParseState, ts: number | null, defaultModel: string): void {
  for (const item of extractContentItems(payload.content)) {
    if (item.type !== 'input_text' || !item.text || item.text.startsWith('<')) continue;
    if (!state.currentUserMessage) {
      flushCodexTurn(state, defaultModel);
      state.currentUserMessage = item.text;
      state.turnStartTs = ts;
    }
  }
}

function handleAssistantResponseItem(payload: Record<string, unknown>, state: CodexParseState): void {
  for (const item of extractContentItems(payload.content)) {
    if (item.type === 'output_text' && item.text) state.currentAssistantTexts.push(item.text);
  }
}

function handleFunctionCallResponseItem(payload: Record<string, unknown>, state: CodexParseState): void {
  processToolCall(state, stringValue(payload.name), payload.arguments);
}

/** response_item:custom_tool_call — Codex sends apply_patch this way; input is the patch body. */
function handleCustomToolCallResponseItem(payload: Record<string, unknown>, state: CodexParseState): void {
  processToolCall(state, stringValue(payload.name), payload.input ?? payload.arguments);
}

function handleResponseItem(payload: Record<string, unknown>, state: CodexParseState, ts: number | null, defaultModel: string): void {
  const role = stringValue(payload.role);
  const itemType = stringValue(payload.type);
  if (role === 'user') {
    handleUserResponseItem(payload, state, ts, defaultModel);
    return;
  }
  // Assistant/tool response items belong to the in-progress turn → advance turn end.
  if (ts != null) state.turnEndTs = ts;
  if (role === 'assistant' && itemType === 'message') {
    handleAssistantResponseItem(payload, state);
    return;
  }
  if (itemType === 'function_call') { handleFunctionCallResponseItem(payload, state); return; }
  if (itemType === 'custom_tool_call') handleCustomToolCallResponseItem(payload, state);
}

function extractSessionMeta(lines: CodexLine[], filePath: string): CodexSessionMeta {
  let sessionId = '';
  let cwd = '';
  let source = '';
  let model = '';

  for (const line of lines) {
    if (line.type === 'session_meta') {
      const payload = line.payload || {};
      sessionId = stringValue(payload.id);
      cwd = stringValue(payload.cwd);
      source = stringValue(payload.source);
    }
    if (line.type === 'turn_context' && !model) {
      model = stringValue(line.payload?.model);
    }
  }

  if (!sessionId) sessionId = path.basename(filePath, '.jsonl');
  return { sessionId, cwd, source, model };
}

export function findCodexDirs(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const dirs: string[] = [];
  const sessionsDir = path.join(home, '.codex', 'sessions');
  if (fs.existsSync(sessionsDir)) dirs.push(sessionsDir);
  return dirs;
}

export function parseCodexSessions(sessionsDir: string): Session[] {
  const sessions: Session[] = [];
  const files = findAllJsonlFiles(sessionsDir);

  for (const filePath of files) {
    const session = parseCodexSessionFile(filePath);
    if (session) sessions.push(session);
  }

  return sessions;
}

function findAllJsonlFiles(dir: string): string[] {
  const result: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        result.push(...findAllJsonlFiles(full));
      } else if (e.isFile() && e.name.endsWith('.jsonl')) {
        result.push(full);
      }
    }
  } catch {
    /* skip unreadable dirs */
  }
  return result;
}

function parseCodexSessionFile(filePath: string): Session | null {
  assertTrustedPath(filePath);
  let raw: string;
  try {
    const content = readFileSafe(filePath);
    if (content === null) return null;
    raw = content;
  } catch {
    return null;
  }

  const lines = parseCodexLines(raw);
  if (lines.length === 0) return null;

  const meta = extractSessionMeta(lines, filePath);
  const wsName = projectNameFromCwd(meta.cwd);
  const wsId = `codex-${wsName}-${meta.sessionId.slice(0, 8)}`;
  const state = createCodexState(meta.model);

  for (const line of lines) {
    const ts = line.timestamp ? new Date(line.timestamp).getTime() : null;
    updateTimestamps(state, ts);

    if (line.type === 'event_msg') {
      handleEventMsg(line.payload || {}, state, ts, meta.model);
      continue;
    }
    if (line.type === 'turn_context') {
      handleTurnContext(line.payload || {}, state);
      continue;
    }
    if (line.type === 'response_item') handleResponseItem(line.payload || {}, state, ts, meta.model);
  }

  flushCodexTurn(state, meta.model);
  if (state.requests.length === 0) return null;

  const modelUsage = computeModelUsage(state, meta.model);
  const endReason = computeEndReason(modelUsage, state.requests);

  return createSession({
    sessionId: meta.sessionId,
    workspaceId: wsId,
    workspaceName: wsName,
    location: meta.source || 'terminal',
    harness: 'Codex',
    creationDate: state.firstTs,
    lastMessageDate: state.lastTs,
    requests: state.requests,
    modelUsage,
    endReason,
    hasDevcontainer: detectDevcontainerFromRequests(state.requests, meta.cwd),
  });
}
