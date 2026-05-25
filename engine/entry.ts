// Entry point into the vendored MS engine (ai-engineering-coach, MIT).
// We re-export only what's needed for headless analysis in our server.

export { findLogsDirs, parseAllLogs, parseAllLogsAsync } from "./core/parser";
export { Analyzer } from "./core/analyzer";
export {
  registerAllBuiltinRules,
  registerAllBuiltinMetrics,
  loadAllRuleLayers,
} from "./core/rule-loader";
