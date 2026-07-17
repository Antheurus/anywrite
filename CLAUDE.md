# anywrite — project rules

This is a **public, shared tool** (github.com/Antheurus/anywrite) — other people install and
use it against their own Anytype accounts. It is not personal tooling, even though it was
built by and for one user originally.

## Never bake personal/account-specific data into shipped files

`SKILL.md`, `README.md`, `CONTRIBUTING.md`, and everything under `references/` are read by
every user of this skill, not just the original author. Never hardcode:

- A real Anytype space name or id as if it were canonical (use `<space>` as a placeholder in
  every example command)
- Real object/property/tag ids from any actual account
- A real local filesystem path tied to one machine (e.g. `/Users/<username>/...` as "the"
  binary location) — describe paths relative to `<repo>` or say "wherever this was cloned"
- Any other account-specific fact (project names, personal server names, etc.) presented as
  if it's a fixed, shared value

`references/spaces.md` is the one sanctioned exception: it's a personal, gitignored,
machine-local cache of one's own space's shape (ids/types/tags), documented in `SKILL.md` as
an optional practice each user can adopt for their own account — never filled with real data
and committed.

Legitimate exceptions: the actual GitHub repo URL (`github.com/Antheurus/anywrite`) in
README/CONTRIBUTING/CI badges — that's not account data, it's just where the code lives.

## Where this was caught before

A 2026-07-18 session found `SKILL.md` and several `references/*.md` files full of one
account's real space name, real tag/object ids, and a hardcoded personal machine path —
all committed to the public repo. Fixed by genericizing to `<space>` placeholders and a
portable path description, and gitignoring `references/spaces.md`. Before adding new
examples or docs, check they'd make sense to a stranger cloning this repo for their own
Anytype account — not just to the original author's account.
