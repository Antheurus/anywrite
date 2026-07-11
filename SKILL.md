---
name: anytype
description: Use this skill whenever the user mentions Anytype, asks to create/update/search/organize notes, tasks, or PKM objects in Anytype, or wants to upload files, manage properties/tags/types, or chat inside an Anytype space. Also trigger on "anywrite" by name. Covers all 52 endpoints of the Anytype local API (spaces, objects, properties, tags, types, templates, lists, chat, files, members, search, auth) via a single compiled CLI binary — no MCP server, no per-tool context tax.
---

# anytype (anywrite CLI)

`anywrite` is a compiled Bun/TypeScript CLI that talks to the Anytype desktop app's local
HTTP API (`http://localhost:31009` by default). It covers all 52 endpoints of the Anytype
local API spec 2025-11-08. Anytype desktop must be running for any command to work.

**Binary:** `/Users/macbook/Documents/PROJECT_MISPAQUL_ATTORIQ/anywrite/dist/anywrite`

If the binary is missing, build it first:

```bash
cd /Users/macbook/Documents/PROJECT_MISPAQUL_ATTORIQ/anywrite && just build
```

Call the binary by its absolute path — it is not on `PATH`. Every example below uses the
bare `anywrite` name for brevity; substitute the absolute path when invoking.

## Auth

Config precedence: `ANYTYPE_API_KEY` env var → `~/.anywrite/config.json` → `~/.anytype-cli/config.yaml`
(read-only fallback to the existing `anytype-cli` tool's key, if present) → no key (public
auth endpoints only).

```bash
anywrite auth --status          # shows configured yes/no + which source is active, never the key itself
anywrite auth                   # starts the challenge flow: a 4-digit code pops up in the Anytype desktop app
anywrite auth --code 1234       # completes the exchange non-interactively, writes ~/.anywrite/config.json
```

Never print or log the API key. `auth --status` only ever reports presence and source.

## Command shape

```
anywrite <resource> <action> [positionals] [--flag value]
```

Positionals for `space`/`type`/`property` accept either a **name or an id** — the CLI resolves
names to ids automatically (a `bafy...`-prefixed value passes through unresolved).

```bash
anywrite --help                 # lists all resources
anywrite objects --help         # lists actions + generated flags for one resource
```

Global flags (apply across resources where relevant):

| Flag | Effect |
|---|---|
| `--all` | paginate the full result set (offset or cursor, per endpoint) |
| `--pretty` | render a table / key-value lines instead of raw JSON |
| `--output <path>` | write a binary response (files download) to this path |
| `--follow` | consume an SSE stream (chat stream) and print one JSON line per event |
| `--json '<raw>'` | merge a raw JSON object into the request body (escape hatch for nested/oneOf shapes like `filters`) |
| `--filter k[cond]=value` | raw query passthrough, repeatable, e.g. `--filter "done=false"` |
| `--file <path>` | file to upload (files upload) |
| `--heartbeat <n>` | `Anytype-Heartbeat-Seconds` for an SSE stream (1-60) |

## Quick reference — 12 resources

```bash
# spaces
anywrite spaces list
anywrite spaces get <space>
anywrite spaces create --name "My Space"
anywrite spaces update <space> --name "Renamed"

# objects
anywrite objects list <space> --all
anywrite objects get <space> <object_id>
anywrite objects create <space> --type task --name "Buy milk" --body "notes here"
anywrite objects update <space> <object_id> --name "New title" --markdown "..." --status "Done"
anywrite objects delete <space> <object_id>          # archives (soft delete)

# properties
anywrite properties list <space>
anywrite properties create <space> --format select --name Priority
anywrite properties update <space> <property_id> --name "Priority Level"
anywrite properties delete <space> <property_id>

# tags (on a select/multi_select property)
anywrite tags list <space> <property_id>
anywrite tags create <space> <property_id> --color red --name Urgent
anywrite tags update <space> <property_id> <tag_id> --name "Very Urgent"
anywrite tags delete <space> <property_id> <tag_id>

# types
anywrite types list <space>
anywrite types create <space> --layout basic --name Task --plural_name Tasks
anywrite types update <space> <type_id> --name "Task Item"
anywrite types delete <space> <type_id>

# templates (read-only — see Platform ceilings)
anywrite templates list <space> <type_id>
anywrite templates get <space> <type_id> <template_id>

# lists (sets and collections; add/remove only work on collections)
anywrite lists views <space> <list_id>
anywrite lists objects <space> <list_id> <view_id>    # view_id can be omitted -> all objects
anywrite lists add <space> <list_id> --json '{"objects":["obj_id_1","obj_id_2"]}'
anywrite lists remove <space> <list_id> <object_id>

# files
anywrite files upload <space> --file /path/to/image.png
anywrite files download <space> <file_id> --output /path/to/save.png
anywrite files delete <space> <file_id>               # add --skip_bin for permanent delete

# members (read-only — see Platform ceilings)
anywrite members list <space>
anywrite members get <space> <member_id>

# search
anywrite search global --query "task" --types task
anywrite search space <space> --query "task" --json '{"types":["task"]}'

# chat
anywrite chat list <space>
anywrite chat create <space> --name "Team chat"
anywrite chat send <space> <chat_id> --text "hello"
anywrite chat messages <space> <chat_id> --all         # cursor pagination
anywrite chat edit <space> <chat_id> <message_id> --text "edited"
anywrite chat delete-message <space> <chat_id> <message_id>
anywrite chat stream <space> <chat_id> --follow        # SSE, one JSON line per event

# auth
anywrite auth --status
anywrite auth --code 1234
```

