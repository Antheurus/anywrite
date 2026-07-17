# anywrite

[![CI](https://github.com/Antheurus/anywrite/actions/workflows/ci.yml/badge.svg)](https://github.com/Antheurus/anywrite/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Bun](https://img.shields.io/badge/runtime-bun-fbf0df?logo=bun)](https://bun.sh)

![anywrite — one CLI for your whole Anytype space](docs/assets/hero.png)

A single compiled CLI for the [Anytype](https://anytype.io) desktop app's local HTTP API —
**all 52 endpoints** of the [2025-11-08 spec](https://developers.anytype.io/docs/reference),
zero runtime dependencies, one binary.

It also goes beyond that spec: Anytype's desktop app runs its own internal middleware gRPC
service (the protocol the app itself uses for things like drag-and-drop image embedding),
completely separate from the documented REST API. `anywrite` talks to that too — see
[Beyond the REST API](#beyond-the-rest-api) — for the one real thing the public API still
can't do: putting an image inline in an object's body as a real block, not just a property
reference.

Anytype's official MCP server exposes 52 always-loaded tools to every agent session whether
they're used or not. `anywrite` is the alternative: a normal CLI, wired as a
[Claude Code](https://claude.com/claude-code) skill that costs zero context until it's
actually invoked, and just as usable from a terminal or any other agent/script.

## Why

- **Full coverage, and then some.** Spaces, objects, properties, tags, types, templates,
  lists (sets + collections), chat, files, members, search, auth — every operation the local
  REST API exposes, plus one gRPC-only capability (inline image embedding) the REST API
  doesn't have at all.
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

## Beyond the REST API

The 52-endpoint local API has no way to embed an image inline in an object's body — only a
whole-markdown-replace `--body`/`--markdown` (images written there are silently stripped, see
[`references/MARKDOWN.md`](./references/MARKDOWN.md)) and a separate `attachments` property
(a file reference, not a picture in the text). Anytype's desktop app itself doesn't share that
limit — drag-and-drop/paste embedding works fine — because it talks to a completely different,
undocumented transport: an internal middleware gRPC service (`anytype-heart`'s
`ClientCommands`), not the REST API.

`anywrite` reaches that service directly for the one operation the REST API can't do:

```bash
./dist/anywrite grpc-auth                                   # one-time setup — separate 4-digit-code
                                                              # consent flow, "Limited" scope (same as
                                                              # Anytype's own WebClipper extension)
./dist/anywrite embed-image <space> <object_id> --file ./screenshot.png
```

This is a different transport, a different auth scope, and vendored `.proto` schemas (compiled
into the binary at build time — see `protos/`) — not something layered on top of the REST
endpoint registry. See "Embedding an image inline" in [`SKILL.md`](./SKILL.md) for the full
mechanism and its one real failure mode (a source file that disappears mid-upload).

## Platform ceilings

The local REST API itself has no endpoints for these — not a limitation of this CLI, and (unlike
inline image embedding above) there's no known internal-gRPC workaround for them either:

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

No ORM. The REST side needs no runtime npm packages at all — `fetch`/`FormData`/
`ReadableStream` are all Bun/web platform natives; `src/registry.ts` is the single source of
truth for every endpoint's method, path, and parameters, `src/client.ts` executes any registry
entry against the live API, `src/cli.ts` parses argv and dispatches. The gRPC side (`src/grpc.ts`,
see [Beyond the REST API](#beyond-the-rest-api)) does depend on `@grpc/grpc-js` +
`@grpc/proto-loader` — but only at build time: `bun build --compile` bundles them into the
binary, so a prebuilt `dist/anywrite` still has nothing to `npm install` at runtime either way.

Issues and PRs welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for setup, the pre-PR
checklist, and where things live.

## Credit

The API spec vendored at `spec/openapi-2025-11-08.yaml` is from
[anyproto/anytype-api](https://github.com/anyproto/anytype-api) (MIT-licensed upstream).

The `.proto` schemas vendored at `protos/anytype-heart/` (used only for `grpc-auth`/
`embed-image`) are from [anyproto/anytype-heart](https://github.com/anyproto/anytype-heart),
under the Any Source Available License 1.0 — permitted here as Non-Commercial Use (this repo
is free and non-commercial); see `protos/anytype-heart/NOTICE.md`.

All credit for the API/protocol design goes to the Anytype team; this repo is an independent
CLI client.

## License

[MIT](./LICENSE)
