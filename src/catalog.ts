// Bilingual catalog for the 45 vendored engine rules + shared UI labels.
//
// The engine emits English text already: rule names, descriptions with the
// numbers/percentages substituted in, and suggestions. For English we pass that
// through unchanged; for Russian we override names here and re-translate the
// description/suggestion (the engine never exposes the raw template + values, so
// we recover the numbers from the English string with a regex). If a template
// does not match we fall back to the English text — safe, nothing breaks.

export type Lang = "ru" | "en";

// ── Rule display names (Russian overrides; English comes from the engine) ──
const NAMES_RU: Record<string, string> = {
  "abandon-sessions": "Брошенные сессии",
  "agent-mode-for-asks": "Агент ради простых вопросов",
  "agentic-no-tools": "Агент без инструментов",
  "auto-approve-terminal": "Автоодобрение терминала",
  "auto-avoidance": "Уход от «авто»-модели",
  "broken-flow-state": "Сбитый фокус",
  "cache-hit-starvation": "Голодание кеша промптов",
  "caps-lock": "Капс и крик",
  "context-engineering-gaps": "Провалы в контексте",
  "copy-paste-blindness": "Слепой копипаст",
  "excessive-file-context": "Перегруз файлами в контексте",
  "frustration-signals": "Сигналы фрустрации",
  "high-cancellation": "Частые отмены",
  "instruction-bloat": "Раздутые инструкции",
  "late-night-coding": "Ночной кодинг",
  "lazy-prompting": "Ленивые промпты",
  "low-constraint-usage": "Промпты без рамок",
  "low-markdown-ratio": "Мало структуры в ответах",
  "mcp-tool-bloat": "Перебор инструментов / MCP",
  "mega-sessions": "Мега-сессии",
  "model-overreliance": "Зависимость от одной модели",
  "no-custom-instructions": "Нет кастомных инструкций",
  "no-devcontainer": "Терминал без песочницы",
  "no-file-context": "Нет файлов в контексте",
  "no-language-exploration": "Один язык на всё",
  "no-plan-mode": "Без режима планирования",
  "no-skills": "Не используешь скиллы",
  "no-slash-commands": "Без слэш-команд",
  "no-spec-driven-development": "Без спеки (ТЗ)",
  "no-spec-structure": "Старт задачи без структуры",
  "premium-for-lookup-questions": "Премиум-модель ради справки",
  "premium-waste": "Слив премиум-модели",
  "profanity": "Грубость и мат",
  "reasoning-effort-overuse": "Перебор reasoning-усилия",
  "repeated-prompts": "Повторяющиеся промпты",
  "runaway-agent-loops": "Зацикленный агент",
  "session-drift": "Дрейф темы сессии",
  "slow-responses": "Медленные ответы",
  "speed-accept": "Принятие без ревью",
  "tunnel-vision": "Туннельное зрение (один проект)",
  "verbose-output": "Многословные ответы",
  "verbose-prompt-no-compression": "Многословные промпты без сжатия",
  "vibe-coding": "Чистый вайбкодинг",
  "weekend-overwork": "Переработки в выходные",
  "yolo-mode": "YOLO-режим",
  // Dynamic / merged rules (depend on the harness).
  "low-context-provision": "Мало контекста",
  "low-context-provision-cursor": "Мало контекста (Cursor)",
  "low-context-provision-codex": "Мало контекста (Codex)",
  "runaway-context": "Разрастание контекста",
};

export function localizeName(id: string, engineName: string, lang: Lang): string {
  return lang === "ru" ? NAMES_RU[id] || engineName : engineName;
}

