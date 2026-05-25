---
id: low-constraint-usage
name: Low Constraint Usage
group: prompt-quality
severity: medium
scope: requests
version: 1
tags: [prompt, constraints, quality]
thresholds:
  minReqs: 30
  minMessageLength: 40
  constraintRate: 0.08
patterns:
  constraintKeywords: ["\\b(do not|don't|must not|never|without|avoid|only|strictly|limit to|at most|at least|no more than|require|restrict|exclude|ensure|must|shall)\\b"]
---

# Description
Detects prompts that lack constraint keywords (do not, must, avoid, only, etc.). Constraints narrow AI output, reduce hallucinations, and produce higher-quality code.

# When Triggered
Only {{extra.constraintPct}}% of prompts include constraints ({{extra.withConstraints}}/{{extra.substantialReqs}}). Constraints narrow AI output, reduce hallucinations, and produce higher-quality code.

# How to Improve
Add explicit constraints to prompts: "do not use class components", "only use async/await", "limit to 50 lines", "avoid external dependencies". Negative constraints force the model out of boilerplate patterns and into more precise solutions.

# Examples
"{{message}}..." (no constraints)

# Detection Logic
```detect
scan: requests
match: messageLength >= thresholds.minMessageLength AND NOT ( \
  matches(messageText, "(?i)\\b(do not|don't|must not|never|without|avoid|only|strictly|limit to|at most|at least|no more than|require|restrict|exclude|ensure|must|shall|should not)\\b") OR \
  matches(messageText, "(?iu)(?<![а-яё])(нельзя|запрещ|только|лишь|исключительн|избега|должен|должн|обязател|обязан|строго|максимум|минимум|ограничь|ограничива|ограничен|ровно|без\\s|не\\s+(делай|используй|трогай|меняй|добавляй|создавай|удаляй|ломай|затрагивай|более|менее|больше|меньше)|оставь\\s+как)") )
aggregate: count
substantialTotal: countWhere(all, "messageLength", ">=", thresholds.minMessageLength)
withConstraints: substantialTotal - count
substantialReqs: substantialTotal
constraintPct: round((substantialTotal - count) / substantialTotal * 100)
check: substantialTotal >= thresholds.minReqs AND count / substantialTotal > (1 - thresholds.constraintRate)
examples: "{{messageText | truncate:80}}" (no constraints)
```
