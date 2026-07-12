# anywrite

[![CI](https://github.com/Antheurus/anywrite/actions/workflows/ci.yml/badge.svg)](https://github.com/Antheurus/anywrite/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Bun](https://img.shields.io/badge/runtime-bun-fbf0df?logo=bun)](https://bun.sh)

![anywrite — one CLI for your whole Anytype space](docs/assets/hero.png)

A single compiled CLI for the [Anytype](https://anytype.io) desktop app's local HTTP API —
**all 52 endpoints** of the [2025-11-08 spec](https://developers.anytype.io/docs/reference),
zero runtime dependencies, one binary.

Anytype's official MCP server exposes 52 always-loaded tools to every agent session whether
they're used or not. `anywrite` is the alternative: a normal CLI, wired as a
[Claude Code](https://claude.com/claude-code) skill that costs zero context until it's
actually invoked, and just as usable from a terminal or any other agent/script.

## Why

- **Full coverage.** Spaces, objects, properties, tags, types, templates, lists (sets +
  collections), chat, files, members, search, auth — every operation the local API exposes.
- **One binary, no deps.** Built with `bun build --compile`; ships as a single ~55MB
  executable with nothing to `npm install` at runtime.
- **Data-driven.** Every endpoint is one entry in an endpoint registry (method, path,
  params, quirks) — adding an endpoint if the API grows is a data change, not new code.
- **Agent-first.** Designed to be driven non-interactively: predictable flags, JSON by
  default, an escape hatch (`--json`) for anything the typed flags don't model yet, and a
  verbatim error envelope on failure so a caller (human or agent) always knows exactly what
  the API said.

## Install

Grab a prebuilt binary from [Releases](https://github.com/Antheurus/anywrite/releases) (macOS
arm64/x64, Linux x64/arm64, Windows x64) — no Bun required at runtime, just download and run.

Or build from source. Requires [Bun](https://bun.sh) and [`just`](https://github.com/casey/just).

```bash
git clone https://github.com/Antheurus/anywrite.git
cd anywrite
just build          # -> dist/anywrite
```

`just build` installs dependencies and compiles the binary. Other targets: `just test`,
`just check` (typecheck + lint), `just smoke` (rebuilds, then runs the live E2E smoke suite
against a running Anytype desktop).

## Auth

Anytype desktop must be running locally (default `http://localhost:31009`).

```bash
./dist/anywrite auth --status   # shows configured yes/no and where the key came from
./dist/anywrite auth            # starts the challenge flow — a 4-digit code appears in
                                 # the Anytype desktop app; enter it when prompted
./dist/anywrite auth --code 1234   # non-interactive form of the same exchange
```

The resulting key is written to `~/.anywrite/config.json`. Config precedence at runtime:

1. `ANYTYPE_API_KEY` env var (optionally paired with `ANYTYPE_BASE_URL`)
2. `~/.anywrite/config.json`
3. `~/.anytype-cli/config.yaml` — read-only fallback, reused if you already have a key
   configured for the community `anytype-cli` tool

The key is never printed by any command, including `auth --status`.

## Usage

```
anywrite <resource> <action> [positionals] [--flag value]
```

Resources: `spaces`, `objects`, `properties`, `tags`, `types`, `templates`, `lists`, `files`,
`members`, `search`, `chat`, `auth`.

```bash
./dist/anywrite --help                   # list resources
./dist/anywrite objects --help           # list actions + flags for one resource

./dist/anywrite spaces list
./dist/anywrite objects create <space> --type task --name "Buy milk"
./dist/anywrite objects update <space> <object_id> --status "Done"
./dist/anywrite objects list <space> --all --pretty
./dist/anywrite files upload <space> --file ./image.png
./dist/anywrite search global --query "task" --types task
./dist/anywrite chat messages <space> <chat_id> --all
./dist/anywrite verify <space> <object_id> --property status="Done" --pretty
```

`space`/`type`/`property` positionals accept a name or an id — names are resolved to ids
automatically. See [`SKILL.md`](./SKILL.md) for the full 12-resource command matrix and a
detailed gotchas list (all live-verified against a real Anytype desktop):

- the object body field is named differently on create (`--body`) vs. update (`--markdown`)
- an emoji `--icon` must be omitted, not set to an empty string
- `select`/`multi_select` values accept a tag's name, key, or id
- search excludes file/image/video/audio objects unless explicitly requested
- `lists add`/`remove` only work on collections, not sets
- chat messages paginate by cursor; everything else paginates by offset
- delete is a soft archive everywhere and is idempotent — repeat delete stays 200, never 410
- file upload dedupes by content hash — re-uploading identical bytes returns the existing
  object's id

## Platform ceilings

The local API itself has no endpoints for these — not a limitation of this CLI:

- block-level editing (an object's body is whole-markdown replace only)
- member invite / role management (members are list/get only)
- template create / update / delete (templates are list/get only)
- space deletion

## Claude Code skill

The repo's [`SKILL.md`](./SKILL.md) doubles as a Claude Code skill. To wire it up:

```bash
mkdir -p ~/.claude/skills/anywrite
ln -s /path/to/anywrite/SKILL.md ~/.claude/skills/anywrite/SKILL.md
ln -s /path/to/anywrite/references ~/.claude/skills/anywrite/references
```

Claude Code loads `SKILL.md` only when a session's context matches its trigger description —
no standing context cost otherwise.

## Development

```bash
just install    # bun install
just build      # compile dist/anywrite
just test       # bun test (unit tests, mocked network)
just check      # typecheck + lint
just smoke      # rebuild + run scripts/smoke.sh against a real running Anytype desktop
just codegen    # regenerate src/types/api.d.ts from spec/openapi-2025-11-08.yaml
```

No ORM, no runtime npm packages — `fetch`/`FormData`/`ReadableStream` are all Bun/web
platform natives. `src/registry.ts` is the single source of truth for every endpoint's
method, path, and parameters; `src/client.ts` executes any registry entry against the live
API; `src/cli.ts` parses argv and dispatches.

Issues and PRs welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for setup, the pre-PR
checklist, and where things live.

## Credit

The API spec vendored at `spec/openapi-2025-11-08.yaml` is from
[anyproto/anytype-api](https://github.com/anyproto/anytype-api) (MIT-licensed upstream). All
credit for the API design goes to the Anytype team; this repo is an independent CLI client.

## License

[MIT](./LICENSE)
