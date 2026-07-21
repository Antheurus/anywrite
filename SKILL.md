---
name: anywrite
description: Use this skill whenever the user mentions "anywrite" by name, or mentions Anytype, asks to create/update/search/organize notes, tasks, or PKM objects in Anytype, or wants to upload files, manage properties/tags/types, or chat inside an Anytype space. Covers all 52 endpoints of the Anytype local API (spaces, objects, properties, tags, types, templates, lists, chat, files, members, search, auth) via a single compiled CLI binary — no MCP server, no per-tool context tax.
---

# anytype (anywrite CLI)

`anywrite` is a compiled Bun/TypeScript CLI that talks to the Anytype desktop app's local
HTTP API (`http://localhost:31009` by default). It covers all 52 endpoints of the Anytype
local API spec 2025-11-08. Anytype desktop must be running for any command to work.

It ALSO covers one thing the public API can't do at all: embedding an image as a real inline
block in an object's body (`embed-image`). That goes through a completely different transport —
Anytype's internal middleware gRPC service, not the REST API — see "Embedding an image inline"
under Workflows and the Auth section below before using it.

**Binary:** `<repo>/dist/anywrite`, where `<repo>` is wherever this repo was cloned. Find it
with `git rev-parse --show-toplevel` if unsure, or check whether `anywrite` is already on
`PATH`/aliased.

If the binary is missing, build it first:

```bash
cd <repo> && just build
```

Call the binary by its absolute path unless it's on `PATH`. Every example below uses the
bare `anywrite` name for brevity; substitute the actual path when invoking if needed.

**Deep references (read on demand, not upfront):**

- `references/SPACES.md` (gitignored, machine-local — not shipped with the skill) — an
  OPTIONAL personal cache of your own Anytype space's shape: its id, key types, the `task`
  type's properties, your `status`/`tag` options with their ids, and any set like a "Task
  tracker" you use. Maintaining one avoids re-running `spaces list` / `types list` /
  `properties list` / `tags list` every session. If this file doesn't exist yet for your
  space, discover it once via those commands and consider writing your own copy — it's
  account-specific, so it's never committed to this repo and there's no template shipped
  with real values (only your own).
- `references/FILTERS.md` — the full search filter DSL (FilterExpression tree, all 12
  typed conditions, sort), live-verified examples, and the `--filter` vs `--json` split.
  Read this before writing any non-trivial `search` call.
- `references/MARKDOWN.md` — what markdown survives an object body round-trip and what
  gets mangled, PLUS why images can never be embedded via markdown/HTML in the body no
  matter what syntax is tried. Read before verifying body content or doing get→edit→update
  cycles, or before reaching for `--body`/`--markdown` to try to embed an image (don't —
  use `embed-image` instead, see Workflows).
- `references/EXAMPLES.md` — complete worked sequences (project tracker from scratch,
  find-and-update by property, bulk import, file attach) with real response shapes.

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

### gRPC auth (needed once, only for `embed-image`)

`auth` above issues a key scoped to `JsonAPI` — explicitly denied from every block-level RPC
(confirmed live: calling one returns `PermissionDenied: ... not allowed for JsonAPI scope`).
`embed-image` needs a DIFFERENT, separately-scoped key (`Limited` — the same scope Anytype's
own WebClipper browser extension uses), obtained through its own one-time challenge flow:

```bash
anywrite grpc-auth                # same 4-digit-code popup as `auth`, but requests Limited scope
anywrite grpc-auth --code 1234    # non-interactive
```

Saves `limited_app_key` into `~/.anywrite/config.json` alongside (never overwriting) `api_key`
— `embed-image` reads it automatically. **The code expires fast** (observed: well under a
minute) — have the app open and ready to read the popup before running this.

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
| `--json '<raw>'` | merge a raw JSON object into the request body (needed for `filters`, `properties[]` beyond the flags below, `lists add`) |
| `--filter k[cond]=value` | raw URL **query-string** passthrough, repeatable — NOT the search filter body (see references/FILTERS.md) |
| `--property key=value` | set any object property, repeatable, format-aware (select/multi_select accept tag names) |
| `--file <path>` | file to upload (files upload) |
| `--heartbeat <n>` | `Anytype-Heartbeat-Seconds` for an SSE stream (1-60) |

