# Complete Worked Examples

End-to-end command sequences with the response shapes that actually come back. All shapes
verified live against the Anytype desktop (API spec 2025-11-08). `<space>` is a space name or
id — the CLI resolves names. Substitute the absolute binary path for `anywrite`.

## Example 1 — Project tracker from scratch

Create a type with custom properties, tag it, populate it, group it in a collection, verify.

```bash
# 1. custom select property for workflow state (skip if reusing the built-in "status")
anywrite properties create <space> --format select --name Stage
# -> {"property": {"id": "bafyrei...", "key": "stage", "name": "Stage", "format": "select"}}

# 2. tags on it — colors: grey, yellow, orange, red, pink, purple, blue, ice, teal, lime
anywrite tags create <space> stage --color yellow --name Backlog
anywrite tags create <space> stage --color blue   --name Building
anywrite tags create <space> stage --color lime   --name Shipped

# 3. a type that carries the property (layout: basic | profile | action | note)
anywrite types create <space> --layout action --name Ticket --plural_name Tickets

# 4. objects — --property key=value is repeatable and format-aware
#    (select values accept tag NAME here; the CLI resolves it to the id)
anywrite objects create <space> --type ticket --name "Wire auth flow" \
  --property stage=Building --property priority=1 --body "JWT + marker cookie, see auth notes"
anywrite objects create <space> --type ticket --name "Landing page copy" \
  --property stage=Backlog
# -> each returns {"object": {"id": "bafyrei...", "name": "...", "properties": [...]}}

# 5. a collection to group them (lists add works on collections ONLY, never sets)
anywrite objects create <space> --type collection --name "Q3 board"
anywrite lists add <space> <collection_id> --json '{"objects": ["<ticket1_id>", "<ticket2_id>"]}'

# 6. verify the batch landed with the right values — exits 1 on any mismatch
anywrite verify <space> <ticket1_id> <ticket2_id> --property stage=Building --pretty
```

## Example 2 — Find and update by property (filtered search → mutate → verify)

"Mark every open ticket in Building as Shipped."

```bash
# 1. the select FILTER needs the tag ID (unlike --property, which takes the name)
anywrite tags list <space> stage --pretty
# -> id: bafyreibuilding...  name: Building

# 2. structured search — filters go in the --json BODY (never --filter)
anywrite search space <space> --all --json '{
  "types": ["ticket"],
  "filters": {"operator": "and", "conditions": [
    {"property_key": "stage", "condition": "eq", "select": "bafyreibuilding..."},
    {"property_key": "done", "condition": "eq", "checkbox": false}
  ]}
}'
# -> {"data": [{"id": "bafyrei...", "name": "Wire auth flow", ...}], "pagination": {...}}

# 3. update each hit (tag NAME is fine again on update)
anywrite objects update <space> <hit_id> --property stage=Shipped --property done=true

# 4. verify
anywrite verify <space> <hit_id> --property stage=Shipped --property done=true --pretty
```

## Example 3 — Bulk-import notes from files

```bash
# one object per markdown file; bodies are whole-markdown (see references/MARKDOWN.md)
for f in notes/*.md; do
  anywrite objects create <space> --type note \
    --name "$(basename "$f" .md)" --body "$(cat "$f")"
done

# spot-check: text search over what just landed
anywrite search space <space> --query "some phrase from a note" --json '{"types": ["note"]}'
```

## Example 4 — Attach a file and reference it

```bash
anywrite files upload <space> --file ./diagram.png
# -> {"object": {"id": "bafyreifile...", "name": "diagram.png", ...}}
# NOTE: identical bytes dedupe to the SAME object id as any pre-existing upload

anywrite objects update <space> <object_id> --json \
  '{"properties": [{"key": "attachments", "files": ["bafyreifile..."]}]}'

anywrite files download <space> bafyreifile... --output ./copy.png
```
