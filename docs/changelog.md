# Changelog

## v0.1.0 — Initial release

- Full command-line control of Anytype (the local-first PKM/notes app) — spaces, objects,
  properties, tags, types, templates, lists, files, members, search, and chat, covering every
  operation the Anytype desktop app exposes locally.
- Ships as one compiled binary (`dist/anywrite`) with nothing else to install.
- Available as a Claude Code skill (`~/.claude/skills/anytype`) — an agent session picks it up
  automatically when Anytype comes up in conversation, with no ongoing context cost when it's
  not in use.
- Reuses an existing Anytype API key from the community `anytype-cli` tool if you already have
  one set up, or run `anywrite auth` to get a new one via the desktop app's 4-digit code flow.
- Everything a name/id pair works for (spaces, types, properties) accepts either — no need to
  look up ids by hand first.
- `--all` walks full result sets automatically; `--pretty` renders readable tables instead of
  raw JSON; `--json` is available as an escape hatch for anything not yet covered by a named
  flag.
