# anywrite Progress

## Session — 2026-07-23 — v0.2.3 (mandatory completion evidence before Review)

User flagged a concrete failure pattern from real usage: 7 of the last 10 tasks filed through
anywrite bounced from "Review" back to "Revision" after human check — a 70% error rate. Root
cause traced to the skill itself: the status-lifecycle section already forced "Review" (never
"Done") for the agent's own completion claim, but nothing gated that transition on any actual
proof of the work — an agent could flip a task to "Review" having verified nothing, and the
human had to re-derive whether it was really done from scratch every time. Added a new
requirement in the "Move a task through its status lifecycle" section of SKILL.md: before the
`objects update ... --status "Review"` call, the agent must attach evidence matched to the task
type — a screenshot via `/playwright-cli` (`screenshot --filename=...` against the live running
page) for new/changed pages or UI, real captured test-run output (plus a mermaidJS diagram when
control flow changed) for new/changed logic, or whatever's genuinely checkable for tasks with
neither. If no evidence can be produced yet, the task stays "In Progress" instead of moving to
"Review" bare. Evidence attaches through the same `files upload` + `attachments` property
mechanism the create-task recipe already uses for input screenshots — no new API surface, just a
gate on when the status write is allowed to happen. Text evidence (test output) with no natural
image form gets saved to a file and uploaded rather than pasted as a claimed summary in the
body, so the human has something they can actually open. Docs-only change: SKILL.md, no `src/`
changes; `package.json` bumped 0.2.2 → 0.2.3 to match.

---

## Session — 2026-07-12 (cont) — v0.2.2 (skill upgraded with obsidian-skills patterns)

Analyzed kepano's obsidian-skills repo (github.com/kepano/obsidian-skills, the Obsidian CEO's
five agent skills) against our SKILL.md and ported six authoring patterns the user approved:
workflow recipes, a documented filter DSL, `references/` progressive disclosure, body-markdown
behavior docs, complete worked examples, and wrong→correct gotcha pairs. Extracted the full
search filter schema from `spec/openapi-2025-11-08.yaml` (SearchRequest → FilterExpression
recursive and/or tree → 12 typed FilterItem oneOf shapes → 13 FilterCondition values → 4-key
SortProperty enum) and live-verified every shape against the running desktop with six throwaway
AWTEST task objects (text contains, checkbox eq, select eq by tag id, date gt date-only, nested
or-inside-and, sort, empty condition — all archived after). Two new gotchas discovered live:
(1) unknown flags are silently ignored — `--done true` on create succeeds but sets nothing;
the only property flags are `--status` and format-aware `--property key=value` (cli.ts
`applyObjectPropertyFlags`); (2) select filters require the tag ID — a tag name 400s with
"failed to build expression filters", the one place the CLI's name resolution doesn't reach.
Also round-tripped a rich markdown document through create→get: everything survives
semantically but code-fence language tags are dropped, blank lines collapse, lines gain
trailing spaces, and table cells gain `<br>` — so bodies must never be verified by string
diff. New files: `references/FILTERS.md`, `references/MARKDOWN.md`, `references/EXAMPLES.md`;
SKILL.md rewritten (workflows section, `--property` in global flags, gotchas grown 11→15 with
command pairs, pointers to references). Wired `~/.claude/skills/anywrite/references` as a
symlink beside the existing SKILL.md one. No `src/` changes — docs/skill only.

---

## Session — 2026-07-12 (cont) — v0.2.1 (skill renamed to anywrite)

User preference: the Claude Code skill should be triggered/named `anywrite` (the CLI's own
name) rather than `anytype` (the app it talks to) — asked directly after the v0.2.0 release
shipped, having weighed the tradeoff (domain-first vs. tool-first naming) in the prior turn.
Moved `~/.claude/skills/anytype/` to `~/.claude/skills/anywrite/` (same symlink, now pointing
at this repo's `SKILL.md` from the new directory), updated the frontmatter `name:` field, and
reworded the trigger description to lead with "anywrite" while keeping every Anytype-domain
trigger phrase intact (mentioning notes/tasks/PKM/properties/tags/etc. in Anytype still fires
it). Updated `README.md`'s wiring instructions and `docs/changelog.md`'s v0.1.0 entry to the
new path; left `docs/plan/2026-07-11-anywrite-cli/*.md` untouched since those are frozen
historical planning artifacts, not live documentation. Added a v0.2.1 changelog entry telling
anyone who wired the skill under the old path how to move it. No `src/` changes — this is a
skill/doc-only release, version bumped for the path change alone (0.2.0 → 0.2.1).

Verified: `bun run check` clean, `bun test` 84/84 (unchanged, no source touched), skill list
picked up the rename immediately in the same session (confirmed via the live system-reminder
showing `anywrite` instead of `anytype` right after the directory move).

---

## Session — 2026-07-12 — v0.2.0 (verify command)

Added `anywrite verify <space> <object_id...> [--property key=value ...] [--pretty]`, a
composite client-side check that re-fetches each object id and confirms it exists plus that
given properties match expected values. Root cause for building this: a live session used a
hand-rolled throwaway Python script to double-check that a batch of `objects create` calls
landed correctly (8 tasks pushed into Anytype after moving off the built-in task tracker), and
that script had an index-arithmetic bug in its own JSON-stream parser that threw after
successfully printing all 8 results — the *creates* were fine, the ad-hoc verification tooling
wasn't. `verify` replaces that class of throwaway script with a real, tested command.

Shape follows the existing composite-command precedent (`auth`): not a single Anytype API
endpoint, so it's special-cased in `cli.ts`'s `run()` dispatch rather than added to the
`registry.ts` endpoint table, which stays reserved for real HTTP operations only. New module
`src/verify.ts` holds the pure logic — `readPropertyValue()` (unwraps `select`/`multi_select`/
scalar property shapes off an object's `properties` array), `verifyObject()` (one GET + property
comparison, never throws — a fetch failure becomes `found: false` with `error` set so a batch
always finishes), and `verifyObjects()` (sequential batch runner). `cli.ts` gained
`runVerifyCommand()`/`formatVerifyHelp()` and a `first === 'verify'` branch alongside the
existing `auth` branch; `formatTopHelp()` now lists both composite commands.

Added 11 unit tests in `src/__tests__/verify.test.ts` (property-shape unwrapping, pass/fail/
missing-id cases, never-throws-on-fetch-failure, batch ordering) plus one `cli.test.ts` check
that `formatTopHelp()` lists `verify`. Live-verified against the real running Anytype desktop
(space "Antheurus") both ad hoc — create a throwaway task, verify a matching status (pass:true,
exit 0), verify a deliberately wrong expected status (pass:false, exit 1, `actual` shows the
real value), verify a nonexistent id (found:false, exit 1) — and folded three matching steps
into `scripts/smoke.sh`'s permanent object-lifecycle section (between "set status" and "get
shows status"), so regression coverage for `verify` now runs on every `just smoke`.

Verified this session: `bun test` 84/84 pass (up from 69), `tsc --noEmit` clean, `biome check`
clean after one auto-format pass, `bun run build` produces a working `dist/anywrite`, and
`scripts/smoke.sh` 36/36 live steps green (up from 33) against the real Anytype desktop.
Updated `SKILL.md` (new "Verify" section + quick-reference line) and `README.md` (usage
example) so the command is discoverable without reading source. Version bumped 0.1.0 → 0.2.0
(new capability, not a fix). No breaking changes — every existing resource/action is untouched.

---

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
(`scripts/smoke.sh`/`just smoke`) against the user's real running Anytype desktop — every step
passed, twice, with LIFO cleanup so a mid-run failure still archives everything it created.

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