## Gotchas (all live-verified against the running Anytype desktop)

1. **Body field is three different names depending on the call.** `objects create` sends
   `--body`, `objects update` sends `--markdown`, `objects get` returns the content under
   `markdown` in the response. The CLI already routes the right flag to the right field —
   don't pass `--markdown` on create or `--body` on update, they're silently ignored.
2. **Icon: omit it, don't empty it.** Pass `--icon "🔥"` to set an emoji icon; leave the flag
   off entirely to skip it. An empty string (`--icon ""`) gets rejected with a 400 by the API.
   The CLI only sends the icon field when the flag is actually present.
3. **Select/multi-select values accept a tag's name, key, or id.** `--status "Done"` and
   `--property priority=key_abc123` both work — the CLI resolves a plain name against the
   property's existing tags first, and falls back to passing the raw value through if no
   match is found (so an id you already have always works too).
4. **Search excludes file-layout objects by default.** `file`/`image`/`video`/`audio` type
   objects are left out of search results unless you explicitly ask for them via
   `--types file` (or the matching layout type).
5. **`lists add` / `lists remove` only work on collections, not sets.** Sets are
   query-driven views (their membership comes from a filter, not a stored list) and are
   read-only for membership — mutating a set's object list has no endpoint. Collections are
   the only list type you can add/remove objects from.
6. **Chat messages paginate by cursor, everything else by offset.** `chat messages --all`
   walks `before_order_id`/`after_order_id`; every other paginated resource (`objects list`,
   `properties list`, `search`, etc.) walks `offset`/`limit`. `--all` handles both
   transparently — you never need to know which one a given resource uses.
7. **`lists objects` with the view_id omitted returns every object in the list** (not an
   error), even though the API spec marks `view_id` as a required path segment.
8. **Delete = soft archive everywhere, and it's idempotent.** `objects delete`,
   `properties delete`, `tags delete`, `types delete`, `files delete` all archive rather than
   purge — calling delete twice on the same id returns 200 with `archived: true` both times,
   never a 410. A 410 only happens on `GET` of a resource that's been permanently purged (not
   reachable through any DELETE call in this API) or a deleted space.
9. **File upload dedupes by content hash.** Uploading bytes identical to an existing file
   returns the *same* `object_id` as the pre-existing object — deleting "your" upload can
   archive someone else's real file if the content matches. Upload something content-unique
   when the goal is a disposable test file.
10. **Unknown ids can return HTTP 500, not 404.** `objects get <space> <bad-id>` (and similar
    gets on a non-existent id) comes back as a 500 from the live server. The CLI still exits 1
    and prints the API's error envelope verbatim to stderr either way.
11. **Platform ceilings — no endpoint exists for these, so the CLI can't do them:**
    block-level editing (an object's body is whole-markdown replace only, no per-block ops),
    member invite/role management (members are list/get only), template create/update/delete
    (templates are list/get only), and space deletion.

## Errors

Any 4xx/5xx from the API prints the response body verbatim to stderr and exits 1. A usage
error (unknown resource/action, missing required flag, a name that doesn't resolve to an id)
exits 2 with a short message — no API call is made.