// ── "How to fix" (Russian overrides; English comes from the engine) ──
const FIX_RU: Record<string, string> = {
  "no-custom-instructions": "Заведи файл инструкций (CLAUDE.md, .cursorrules, .github/copilot-instructions.md) — дай агенту постоянный контекст о проекте, стеке и стиле.",
  "no-slash-commands": "Оформляй частые задачи как слэш-команды/скиллы, чтобы не печатать одно и то же заново.",
  "no-file-context": "Ссылайся на файлы (@file, пути), чтобы агент видел нужный код, а не угадывал.",
  "agentic-no-tools": "Агент не вызвал ни одного инструмента — для работы над кодом дай ему доступ к файлам и терминалу, а не общайся вслепую.",
  "low-context-provision": "Давай больше контекста сразу: какие файлы, что менять, какие ограничения.",
  "low-context-provision-cursor": "Давай больше контекста сразу: какие файлы, что менять, какие ограничения.",
  "low-context-provision-codex": "Давай больше контекста сразу: какие файлы, что менять, какие ограничения.",
  "runaway-context": "Контекст разросся — начни свежую сессию или сожми историю, иначе ответы деградируют.",
  "agent-mode-for-asks": "Простые справочные вопросы не требуют агент-режима — спроси в обычном чате.",
  "weekend-overwork": "Выходные — для отдыха. Переработки бьют по качеству промптов и ведут к выгоранию.",
  "slow-responses": "Медленные ответы часто = слишком большой контекст. Дроби задачи и чисти контекст.",
  "low-constraint-usage": "Добавляй рамки: «не трогай X», «только файл Y», «без новых зависимостей».",
  "lazy-prompting": "Описывай намерение, ограничения и ожидаемый результат, а не «почини это».",
  "mega-sessions": "Дроби работу на сессии — длинный контекст замусоривается и снижает точность.",
  "late-night-coding": "Ночью растёт доля ошибок и слепого принятия правок. Сон тоже часть работы.",
  "reasoning-effort-overuse": "Не каждой задаче нужен максимальный reasoning — это дороже и медленнее.",
  "repeated-prompts": "Повторяешь формулировку — вынеси её в команду/скилл.",
  "caps-lock": "Капс не ускоряет модель — сформулируй спокойно и конкретно.",
  "profanity": "Грубость не улучшает результат — лучше уточни, что именно не так.",
  "vibe-coding": "Короткий промпт → агент додумывает за тебя. Опиши задачу до того, как он коснётся кода.",
  "speed-accept": "Читай AI-код перед принятием — беглый взгляд это не ревью.",
  "premium-waste": "Справочные вопросы — на дешёвой модели; премиум береги для сложных задач.",
  "premium-for-lookup-questions": "Справочные вопросы дешевле загуглить или спросить у дешёвой модели.",
  "copy-paste-blindness": "Не вставляй AI-код вслепую — проверяй корректность и крайние случаи.",
  "frustration-signals": "Когда модель «не понимает» — обычно не хватает контекста. Дай факты, а не упрёки.",
  "excessive-file-context": "Прикладывай 3–5 самых релевантных файлов, а не всё подряд. Используй #codebase или #file:<glob>, чтобы модель искала по запросу. Для разведки — сначала grep, потом подгрузка только нужного.",
  "no-spec-driven-development": "Начинай сессию с краткой спеки: 1) что строим, 2) критерии приёмки, 3) ограничения. Даже 3 пункта заметно поднимают качество ответа.",
  "runaway-agent-loops": "Дроби сложные задачи на мелкие. Если агент закольцевался — отмени и переформулируй с чёткими рамками.",
  "session-drift": "Меняешь тип задачи (баг→фича, доки→тесты) — начинай новую сессию. Сфокусированные сессии дают лучшие ответы.",
  "context-bloat": "Чаще начинай новые сессии. Большую задачу разбивай на отдельные узкие сессии вместо одной длинной нити.",
  "low-markdown-ratio": "Перед кодом проси набросать спеку/план/дизайн-док. Даже короткий markdown-план повышает качество и сокращает число итераций.",
  "context-engineering-gaps": "Прокачай контекст: заведи AGENTS.md, SKILL.md для доменных знаний, подключи MCP-инструменты, ссылайся на #file, добавь .instructions.md с конвенциями проекта.",
  "no-spec-structure": "Начинай агентные сессии со структуры: списки, нумерованные требования, критерии приёмки. Чем конкретнее первый промпт — тем лучше результат.",
  "no-language-exploration": "Не зацикливайся на одном языке/стеке — для разных задач ИИ хорош в разных экосистемах.",
  "tunnel-vision": "Весь вайб уходит в один проект — это норма, но проверь, не пора ли распределять внимание.",
};

export function localizeFix(id: string, en: string, lang: Lang): string {
  return lang === "ru" ? FIX_RU[id] || en : en;
}

