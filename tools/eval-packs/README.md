# tools/eval-packs

Owned by #22. Measures live skin generation (`apps/web/api/_lib/llm`) against the real OpenRouter API: 30 prompts (ordinary, other languages, famous characters, injection, nonsense, unsafe) × 2 themes × each candidate fast model. Reports the valid-after-sanitise rate (must be 100%), p50/p95 latency and cost per skin as a Markdown table for the PR.

Needs `OPENROUTER_API_KEY`; **not run in CI**. A full run with `google/gemini-2.5-flash-lite` is 60 calls, a few cents. `--budget` (default $0.25) stops the run before it spends more.

```bash
bun run eval:packs                                   # default fast model, b:fixture-theme + e:theme-fixture
bun run eval:packs --models google/gemini-2.5-flash-lite,openai/gpt-5-nano --limit 10 --budget 0.05
WOBBLE_AI_MOCK=1 bun run eval:packs                  # dry run, no key, no network
```

Flags: `--models`, `--themes`, `--limit`, `--budget`, `--concurrency` (default 4), `--out results.json`.
