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