## Workflows

The recipes that cover most sessions. Full transcripts with response shapes in
`references/EXAMPLES.md`.

**Create a task** (the default recipe — use this whenever the ask is "add this as a task" /
"track this" / "bikin task", not the more general recipe below). If a personal
`references/SPACES.md`-style cache exists for the target space (see above), read it first —
no need to run `spaces list` / `types list` / `properties list` / `tags list` to rediscover
things that don't change session to session. Status `"To Do"` and a project tag are the
default for every task, not optional extras; if the space has an auto-populated task
collection (a `set`/Query filtered on the `task` type, sometimes called something like "Task
tracker"), a new task lands there automatically — nothing needs to be added to it manually
(don't `lists add` against a `set`, that only works on collections, see Gotcha #8). Attaching
a screenshot is a routine part of this recipe too, not a rare extra — most real tasks come
from a screenshot, so step 5 covers it.

*Verify before you write it down.* A task written straight from what someone typed is only as
good as their memory of the bug/fact in that moment — worth writing, but worth more once
checked. Before filling in the task body, work out which of these three cases applies:

- **It's about a project you actually maintain** (the subject matches one of the known project
  tags in your `references/SPACES.md` cache — a real local codebase you can open). Go look:
  grep/read the relevant files, or use whatever code-intelligence tooling is available in the
  session, and confirm the claim before writing it down. A report like "the save button is
  missing" often turns out to be a specific root cause a few files deep (a missing flush, a
  wrong default, a debounce with no cleanup) — finding that first turns the task into something
  immediately actionable (file:line references, confirmed behavior) instead of a restated guess.
  If something you were told turns out not to match the code, say so and correct it in the task
  rather than writing down both the wrong and right version.
- **It's about something outside your own codebases but still a checkable fact** (a claim about
  an external tool, service, price, or behavior that a web search could confirm or refute). Do
  that search first and fold the verified answer into the task.
- **It's neither** — a personal reminder, an opinion, a preference, a to-do with nothing to
  verify against any source. Write it as given; there's nothing to check it against.

```bash
# 1. the project tag must already exist — create it first if this is a new project, tags
#    never auto-create on write (Gotcha #16):
anywrite tags create <space> tag --name "<project-name>" --color <unused-color>

# 2. create the task — type=task + status "To Do" + project tag, every time:
anywrite objects create <space> --type task \
  --name "<project-name>: <short title>" \
  --status "To Do" \
  --property tag=<project-name> \
  --body "<description, informed by whatever you verified above>"

# 3. optional extra tags (multi_select takes comma-separated names, each must already exist):
anywrite objects create <space> --type task \
  --name "<project-name>: <short title>" \
  --status "To Do" \
  --property tag=<project-name>,<extra-tag-1>,<extra-tag-2> \
  --body "<description>"

# 4. verify it landed
anywrite verify <space> <new_id> --property status="To Do" --property tag=<project-name> --pretty

# 5. attach every screenshot/image that came with the task — not optional, most real tasks
#    come from a screenshot and a task without its evidence attached is half-filed (this is the
#    ONLY working way to attach an image — do NOT try embedding `![alt](url)` in
#    --body/--markdown, it is silently stripped on save, see references/MARKDOWN.md):
anywrite files upload <space> --file /path/to/screenshot.png
# -> {"object_id": "<file_id>", ...}
anywrite objects update <space> <new_id> --json \
  '{"properties": [{"key": "attachments", "files": ["<file_id>"]}]}'
```

The attached image shows up in the Anytype app under the object's ⓘ info panel as a file
property — NOT inline in the note body, and not visible on the main page by default unless
`attachments` is set as a "featured" property on that type's template.

