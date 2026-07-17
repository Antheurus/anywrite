# What Markdown Survives an Anytype Object Body

Live-verified 2026-07-12 by round-tripping a rich document through
`objects create --body` → `objects get` (markdown field) on the running Anytype desktop.

## Survives intact (semantically)

- Headings `#` `##` `###`
- `**bold**`, `*italic*`, `~~strike~~`, `` `inline code` ``, `[links](https://...)`
- Bullet lists incl. nesting, numbered lists
- Task checkboxes `- [ ]` / `- [x]`
- Blockquotes `>`
- Fenced code blocks (content preserved exactly, including indentation)
- Tables (structure preserved)
- Horizontal rules `---`
- `==highlight==` and `[^1]` footnote syntax pass through as literal text

## Images do NOT embed via markdown — and it's worse than a clean no-op

`![alt](url)` markdown image syntax written into `--body`/`--markdown` disappears from the
**text** on round-trip — `objects get` shows the line simply gone, no error, no trace in the
returned `markdown` field. That part looked harmless at first. It is not: live-verified on a
real object, the disappearance from the markdown field does NOT mean the write was a no-op.
The Anytype desktop app rendered a permanently-stuck loading spinner block (labelled
"Untitled") on that object's page — a leftover embedded block that isn't a text block, so it
never shows up in `objects get`'s `markdown` output, and there is no per-block delete endpoint
(see Platform ceilings, Gotcha #15) to remove it via the CLI. Confirmed by contrast: other
objects on which only the `attachments` property was used (never a markdown image embed
attempt) show no such stuck block at all. The only fix once this happens is manual, inside the
Anytype app itself — open the object, select the stuck block, delete it by hand.

**Conclusion: never write `![alt](url)` (or any HTML `<img>` variant) into `--body`/`--markdown`
for any reason**, not even as an experiment to "just see if it works" — the text-level revert
(re-running `--markdown` with the image line removed) does NOT clean up the orphaned block it
leaves behind.

This is specifically a limitation of the **public REST API's** `--body`/`--markdown` write
path — it is NOT a statement that Anytype itself can't embed inline images at all. It genuinely
can (that's exactly what happens when you drag-and-drop or paste an image into a note in the
app), it's just a different, internal-only mechanism the REST API doesn't expose. `anywrite`
has a separate command, `embed-image`, that reaches that mechanism directly (via Anytype's
internal middleware gRPC service, not the REST API) — see "Embedding an image inline" under
Workflows in `SKILL.md`. Use that instead of `--body`/`--markdown` whenever the actual goal is
a picture inline in the note; the `attachments` property (files format, see the file-attach
recipe in `SKILL.md` / `EXAMPLES.md`) is a third, still-different option — a file reference
visible only in the object's ⓘ info panel, neither inline in the body nor a real block.

## Mangled or lost on the way back — never byte-diff a body

The returned `markdown` is a re-serialization of Anytype's internal blocks, NOT your input
string:

| Input | Comes back as |
|---|---|
| ` ```python ` fence | ` ``` ` — **language tag is dropped** (syntax highlighting intent is lost) |
| Blank lines between blocks | Collapsed; blocks separated by single newlines |
| Every line | Gains trailing spaces (`# Heading 1   \n`) |
| Table cells | Gain `<br>` suffixes; alignment row rewritten to `:---` |
| 2-space nested bullet indent | Rewritten to 4-space |

Example — input vs round-trip of the same table:

```
| Col A | Col B |          | Col A   <br> | Col B   <br> |
|-------|-------|    →     |:-------------|:-------------|
| a1    | b1    |          |    a1   <br> |    b1   <br> |
```

## Rules that follow

1. **Verify bodies by content, not by string equality.** A raw diff of input vs
   `objects get` markdown always "fails". Normalize (strip trailing whitespace, collapse
   blank lines) or check for the presence of key lines instead.
2. **Don't rely on code-fence language tags round-tripping.** If the language matters to a
   downstream consumer, record it in the surrounding text or a property.
3. **Whole-body replace only.** `objects update --markdown` replaces the entire body; there
   are no per-block operations in the API. To edit one section: `objects get` → modify the
   returned markdown → `objects update --markdown "<whole thing>"` — and accept the
   re-serialization artifacts above compounding on every cycle.
