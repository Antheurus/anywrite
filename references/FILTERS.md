# Search Filters, Sorting, and the `--filter` vs `--json` Split

Everything here was live-verified against the running Anytype desktop (API spec 2025-11-08)
on 2026-07-12.

## Two different mechanisms — don't confuse them

| Flag | Where it lands | Use for |
|---|---|---|
| `--filter "key[cond]=value"` | URL **query string**, raw passthrough | GET-style list endpoints that accept query params |
| `--json '{"filters": {...}}'` | Request **body** | `search space` / `search global` structured filtering |

The structured filter DSL below only works through `--json` on the search endpoints.
`--filter` never builds a FilterExpression — it copies `key=value` verbatim into the query
string.

## SearchRequest body shape

```json
{
  "query": "text matched against object names and content",
  "types": ["page", "task"],
  "filters": { "<FilterExpression>": "see below" },
  "sort": { "property_key": "name", "direction": "asc" }
}
```

All four keys are optional and combine (query AND types AND filters).

## FilterExpression — recursive AND/OR tree

```json
{
  "operator": "and",
  "conditions": [ { "<FilterItem>": "leaf conditions at this level" } ],
  "filters":    [ { "<FilterExpression>": "nested sub-expressions" } ]
}
```

- `operator`: `"and"` | `"or"` — applies to everything in `conditions` + `filters` at that level.
- `conditions` and `filters` can both be present; nesting depth is unlimited.

Live-verified nested example — `name contains "AWTEST" AND (status = "To Do" OR status = "In Progress")`:

```bash
anywrite search space <space> --json '{
  "filters": {
    "operator": "and",
    "conditions": [
      {"property_key": "name", "condition": "contains", "text": "AWTEST"}
    ],
    "filters": [
      {
        "operator": "or",
        "conditions": [
          {"property_key": "status", "condition": "eq", "select": "bafyreien3...todo-tag-id"},
          {"property_key": "status", "condition": "eq", "select": "bafyreidde...inprogress-tag-id"}
        ]
      }
    ]
  }
}'
```

## FilterItem — one shape per property format

Every leaf condition is `{"property_key": "...", "condition": "...", "<value-field>": ...}` where
the value field name must match the property's format:

| Property format | Value field | Value type | Notes |
|---|---|---|---|
| text | `text` | string | `name` and `description` are text |
| number | `number` | number | |
| select | `select` | string | **tag ID only** — a tag name 400s (see below) |
| multi_select | `multi_select` | string[] | tag IDs |
| date | `date` | string | RFC3339 or date-only `2026-01-02` (both verified) |
| checkbox | `checkbox` | boolean | |
| files | `files` | string[] | file object IDs |
| url | `url` | string | |
| email | `email` | string | |
| phone | `phone` | string | |
| objects | `objects` | string[] | object IDs (e.g. `creator`, `assignee`) |
| (empty check) | — no value field — | | use condition `empty` / `nempty` |

### Conditions

`eq` `ne` `gt` `gte` `lt` `lte` `contains` `ncontains` `in` `nin` `all` `empty` `nempty`

- `contains`/`ncontains` — substring match (text).
- `in`/`nin` — value in / not in array.
- `all` — contains all specified values (multi_select/files/objects).
- `empty`/`nempty` — property has no value / has a value; **omit the value field entirely**.

### Live-verified leaf examples

```bash
# text contains
'{"filters":{"operator":"and","conditions":[{"property_key":"name","condition":"contains","text":"AWTEST"}]}}'

# checkbox
'{"filters":{"operator":"and","conditions":[{"property_key":"done","condition":"eq","checkbox":true}]}}'

# select by TAG ID (get the id from: anywrite tags list <space> <property>)
'{"filters":{"operator":"and","conditions":[{"property_key":"status","condition":"eq","select":"bafyreien3sgyz..."}]}}'

# date, date-only form works
'{"filters":{"operator":"and","conditions":[{"property_key":"created_date","condition":"gt","date":"2026-01-01"}]}}'

# empty — no value field
'{"filters":{"operator":"and","conditions":[{"property_key":"description","condition":"empty"}]}}'
```

## GOTCHA — select/multi_select filters need the tag ID, not the name

This is the one place the CLI's name-resolution does NOT apply: `--property status="To Do"` on
create/update resolves the tag name for you, but inside a `--json` filter the API gets the raw
value and a tag *name* fails:

```bash
# WRONG — 400 {"code":"bad_request","message":"failed to build expression filters"}
... "conditions":[{"property_key":"status","condition":"eq","select":"To Do"}] ...

# CORRECT — look the id up first
anywrite tags list <space> status --pretty
... "conditions":[{"property_key":"status","condition":"eq","select":"bafyreien3sgyz..."}] ...
```

## Sort

```json
{"sort": {"property_key": "name", "direction": "asc"}}
```

- `property_key` is a **closed enum of four**: `created_date`, `last_modified_date`
  (default), `last_opened_date`, `name`. Arbitrary property keys are NOT sortable.
- `direction`: `asc` | `desc` (default `desc`).
