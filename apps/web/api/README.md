# api

Vercel functions, served locally at `/api/*` by `dev/apiPlugin.ts` during `bun run dev`.

- Use the Web handler signature: `export async function GET(request: Request) { return Response.json(...) }`.
- Routes follow the file name: `packs/[id].ts` → `/api/packs/:id`. Read dynamic segments with
  `new URL(request.url).searchParams.get('id')`.
- Files and folders starting with `_` are not routes (`_lib/` holds shared server code).

| Path                                                                                                            | Owner |
| --------------------------------------------------------------------------------------------------------------- | ----- |
| `health.ts`                                                                                                     | #2    |
| `packs/generate.ts`, `_lib/llm/`                                                                                | #22   |
| `packs/index.ts`, `packs/[id].ts`, `packs/batch.ts`, `packs/[id]/report.ts`, `_lib/store/`, `_lib/ratelimit.ts` | #23   |
| `telemetry.ts`, `_lib/usage.ts`                                                                                 | #31   |