// ── Description translators (Russian only). Recover numbers from the English
// string the engine produced and rebuild a Russian sentence. ──
const DESC_RU: Record<string, (en: string) => string> = {
  "no-custom-instructions": (en) => {
    const m = en.match(/Only (\d+)% of requests use custom instructions \((\d+)\/(\d+)\)/);
    return m ? `Лишь ${m[1]}% запросов используют кастомные инструкции (${m[2]}/${m[3]}). Ты упускаешь персонализированные ответы.` : en;
  },
  "no-slash-commands": (en) => {
    const m = en.match(/Only (\d+) of (\d+) requests use slash commands/);
    return m ? `Лишь ${m[1]} из ${m[2]} запросов используют слэш-команды. Слэш-команды дают более точные ответы.` : en;
  },
  "no-file-context": (en) => {
    const m = en.match(/(\d+)% of requests have no file references/);
    return m ? `${m[1]}% запросов не ссылаются на файлы. С файловым контекстом ответы точнее.` : en;
  },
  "agentic-no-tools": (en) => {
    const m = en.match(/(\d+) agentic requests used no tools/);
    return m ? `${m[1]} агентных запросов прошли без единого инструмента. Агент-режим раскрывается только когда инструменты включены.` : en;
  },
  "low-context-provision": (en) => {
    const m = en.match(/(\d+) requests with low context score \(([^)]+)\)/);
    return m ? `${m[1]} запросов с низким контекст-скором (${m[2]}): мало ссылок на файлы и кастомных инструкций.` : en;
  },
  "low-context-provision-cursor": (en) => descLowContext(en),
  "low-context-provision-codex": (en) => descLowContext(en),
  "low-constraint-usage": (en) => {
    const m = en.match(/Only (\d+)% of prompts include constraints \((\d+)\/(\d+)\)/);
    return m ? `Лишь ${m[1]}% промптов содержат ограничения (${m[2]}/${m[3]}). Ограничения сужают вывод модели, снижают галлюцинации и повышают качество кода.` : en;
  },
  "agent-mode-for-asks": (en) => {
    const m = en.match(/(\d+) agent-mode requests \((\d+)%\) were trivially short \((\d+) chars\)/);
    return m ? `${m[1]} запросов в агент-режиме (${m[2]}%) были совсем короткими (до ${m[3]} симв.) — без вызова инструментов, правок и кода. Простые вопросы через агента оплачивают его цикл впустую.` : en;
  },
  "weekend-overwork": (en) => {
    const m = en.match(/(\d+) requests \((\d+)%\) happen on weekends/);
    return m ? `${m[1]} запросов (${m[2]}%) приходятся на выходные. Возможны проблемы с балансом работы и отдыха.` : en;
  },
  "repeated-prompts": (en) => {
    const m = en.match(/(\d+) requests are near-duplicates across (\d+) distinct prompts/);
    return m ? `${m[1]} запросов — почти-дубли в пределах ${m[2]} различных формулировок. Это жжёт квоту без новых результатов.` : en;
  },
  "no-spec-driven-development": (en) => {
    const m = en.match(/Only (\d+) of (\d+) sessions \((\d+)%\) start with specs/);
    return m ? `Лишь ${m[1]} из ${m[2]} сессий (${m[3]}%) начинаются со спеки, плана или структурированных требований. Spec-first стабильно обыгрывает вайбкодинг.` : en;
  },
  "slow-responses": (en) => {
    const m = en.match(/(\d+) requests took over 30 seconds \(avg (\d+)s\)/);
    return m ? `${m[1]} запросов отвечали дольше 30 секунд (в среднем ${m[2]}с). Возможно, промпты слишком широкие.` : en;
  },
  "frustration-signals": (en) => {
    const m = en.match(/(\d+) requests show frustration indicators/);
    return m ? `${m[1]} запросов содержат признаки фрустрации (избыток пунктуации, КАПС). Обычно это значит, что подход не работает.` : en;
  },
  "reasoning-effort-overuse": (en) => {
    const m = en.match(/(\d+) of (\d+) requests with a known reasoning level \((\d+)%\)/);
    return m ? `${m[1]} из ${m[2]} запросов с известным reasoning-уровнем (${m[3]}%) шли на «high»/«max» — у Codex это часто значение по умолчанию. Лишние «думающие» токены оплачиваются, даже когда задача того не требует.` : en;
  },
  "runaway-agent-loops": (en) => {
    const m = en.match(/(\d+) agentic requests used (\d+)\+ tools each \(avg (\d+)\)/);
    return m ? `${m[1]} запросов с очень длинными агентными цепочками (${m[2]}+ инструментов за запрос, в среднем ${m[3]}). Возможно, стоит дробить задачи на более мелкие.` : en;
  },
  "caps-lock": (en) => {
    const m = en.match(/(\d+) requests are written mostly or entirely in CAPS LOCK/);
    return m ? `${m[1]} запросов написаны почти или полностью КАПСОМ — признак сильного раздражения.` : en;
  },
  "runaway-context": (en) => {
    const m = en.match(/(\d+) session\(s\) show steadily growing context/);
    return m ? `${m[1]} сессий показывают неуклонно растущий контекст без стабилизации — он копится быстрее, чем следует.` : en;
  },
  "late-night-coding": (en) => {
    const m = en.match(/(\d+) requests were made between midnight and 5am/);
    return m ? `${m[1]} запросов сделаны между полуночью и 5 утра. Ночной кодинг коррелирует с багами и падением качества.` : en;
  },
  "premium-waste": (en) => {
    const m = en.match(/(\d+) simple requests/);
    return m ? `${m[1]} простых запросов (короткий промпт, без кода на выходе) ушли на премиум-модели.` : en;
  },
  "session-drift": (en) => {
    const m = en.match(/(\d+) sessions cover 4\+ different task types/);
    return m ? `${m[1]} сессий охватывают 4+ разных типа задач. Сессии «обо всём» путают контекст ИИ.` : en;
  },
  "profanity": (en) => {
    const m = en.match(/(\d+) requests contain profanity or hostile language/);
    return m ? `${m[1]} запросов содержат ненормативную лексику. Чаще это эмоции (включая одобрение), чем фрустрация — на результат не влияет.` : en;
  },
  "speed-accept": (en) => {
    const m = en.match(/(\d+) times you sent the next message within 15s of receiving 20\+ lines of AI code \(avg (\d+) LOC, avg (\d+)s gap\)/);
    return m ? `${m[1]} раз ты отправлял следующее сообщение в пределах 15с после 20+ строк ИИ-кода (в среднем ${m[2]} строк, пауза ~${m[3]}с). На ревью времени не было.` : en;
  },
  "copy-paste-blindness": (en) => {
    const m = en.match(/(\d+) sessions have large AI-generated code blocks/);
    return m ? `${m[1]} сессий содержат крупные блоки ИИ-кода без последующей доработки. Похоже, код принимается без ревью.` : en;
  },
  "vibe-coding": (en) => {
    const m = en.match(/(\d+) sessions show vibe-coding patterns/);
    return m ? `${m[1]} сессий показывают паттерн вайбкодинга: ИИ генерит код по минимальным промптам, без спек и почти без ревью. Скорость без понимания копит долг знаний.` : en;
  },
  "mega-sessions": (en) => {
    const m = en.match(/(\d+) session\(s\) have 50\+ messages/);
    return m ? `${m[1]} сессий содержат 50+ сообщений. Длинные сессии портят контекст и снижают точность ответов.` : en;
  },
  "context-bloat": (en) => {
    const m = en.match(/(\d+) session\(s\) run above 80% average context utilization/);
    return m ? `${m[1]} сессий идут при средней загрузке контекста выше 80%. Модель работает с почти полным окном — качество падает.` : en;
  },
  "low-markdown-ratio": (en) => {
    const m = en.match(/(\d+) workspace\(s\) produce almost no markdown \((\d+)% of AI output\)\. (\d+) LoC of code vs (\d+) LoC of markdown/);
    return m ? `${m[1]} проектов почти не порождают markdown (${m[2]}% вывода ИИ): ${m[3]} строк кода против ${m[4]} строк markdown. Похоже, спеки, планы и документация пропускаются.` : en;
  },
  "excessive-file-context": (en) => {
    const m = en.match(/(\d+) request\(s\) attached ≥\s*\d* files to the prompt \(largest: (\d+) files\)/);
    return m ? `${m[1]} запросов прикрепили 30+ файлов к промпту (рекорд: ${m[2]}). Модель читает лишь часть больших вложений — остальное оплаченный контекст впустую.` : en;
  },
  "context-engineering-gaps": (en) => {
    const m = en.match(/(\d+) of (\d+) context engineering signals missing/);
    return m ? `${m[1]} из ${m[2]} сигналов контекст-инжиниринга отсутствуют. ИИ не хватает контекста, чтобы работать на максимуме.` : en;
  },
};

