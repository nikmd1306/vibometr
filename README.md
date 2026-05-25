# Vibometr

[![Telegram](https://img.shields.io/badge/Telegram-vibe--coding-2AABEE?logo=telegram&logoColor=white)](https://t.me/atlfreedom)

**Vibometr measures your vibe-coding.** It reads your local Claude Code, Codex, and Cursor logs, scores how you work with AI, and shows it all on a dashboard — anti-patterns, token spend, activity, and the code your agents wrote.

Everything runs on your machine. **No accounts, no telemetry, nothing leaves your computer.** The tool only reads logs; it never modifies them.

The dashboard speaks both **English and Russian** — flip the toggle in the top-right corner.

## Quick start

You need [Node.js](https://nodejs.org) **22.18 or newer** (check with `node -v`).

```bash
git clone https://github.com/nikmd1306/vibometr.git
cd vibometr
npm install
npm start
```

That's it. Your browser opens to `http://localhost:5274`. The first load takes ~30 seconds while it reads your logs; after that it's instant.

> Already have Node? You can also run it without cloning:
> ```bash
> npx github:nikmd1306/vibometr
> ```

## What you get

- **Vibe score** (0–100) with a verdict, broken down by area: prompt quality, session hygiene, context management, tool mastery, code review.
- **Anti-patterns** — concrete habits worth fixing (vibe-coding, premium-model waste, runaway agent loops, late-night coding, frustration signals…), each with how to improve.
- **Spend** — tokens generated, by model and by source.
- **Code** — how many lines your AI wrote, by language and project.
- **Activity** — when you code (hours, weekends, late nights).
- **Data coverage** — which signals each tool actually records, so you know what the numbers are based on.

## Which logs it reads

Vibometr auto-discovers logs already on your disk:

- **Claude Code** and **Codex** — their local session logs.
- **Cursor** — its local SQLite store (`state.vscdb`).

The more tools you use, the fuller the picture. The dashboard's **data-coverage matrix** shows exactly what each source provides (e.g. Cursor stopped writing token counts locally in early 2026, so its spend isn't visible).

## How it works

```
your logs ──▶ parse (once, cached) ──▶ analyze per period ──▶ dashboard
```

- A small local server (`src/server.ts`) serves the dashboard and a JSON API.
- The analysis engine is built on the open-source [`ai-engineering-coach`](https://github.com/microsoft/ai-engineering-coach) rule set (MIT), vendored under `engine/` and bundled at install time, plus our own Cursor parser, bilingual catalog, and language detection.
- Results are cached per time period in your OS temp dir, so switching periods or languages is fast.

## Privacy

Vibometr makes **zero network requests**. It reads logs locally, analyzes them in memory, and serves the result to `localhost` only. Your prompts, code, and tokens never leave the machine.

## Author

Built by [@nikmd1306](https://github.com/nikmd1306). I write about vibe-coding on Telegram — [**@atlfreedom**](https://t.me/atlfreedom).

## License

MIT. Built on Microsoft's [`ai-engineering-coach`](https://github.com/microsoft/ai-engineering-coach) (MIT).
