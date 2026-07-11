# Changelog

## v0.2.1 — Skill renamed to `anywrite`

- The Claude Code skill directory moved from `~/.claude/skills/anytype` to
  `~/.claude/skills/anywrite`, matching the CLI's actual name. Trigger by saying "anywrite" or
  by mentioning Anytype — both still work. If you wired the skill yourself before this release,
  re-run the install command in the README with the new path (delete the old
  `~/.claude/skills/anytype` directory first).

## v0.2.0 — Verify command

- New `anywrite verify <space> <object_id...> --property key=value` command — re-checks that
  objects you already created or updated actually exist and have the values you expect, so you
  don't have to eyeball raw JSON or write a one-off script to double-check a batch of changes.
- Reports a clear pass/fail per object (`--pretty` for a table), and exits with an error code if
  anything doesn't match — safe to use in scripts.

## v0.1.0 — Initial release

- Full command-line control of Anytype (the local-first PKM/notes app) — spaces, objects,
  properties, tags, types, templates, lists, files, members, search, and chat, covering every
  operation the Anytype desktop app exposes locally.
- Ships as one compiled binary (`dist/anywrite`) with nothing else to install.
- Available as a Claude Code skill (`~/.claude/skills/anywrite`) — an agent session picks it up
  automatically when Anytype comes up in conversation, with no ongoing context cost when it's
  not in use.
- Reuses an existing Anytype API key from the community `anytype-cli` tool if you already have
  one set up, or run `anywrite auth` to get a new one via the desktop app's 4-digit code flow.
- Everything a name/id pair works for (spaces, types, properties) accepts either — no need to
  look up ids by hand first.
- `--all` walks full result sets automatically; `--pretty` renders readable tables instead of
  raw JSON; `--json` is available as an escape hatch for anything not yet covered by a named
  flag.
