---
feature: anywrite-cli
created: 2026-07-11
updated: 2026-07-11T16:00Z
status: ready-for-plan
---

# Research — anywrite (Anytype full-coverage CLI + Claude Code skill)

## Definition of done

> "gua butuh tipe skill yang punya scripts/ yang bisa fully-fledged... gua butuh porting keseluruhan yang ada di mcp" — user, 2026-07-11

A Bun+TypeScript CLI (`anywrite <resource> <action> [flags]`) covering **all 52 endpoints** of the Anytype local API version `2025-11-08`, compiled to a single binary, wired as a Claude Code skill at `~/.claude/skills/anytype/`, pushed to public GitHub `Antheurus/anywrite`, and **live-verified** against the user's running Anytype desktop (space "Antheurus", `http://localhost:31009`).

## Verbatim captures

Source of truth: `spec/openapi-2025-11-08.yaml` (vendored into this repo from
`anyproto/anytype-api` — 6508 lines, 119 component schemas, 52 endpoints).
All shapes below verified against the spec file by the context-gatherer (line refs included)
and/or live against the running desktop this session.

### Endpoint inventory (52 — exact per-tag counts)

| Tag | Count | Endpoints |
|---|---|---|
| Auth | 2 | POST /v1/auth/challenges, POST /v1/auth/api_keys |
| Chat | 13 | list/create chats; get/add/edit/delete messages; search messages; SSE stream; read messages/reactions/read_all; toggle reaction; get message |
| Files | 3 | POST upload (multipart), GET download (binary), DELETE |
| Lists | 4 | get views, get objects-in-view, add objects (collection only), remove object |
| Members | 2 | list, get — **read-only, no write endpoints exist** |
| Objects | 5 | list, get, create, PATCH update, DELETE (= archive) |
| Properties | 5 | list, get, create, PATCH, DELETE |
| Search | 2 | POST /v1/search (global), POST /v1/spaces/{id}/search |
| Spaces | 4 | list, get, create, PATCH |
| Tags | 5 | list, get, create, PATCH, DELETE (nested under /properties/{id}/tags) |
| Templates | 2 | list, get — **read-only** |
| Types | 5 | list, get, create, PATCH, DELETE |

Note: `search_chat_messages` is a GET under **Chat**, not Search.

### Auth flow (spec lines 209–240)

```
POST /v1/auth/challenges   body {"app_name": "anywrite"}                    → 201 {"challenge_id": "67647f5e..."}
POST /v1/auth/api_keys     body {"challenge_id": "...", "code": "1234"}     → 201 {"api_key": "zhSG/zQ..."}
```
The 4-digit code pops up in the Anytype desktop app. NOTE: spec marks none of these
fields `required:` — client must validate presence itself.

### Headers — every endpoint

```
Authorization: Bearer <api_key>
Anytype-Version: 2025-11-08        (required: true on every operation)
```

Live-verified: existing app key in `~/.anytype-cli/config.yaml` (`app_key:` + `base_url: http://localhost:31009`, YAML, 2 keys) works against 2025-11-08 endpoints (chats → 200).

### Pagination — TWO models

Standard (every list endpoint except chat messages): query `offset` (default 0), `limit` (default 100, **max 1000**); response:
```json
{ "data": [...], "pagination": {"has_more": true, "limit": 100, "offset": 0, "total": 1000} }
```

Chat messages (`get_chat_messages`) — **cursor-based**: query `before_order_id`, `after_order_id`, `limit` (default **50**, min 1, max 1000). An offset paginator will silently mis-page chat.

### Error envelope (per-status schemas, one wire shape)

```json
{"object": "error", "status": 400, "code": "bad_request", "message": "Bad request"}
```
Distinct schemas: 400 ValidationError, 401 Unauthorized, 403 Forbidden, 404 NotFound,
**410 Gone** (already-deleted), **429 RateLimit** (delete/mutation paths), 500 Server.

### Object body — THREE-WAY field asymmetry (highest-value gotcha)

| Operation | Field name | Spec line |
|---|---|---|
| CREATE input | `body` | CreateObjectRequest, line 253 |
| UPDATE input | `markdown` | UpdateObjectRequest, line 2389 |
| GET output | `markdown` | ObjectWithBody, line 1767 |

A read-then-rewrite round-trip cannot echo the field name.

### CreateObjectRequest (required: `type_key`)

```json
{"type_key": "page", "name": "...", "body": "md...", "icon": {...}, "template_id": "...", "properties": [PropertyLinkWithValue...]}
```

**Live-verified gotcha:** icon must be a valid Icon object or **absent entirely** — an empty
string 400s (`invalid icon format: ""`, hit via epheo CLI this session). Omit the key when unset.

### PropertyLinkWithValue — oneOf 11 shapes (spec line 1973)

Each `{"key": "<property_key>", "<format>": <value>}` where format ∈ text, number, select,
multi_select, date, files, checkbox, url, email, phone, objects. Select example (accepts tag **key or ID**, line 2074):
```json
{"key": "status", "select": "bafyreien3sgyzjpjw44e5x7v73vk5ncg2ls76n67zq6x4zg7td4eu2dj5y"}
```
Live-verified: `PATCH /v1/spaces/{sid}/objects/{oid}` with the body above → 200, status became "To Do" in the app.

### File upload / download

```
POST /v1/spaces/{space_id}/files      multipart/form-data, single field "file" (binary)
  → 200 {"object_id": "...", "name": "...", "extension": "png", "media": "image/png", "size_in_bytes": 123}
GET  /v1/spaces/{space_id}/files/{file_id}   → raw binary
DELETE same path
```

