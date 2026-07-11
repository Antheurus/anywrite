# anywrite Progress

## Session — 2026-07-11 — v0.1.0 (initial build)

Built `anywrite` from scratch across six phases, orchestrated: a Bun/TypeScript CLI, compiled
to a single dependency-free binary, covering all 52 endpoints of the Anytype local API spec
2025-11-08. Phase 1 laid the scaffold — `package.json`/`tsconfig.json`/`biome.jsonc`/
`justfile`, generated `src/types/api.d.ts` via `openapi-typescript` against the vendored
`spec/openapi-2025-11-08.yaml`, and a config loader with three-way precedence (env var →
`~/.anywrite/config.json` → `~/.anytype-cli/config.yaml` fallback, so an existing key from the
community `anytype-cli` tool keeps working without re-auth). One deviation surfaced here:
`typescript` had to be pinned to `^5.9.3` rather than latest, because `bunx tsc` resolves to
the new 7.x Go-native rewrite by default and `openapi-typescript@7.13.0` imports classic
compiler-API symbols (`ts.factory.createKeywordTypeNode`) that don't exist on 7.x — codegen
only works against 5.x.

Phase 2 built `src/client.ts`, the single HTTP wrapper every endpoint routes through: Bearer
auth + the `Anytype-Version` header, per-status error mapping (400/401/403/404/410/429/500,
each carrying the API's error envelope verbatim rather than a synthesized message), multipart
upload, binary download, and a hand-rolled SSE reader off a plain `fetch` body stream (no
EventSource dependency, since the concern going in was whether SSE would survive
`bun build --compile` — it does). Two paginators were added here, offset-based and
cursor-based, both dependency-injected so later phases supply the fetch closure. Phase 3
encoded every one of the 52 operations as data in `src/registry.ts` — method, path template,
params, and per-endpoint quirks (`bodyField: 'body'|'markdown'` for the object create/update
asymmetry, `multipart`/`binary`/`sse`/`wrappedArray` quirk flags, `pagination: offset|cursor`,
`viewIdOptional` for lists) — with a test that parses the vendored OpenAPI spec at runtime and
asserts full bidirectional (method, path) coverage: 52/52, zero missing, zero extra.

Phase 4 wrote the actual dispatcher (`src/cli.ts`) and name→id resolver (`src/resolve.ts`):
argv parsing generates its flag set per resource/action directly from the registry, so every
endpoint gets typed flags for free with zero endpoint-specific branches in the parser itself.
The one hand-built exception is object property values — `select`/`multi_select`/`icon`
shapes are nested oneOf structures the flat registry doesn't model, so `buildPropertyEntry()`
in `cli.ts` resolves a property's format and shapes the value accordingly, with `--status` as
a shortcut for the common "status" select property and `--property key=value` as the general
form. Phase 5 compiled the binary and ran a 33-step live smoke test
(`scripts/smoke.sh`/`just smoke`) against the user's real running Anytype desktop (space
"Antheurus") — every step passed, twice, with LIFO cleanup so a mid-run failure still archives
everything it created.

**Live-API discoveries worth keeping in mind for future changes:** delete is a soft archive
everywhere and is idempotent — a second delete call on the same object/property/tag/type/file
returns 200 with `archived: true` again, never a 410; the vendored spec only declares 410 on
GET operations for a permanently-purged resource, which isn't reachable through any exposed
DELETE call. File upload dedupes by content hash — re-uploading identical bytes returns the
*same* object id as a pre-existing object, which nearly caused the smoke script to delete a
real pre-existing user file (`beresin kk`) before the script was changed to generate a
fresh, content-unique PNG at runtime instead. The `tags.list` endpoint's offset/limit query
params are undocumented in the vendored OpenAPI spec but the live API honors them anyway — the
registry entry includes them regardless of the spec gap, live-verified via pagination envelope
behavior. Unknown-id GETs return HTTP 500 from the live server, not 404 — the client's error
mapper and CLI exit path handle this correctly (exit 1, verbatim envelope) since the mapping is
by actual status code, not an assumed one.

**Audit/fix history during the build:** three registry parameter gaps were caught and fixed
before the spec-parity test would pass (missing query params on file-related operations, later
verified live against `tags.list`'s pagination). Two CLI bugs surfaced during Phase 4's live
verification and were fixed in the same phase: the binary/multipart flag wasn't threaded
through the dispatcher correctly on first pass, and POST/PATCH requests with an empty body
object were being sent as truly empty (no `{}`), which the API rejected on some endpoints —
both fixed by always sending a body object on POST/PATCH even when no fields were set.

Verified this session: `bun test` 69/69 pass, `bunx tsc --noEmit` clean, `bunx biome check`
clean, `just build` produces a working `dist/anywrite` (54.9MB arm64 Mach-O), and
`scripts/smoke.sh`/`just smoke` both exit 0 with 33/33 live steps green against the real
Anytype desktop, reproduced on a second run. Phase 6 (this entry) adds `SKILL.md`, `README.md`,
this progress log, `docs/changelog.md`, a `LICENSE` (MIT), the `repository` field in
`package.json`, and wires `~/.claude/skills/anytype/SKILL.md` as a symlink into the repo, then
publishes the repo to GitHub as `Antheurus/anywrite` (public). No `src/` files were touched
this phase.

---