// Shared translator for low-context-provision-<harness>.
function descLowContext(en: string): string {
  const m = en.match(/^(\w+): (\d+) requests with context score (\d+)\/100\. Only (\d+)% include file references, (\d+)% use custom instructions\./);
  return m
    ? `${m[1]}: ${m[2]} запросов со средним контекст-скором ${m[3]}/100. Лишь ${m[4]}% содержат ссылки на файлы, ${m[5]}% — кастомные инструкции.`
    : en;
}

export function localizeDesc(id: string, en: string, lang: Lang): string {
  if (lang !== "ru") return en;
  const fn = DESC_RU[id];
  return fn ? fn(en) : en;
}

// ── Group / severity / unit / code-language labels ──
const GROUP: Record<string, Record<Lang, string>> = {
  "prompt-quality": { ru: "Качество промптов", en: "Prompt Quality" },
  "session-hygiene": { ru: "Гигиена сессий", en: "Session Hygiene" },
  "tool-mastery": { ru: "Владение инструментами", en: "Tool Mastery" },
  "code-review": { ru: "Ревью кода", en: "Code Review" },
  "context-management": { ru: "Управление контекстом", en: "Context Management" },
};
export function groupLabel(group: string, lang: Lang): string {
  return GROUP[group]?.[lang] || group;
}