Attachment is the floor, not the ceiling — if inline visibility (a picture in the body itself,
not tucked in a property) matters more for this task, check whether `limited_app_key` is
already present in `~/.anywrite/config.json` (presence check only — never print or log the
value: `python3 -c "import json,os;p=os.path.expanduser('~/.anywrite/config.json');print(bool(json.load(open(p)).get('limited_app_key')) if os.path.exists(p) else False)"`).
If it's there, also run `embed-image` for the most relevant screenshot(s) — see "Embedding an
image inline" below. If it's not there yet, don't trigger `grpc-auth` as a side effect of
filing a task: it needs the user to read a popup and type a code within under a minute, which
is a human-only action, not something to fire off mid-workflow. Attach and move on; mention
once that inline embedding is available via a one-time `grpc-auth` if they want it later.

**Move a task through its status lifecycle** — the full cycle is `To Do` -> `In Progress` ->
`Review` -> `Revision` (only if the reviewer finds a problem) -> back to `In Progress` -> `Review`
-> `Done`. Move it the moment the user signals a state change, in whatever words they use ("gua
kerjain sekarang", "lagi dikerjain", "udah beres", "selesai", "done", "mark as done", "ada yang
kurang", "revisi", "balikin"). Starting work (fresh or resumed after a revision) sets
`"In Progress"`. Finishing the agent's own work sets `"Review"`, never `"Done"` — a review is
what stands between the agent's own claim of "finished" and a status that says the human already
checked it. If the user's review finds a problem, the task goes to `"Revision"`, not straight
back to `"In Progress"` — that status is the record that a review round happened and came back
with an issue, which `In Progress` alone wouldn't preserve. `"Done"` only ever gets set by the
user themselves, or by the agent when the user explicitly says so after reviewing (e.g. "oke set
jadi done") — never from the agent's own judgment that the work looks complete. If the board is
missing the `"Review"` or `"Revision"` status option for the relevant type, ask the user rather
than defaulting to `"Done"` or skipping the state.

Status options don't auto-create on write, same as tags (Gotcha #16) — before using `"Revision"`
for the first time in a space, confirm it exists and create it if not:

```bash
anywrite properties list <space> --pretty               # find the status property's id
anywrite tags list <space> status --pretty               # status options are tags on that property
anywrite tags create <space> status --name "Revision" --color <unused-color>  # if missing
```

If you don't already have the task's id from earlier in the session, resolve it by name instead
of guessing — and if more than one task plausibly matches, ask the user which one rather than
picking:

```bash
# resolve the id if you only have a name/description
anywrite search space <space> --query "<keyword from the task title>" --json '{"types":["task"]}'

# starting work
anywrite objects update <space> <task_id> --status "In Progress"
anywrite verify <space> <task_id> --property status="In Progress" --pretty

# finishing (agent's own work -> Review, not Done)
anywrite objects update <space> <task_id> --status "Review"
anywrite verify <space> <task_id> --property status="Review" --pretty

# user reviewed and found an issue -> Revision, not back to In Progress directly
anywrite objects update <space> <task_id> --status "Revision"
anywrite verify <space> <task_id> --property status="Revision" --pretty

# picking the fix back up -> In Progress, then Review again when done (loop repeats)
anywrite objects update <space> <task_id> --status "In Progress"

# user reviewed, approved, and explicitly asked the agent to close it out -> Done
# (never set this from the agent's own judgment)
anywrite objects update <space> <task_id> --status "Done"
anywrite verify <space> <task_id> --property status="Done" --pretty
```

`verify` after every status change is what confirms the write actually landed — the same
reasoning as the create recipe's step 4, not a one-off habit specific to creation.

**Embedding an image inline** (a real picture in the body text, not a property reference) —
the public REST API genuinely cannot do this (see `references/MARKDOWN.md`); it requires
`embed-image`, which talks to Anytype's internal middleware instead. One-time setup, then a
single command per image:

```bash
# once ever (or again if the key gets revoked) — see "gRPC auth" under Auth above:
anywrite grpc-auth

# every time after that:
anywrite embed-image <space> <object_id> --file /path/to/image.png
```

`embed-image` waits for the upload to actually finish before returning (`state: Done`) rather
than declaring success the instant the block is created — a source file that goes missing
before the async upload reads it leaves the block stuck at `state: Uploading` forever with no
error anywhere else, so this wait is what turns that into a clear, immediate failure instead
of a silent stuck block discovered later. Passing a file path that might not exist by the time
the upload runs (e.g. a rotating temp/cache file) is the one way this still fails — pass a
path to a file that will still exist a few seconds from now.

**Create structured content** (general-purpose — reach for the task recipe above first when
the object being made really is a task) — property → tags → type → objects → verify:
```bash
anywrite properties create <space> --format select --name Stage
anywrite tags create <space> stage --color yellow --name Backlog
anywrite types create <space> --layout action --name Ticket --plural_name Tickets
anywrite objects create <space> --type ticket --name "Wire auth" --property stage=Backlog --body "notes"
anywrite verify <space> <object_id> --property stage=Backlog --pretty
```

**Find and update by property** — tag id → filtered search → update → verify:
```bash
anywrite tags list <space> stage --pretty                  # filters need the tag ID
anywrite search space <space> --all --json '{"types":["ticket"],"filters":{"operator":"and","conditions":[{"property_key":"stage","condition":"eq","select":"<tag_id>"}]}}'
anywrite objects update <space> <hit_id> --property stage=Shipped
anywrite verify <space> <hit_id> --property stage=Shipped --pretty
```

**Group into a collection** (collections only — sets are query-driven and read-only):
```bash
anywrite objects create <space> --type collection --name "Q3 board"
anywrite lists add <space> <collection_id> --json '{"objects":["<id1>","<id2>"]}'
anywrite lists objects <space> <collection_id>
```

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

# search — structured filters/sort go in the --json body; see references/FILTERS.md
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

# verify (composite client-side check, not a single API endpoint — see below)
anywrite verify <space> <object_id...> --property status="To Do"
```

## Verify

`anywrite verify <space> <object_id...> [--property key=value ...] [--pretty]` re-fetches each
object id and reports whether it exists and (optionally) whether specific properties hold the
expected values. Use it after a batch `objects create`/`objects update` to confirm the mutation
actually landed, instead of eyeballing raw JSON or hand-writing a throwaway parsing script.

```bash
anywrite verify <space> bafyobj1 bafyobj2 --property status="To Do" --pretty
```

Output is a JSON array (or `--pretty` table), one entry per object id:

```json
[
  {
    "id": "bafyobj1",
    "name": "Fitur KPI Staff",
    "found": true,
    "error": null,
    "propertyChecks": [{ "key": "status", "expected": "To Do", "actual": "To Do", "pass": true }],
    "pass": true
  }
]
```

`--property` is repeatable and checks any property by key (select/multi_select unwrap to tag
name(s); other formats read their own field). Exits 1 if any object is missing or fails a
property check — script/CI-friendly. A fetch failure (unknown id, network error) is captured as
`found: false` with `error` set, never a thrown exception, so a batch of ids always finishes and
reports every outcome.

## Gotchas (all live-verified against the running Anytype desktop)

1. **Body field is three different names depending on the call.** The CLI routes the right
   flag to the right field — but only if you use the right flag per action:
   ```bash
   anywrite objects create <space> --body "..."       # WRONG: --markdown (silently ignored)
   anywrite objects update <space> <id> --markdown "..." # WRONG: --body (silently ignored)
   anywrite objects get <space> <id>                  # content comes back under "markdown"
   ```
2. **Unknown flags are silently ignored — property flags are `--status` and `--property` only.**
   There is no per-property generated flag; the mistake produces a successful create with the
   property simply missing:
   ```bash
   anywrite objects create <space> --type task --name X --done true      # WRONG: object created, done NOT set
   anywrite objects create <space> --type task --name X --property done=true   # CORRECT
   ```
   `--property key=value` is format-aware: select/multi_select resolve tag names, checkbox
   takes `true`/`false`, multi-value formats take comma-separated lists.
3. **Search filters: select needs the tag ID; `--property` takes the name.** Inside a
   `--json` filter body the API gets raw values — a tag name 400s with
   `"failed to build expression filters"`. Look the id up with `tags list` first. Full DSL:
   `references/FILTERS.md`.
4. **`--filter` is a URL query passthrough, not the search filter body.** Structured search
   filtering only works via `--json '{"filters": ...}'` on `search space`/`search global`.
5. **Icon: omit it, don't empty it.**
   ```bash
   anywrite objects create <space> --name X --icon ""     # WRONG: 400 from the API
   anywrite objects create <space> --name X --icon "🔥"   # CORRECT (or omit the flag entirely)
   ```
6. **Select/multi-select values (in `--status`/`--property`) accept a tag's name, key, or id.**
   The CLI resolves a plain name against the property's existing tags first, and passes the
   raw value through if no match is found — so an id you already have always works too.
7. **Search excludes file-layout objects by default.** `file`/`image`/`video`/`audio` type
   objects are left out of search results unless explicitly requested via `--types file`
   (or the matching layout type).
8. **`lists add` / `lists remove` only work on collections, not sets.** Sets are
   query-driven views (membership comes from a filter, not a stored list) and are read-only
   for membership. Collections are the only list type whose object list can be mutated.
9. **Chat messages paginate by cursor, everything else by offset.** `--all` handles both
   transparently — you never need to know which one a given resource uses.
10. **`lists objects` with the view_id omitted returns every object in the list** (not an
    error), even though the API spec marks `view_id` as a required path segment.
11. **Delete = soft archive everywhere, and it's idempotent.** `objects delete`,
    `properties delete`, `tags delete`, `types delete`, `files delete` all archive rather than
    purge — delete twice on the same id returns 200 with `archived: true` both times, never
    a 410. A 410 only happens on `GET` of a permanently purged resource or a deleted space.
12. **File upload dedupes by content hash.** Uploading bytes identical to an existing file
    returns the *same* `object_id` as the pre-existing object — deleting "your" upload can
    archive someone else's real file if the content matches. Upload something content-unique
    when the goal is a disposable test file.
13. **Unknown ids can return HTTP 500, not 404.** `objects get <space> <bad-id>` (and similar
    gets on a non-existent id) comes back as a 500 from the live server. The CLI still exits 1
    and prints the API's error envelope verbatim to stderr either way.
14. **Object bodies round-trip semantically, not byte-identically.** Code-fence language tags
    are dropped, blank lines collapse, lines gain trailing spaces, table cells gain `<br>`.
    Never string-diff a body to verify a write — check key content instead. Details:
    `references/MARKDOWN.md`.
15. **Platform ceilings — no endpoint exists for these, so the CLI can't do them:**
    block-level editing (an object's body is whole-markdown replace only, no per-block ops),
    member invite/role management (members are list/get only), template create/update/delete
    (templates are list/get only), and space deletion.
16. **`select`/`multi_select` property values do NOT auto-create a tag on write**, even though
    `--property key=value` accepts a plain tag name (Gotcha #6). Writing a name with no
    matching tag 400s instead of creating one:
    ```bash
    anywrite objects create <space> --type task --name X --property tag=some-project
    # -> 400 bad_request: "bad input: invalid multi_select option for \"tag\": some-project"
    #    (before the "some-project" tag existed)
    ```
    Create the tag first with `tags create`, then the same write succeeds. If you maintain a
    personal `references/SPACES.md`-style cache (see above), keep its tag list current so
    this doesn't need re-discovering.

## Errors

Any 4xx/5xx from the API prints the response body verbatim to stderr and exits 1. A usage
error (unknown resource/action, missing required flag, a name that doesn't resolve to an id)
exits 2 with a short message — no API call is made.