### Search (spec line 2030)

```json
{"query": "text", "types": ["page","task"], "filters": FilterExpression, "sort": SortOptions}
```
**Gotcha (verbatim spec lines 2042–2045):** file-layout types (file, image, video, audio)
are excluded from search by default — must be listed explicitly in `types`.

### FilterExpression — recursive tree (spec lines 653–696)

```
FilterExpression = { operator: "and"|"or", conditions: [FilterItem...], filters: [FilterExpression...] }
```
Spec's own example:
```json
{ "operator": "or",
  "filters": [
    { "operator": "and", "conditions": [
        {"property_key": "status",   "condition": "eq", "select": "done_tag_id"},
        {"property_key": "priority", "condition": "eq", "select": "high_tag_id"} ] },
    { "operator": "and", "conditions": [
        {"property_key": "created_date", "condition": "gt", "date": "2024-01-01"} ] } ] }
```
`FilterItem` = 12-shape oneOf (11 formats + `empty`). `FilterCondition` enum (line 607):
`eq, ne, gt, gte, lt, lte, contains, ncontains, in, nin, all, empty, nempty`.

### Lists (4 endpoints)

- `GET /v1/spaces/{sid}/lists/{list_id}/views` → PaginatedResponse-View
- `GET /v1/spaces/{sid}/lists/{list_id}/views/{view_id}/objects` — offset+limit **plus dynamic
  property filters as query params** (`?done=false`, `?created_date[gte]=2024-01-01`, `?tags[in]=a,b`)
- `POST .../lists/{list_id}/objects` — **collections only** (sets are read-only queries);
  body is **wrapped**: `{"objects": ["id1","id2"]}` — the endpoint prose says "JSON array" but
  the schema (line 33) wraps it; bare array 400s.
- `DELETE .../lists/{list_id}/objects/{object_id}`

**Live-probed this session:** empty `view_id` (URL `/views//objects`) → **200 with all
objects in the list** — view_id is effectively optional despite `required: true` in the path spec.

### Chat

`AddChatMessageRequest` (required: `text`): `{"text","style","marks":[],"attachments":[],"reply_to_message_id"}`.
SSE stream `GET .../chats/{chat_id}/messages/stream`: events `message_added`, `message_updated`,
`message_deleted`, `reactions_updated`; on connect sends last N messages; optional header
`Anytype-Heartbeat-Seconds` (1–60, default 30).

### Other create requirements

- CreatePropertyRequest: required `format` + `name` (optional `key` snake_case, `tags[]`)
- CreateTagRequest: required `color` + `name`
- CreateTypeRequest: required `layout` + `name` + `plural_name`
- DELETE object = **archive** (soft delete), returns the archived ObjectResponse, has 410 + 429 paths

## Code intelligence

- **Reference skill pattern**: `~/.claude/skills/sheets-cli/` — src/ (cli.ts, auth.ts, output.ts,
  types.ts, `__tests__/`), root SKILL.md (frontmatter name+description), package.json
  (`type: module`, `bin`), biome.jsonc, tsconfig.json, bun.lock. Build:
  `bun build ./src/cli.ts --compile --outfile ./dist/sheets-cli`. **dist/ is gitignored**
  (~83MB binary, never committed); built locally via just/setup.
- **Existing auth**: `~/.anytype-cli/config.yaml` — `app_key` (44 chars) + `base_url`. Works live.
- **Bun 1.3.6** at `/Users/macbook/.bun/bin/bun`; `gh` authenticated as Antheurus.
- **Live test space**: "Antheurus" `bafyreigxank2luzvggw7jsnkybpaoipjm3l3g2b3nt2jpm66liype3sd24.kohjowu9reqj`.
  Known fixtures from this session: task `bafyreiatxhy25...` ("Test task dengan gambar"),
  image object `bafyreids6cx2y...`, set "Task tracker" `bafyreihk7746s...` with 5 views
  (grid "All" `6182a74fcae0300221f9f207`, kanban "Status", ...), collection "Journal" `bafyreibh2bums...`.
- Desktop's image gateway (`http://127.0.0.1:47800/image/<id>`) appears inside returned markdown — separate port, display-only.

## Risks & unknowns

- Registry must encode per-endpoint quirks as **data flags**: multipart, binary response, SSE,
  wrapped-array body, cursor-vs-offset pagination, body/markdown field name, collection-only guard.
  Quirks leaking into per-endpoint code is the architecture's failure mode.
- `bun build --compile` + interactive stdin (auth code prompt): standard capability but unproven here —
  mitigate by accepting `--code` flag as primary path, stdin prompt as fallback.
- Chat SSE under compiled binary: scope as read-only stream-to-stdout (`--follow`), not interactive.
- Dynamic list-filter query encoding (`?tags[in]=a,b`) described in prose, not schema-typed —
  expose as raw `--filter key[cond]=value` passthrough in v1, no typed flag surface.

## Open questions

- ~~[RESOLVED live] empty view_id → 200 all objects~~
- None blocking.

## Platform ceilings (documented, not buildable — API has no such endpoints)

Block-level editing (body = whole-markdown replace only), member invite/role management,
template create/update/delete, space deletion.

## Reference artifacts

- Vendored spec: `spec/openapi-2025-11-08.yaml` (gold copy for codegen + registry)
- Upstream: https://github.com/anyproto/anytype-api · https://developers.anytype.io/docs/reference/2025-11-08
- Official MCP (what we're porting the coverage of): https://github.com/anyproto/anytype-mcp