const SEVERITY: Record<string, Record<Lang, string>> = {
  low: { ru: "низкая", en: "low" },
  medium: { ru: "средняя", en: "medium" },
  high: { ru: "высокая", en: "high" },
};
export function severityLabel(sev: string, lang: Lang): string {
  return SEVERITY[sev]?.[lang] || sev;
}

export type Scope = "requests" | "sessions" | "workspaces";
const UNIT: Record<Scope, Record<Lang, string>> = {
  requests: { ru: "запросов", en: "requests" },
  sessions: { ru: "сессий", en: "sessions" },
  workspaces: { ru: "проектов", en: "projects" },
};
export function unitLabel(scope: Scope, lang: Lang): string {
  return UNIT[scope][lang];
}

const CODE_LANG: Record<string, Record<Lang, string>> = {
  unknown: { ru: "без языка", en: "unknown" },
  text: { ru: "текст", en: "text" },
  markdown: { ru: "markdown", en: "markdown" },
};
export function codeLangLabel(label: string, lang: Lang): string {
  return CODE_LANG[label]?.[lang] || label;
}

// ── Verdict (overall score → punchline) ──
const VERDICTS: Record<Lang, string[]> = {
  ru: ["инженерный вайб", "крепкий середняк", "вайб с запашком", "сомнительный вайб", "приговор: вайбкодер"],
  en: ["engineered vibe", "solid mid-tier", "vibe with a whiff", "questionable vibe", "verdict: vibe-coder"],
};
export function verdict(score: number, lang: Lang): string {
  const i = score >= 85 ? 0 : score >= 70 ? 1 : score >= 55 ? 2 : score >= 40 ? 3 : 4;
  return VERDICTS[lang][i];
}

// ── Data-coverage matrix labels ──
export const COVERAGE_KEYS = ["model", "tokens", "reasoning", "aiLoc", "edits", "contextFiles", "duration", "tools"] as const;
export type CoverageKey = (typeof COVERAGE_KEYS)[number];
const COVERAGE_FEATURE: Record<CoverageKey, Record<Lang, string>> = {
  model: { ru: "Модель", en: "Model" },
  tokens: { ru: "Токены (расход)", en: "Tokens (spend)" },
  reasoning: { ru: "Reasoning-усилие", en: "Reasoning effort" },
  aiLoc: { ru: "Код от ИИ (LoC)", en: "AI code (LoC)" },
  edits: { ru: "Правки файлов", en: "File edits" },
  contextFiles: { ru: "Контекст-файлы", en: "Context files" },
  duration: { ru: "Длительность", en: "Duration" },
  tools: { ru: "Инструменты", en: "Tools" },
};
export function coverageFeatureLabel(key: CoverageKey, lang: Lang): string {
  return COVERAGE_FEATURE[key][lang];
}
export function coverageNote(lang: Lang): string {
  return lang === "ru"
    ? "Cursor не пишет токены в локальную БД с янв 2026 — расход по нему не виден, только активность."
    : "Cursor stopped writing token counts to its local DB in Jan 2026 — spend isn't visible for it, only activity.";
}
