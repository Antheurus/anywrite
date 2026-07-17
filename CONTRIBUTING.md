# Contributing

Thanks for looking at `anywrite`. Issues and PRs are welcome.

## Setup

```bash
git clone https://github.com/Antheurus/anywrite.git
cd anywrite
just install
```

Requires [Bun](https://bun.sh) and [`just`](https://github.com/casey/just).

## Before opening a PR

```bash
just check   # typecheck + lint (tsc --noEmit, biome check)
just test    # bun test — unit tests, mocked network, no Anytype desktop required
just build   # compiles dist/anywrite
```

All three run in CI on every push and PR (`.github/workflows/ci.yml`) and must pass.

`just smoke` runs `scripts/smoke.sh`, a live end-to-end matrix against a real running Anytype
desktop app. It isn't part of CI (there's no Anytype desktop to drive in a GitHub runner), but
if your change touches request-shaping, pagination, or any endpoint behavior, run it locally
against your own Anytype instance before submitting — it's the closest thing to a regression
suite this project has for live-API behavior.

It needs four env vars pointing at objects in your own space (`SPACE`, `TASK_TRACKER_SET`,
`TASK_TRACKER_ALL_VIEW`, `JOURNAL_COLLECTION` — the script explains each when unset). These
are account-specific ids, so there's no shared default: create a `set`/Query object and a
`collection` object in your own space (via the app or `anywrite objects create`), then export
their ids before running `just smoke`.

## Where things live

- `src/registry.ts` — every endpoint as data (method, path, params, quirks). Adding an endpoint
  the API grows to support is a data change here, not new code.
- `src/client.ts` — the one HTTP wrapper every endpoint routes through.
- `src/cli.ts` — argv parsing and resource/action dispatch, generated from the registry.
- `src/resolve.ts` — name/key → id resolution (space, type, property, tag).
- `src/verify.ts` — composite client-side checks (not single endpoints) live here, same pattern
  as `auth.ts`.
- `src/__tests__/` — one test file per module, `bun test` runner, mocked `fetch` (no network).

## Style

No new abstractions or refactors bundled into a feature/fix PR — keep changes scoped to what
they're fixing. Match the existing patterns (data-driven registry, one HTTP wrapper, one test
file per module) rather than introducing a parallel approach for the same problem. `biome check`
enforces formatting — run `just check` before pushing, or `bun run lint:fix` to auto-fix.

## Docs

If a change is user-facing, update `docs/changelog.md`. Either way, add an entry to
`docs/progress.md` describing what changed and why — it's the project's own history log, read
by whoever (human or agent) picks up the next session.
