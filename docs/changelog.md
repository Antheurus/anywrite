# Changelog

## v0.2.2 — Skill docs: workflows, filter guide, and worked examples

- The skill now includes step-by-step workflow recipes for the common jobs (set up a
  tracker, find-and-update by property, group into a collection).
- New reference guides: the complete search filter syntax with verified examples
  (`references/FILTERS.md`), what markdown survives in object bodies
  (`references/MARKDOWN.md`), and full worked command sequences
  (`references/EXAMPLES.md`).
- Gotchas now show the failing command next to the working one, plus two newly
  discovered ones: misspelled property flags are silently ignored (use
  `--property key=value`), and search filters need a tag's id, not its name.
- If you wired the skill manually, add the new symlink:
  `ln -s <repo>/references ~/.claude/skills/anywrite/references`.

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
