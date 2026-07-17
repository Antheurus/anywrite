#!/usr/bin/env bash
# Live E2E smoke matrix for the compiled dist/anywrite binary, run against YOUR OWN real
# running Anytype desktop. Every step asserts on real post-state — no mocks. Mutations are
# separated by a 300ms sleep to stay under the live API's rate limit.
#
# Fixture IDs for a "set" (e.g. a task-tracker-style Query) and a "collection" (e.g. a
# journal-style list) must be pinned via env vars below, because list_id/view_id path params
# are not name-resolved by the CLI (only space_id/type_id/property_id are) — see
# src/resolve.ts. These are account-specific — every Anytype space has different ids — so
# they're required env vars, not hardcoded defaults; see CLAUDE.local.md for how to find and
# export your own before running this script.
set -euo pipefail

BIN="${BIN:-./dist/anywrite}"
SPACE="${SPACE:?set SPACE to your Anytype space name/id — see CLAUDE.local.md}"
TASK_TRACKER_SET="${TASK_TRACKER_SET:?set TASK_TRACKER_SET to a set/Query object id in your space — see CLAUDE.local.md}"
TASK_TRACKER_ALL_VIEW="${TASK_TRACKER_ALL_VIEW:?set TASK_TRACKER_ALL_VIEW to a view id on that set — see CLAUDE.local.md}"
JOURNAL_COLLECTION="${JOURNAL_COLLECTION:?set JOURNAL_COLLECTION to a collection object id in your space — see CLAUDE.local.md}"

WORKDIR="$(mktemp -d)"

# -- cleanup registry ---------------------------------------------------------------------------
# Every throwaway resource this script creates registers its own delete command here, in
# creation order. On exit (success or failure) they're deleted in reverse order. Anytype's
# DELETE is an idempotent soft-delete/archive (live-verified in this phase for objects,
# properties, tags, types, and files), so re-running a cleanup entry that already ran as part
# of the normal flow is always safe.
declare -a CLEANUP_CMDS=()
register_cleanup() {
  CLEANUP_CMDS+=("$1")
}
run_cleanup() {
  local i
  for ((i = ${#CLEANUP_CMDS[@]} - 1; i >= 0; i--)); do
    eval "${CLEANUP_CMDS[$i]}" >/dev/null 2>&1 || true
  done
}
on_exit() {
  local status=$?
  run_cleanup
  rm -rf "$WORKDIR"
  exit "$status"
}
trap on_exit EXIT

PASS_COUNT=0
step() { printf '\n[STEP] %s\n' "$1"; }
pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf 'PASS: %s\n' "$1"
}
fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

# Runs the CLI, writes stdout to $WORKDIR/<label>.json, fails loud (with stderr) on non-zero exit.
run_cli() {
  local label="$1"
  shift
  if ! "$BIN" "$@" >"$WORKDIR/$label.json" 2>"$WORKDIR/$label.err"; then
    cat "$WORKDIR/$label.err" >&2
    fail "command failed: $BIN $*"
  fi
}

# Asserts a Python boolean expression (referencing `d`, the parsed JSON from $WORKDIR/<label>.json)
# is true. Never touches the api key — assertions only read structural/content fields.
assert_json() {
  local desc="$1" label="$2" expr="$3"
  if ! python3 -c "
import json
d = json.load(open('$WORKDIR/$label.json'))
import sys
sys.exit(0 if bool($expr) else 1)
"; then
    printf '  -- response was:\n' >&2
    head -c 2000 "$WORKDIR/$label.json" >&2
    printf '\n' >&2
    fail "$desc"
  fi
  pass "$desc"
}

extract_json() {
  local label="$1" expr="$2"
  python3 -c "
import json
d = json.load(open('$WORKDIR/$label.json'))
print($expr)
"
}

echo "anywrite smoke matrix — binary: $BIN — space: $SPACE"

# == auth ==========================================================================================
step "auth: existing key reused, --status shows valid"
"$BIN" auth --status >"$WORKDIR/auth-status.txt"
if ! grep -q '^configured: yes$' "$WORKDIR/auth-status.txt"; then
  cat "$WORKDIR/auth-status.txt" >&2
  fail "auth --status did not report configured: yes"
fi
pass "auth --status reports configured: yes"

# == spaces / types / properties / tags ============================================================
step "spaces list / get"
run_cli spaces-list spaces list
assert_json "spaces list includes $SPACE" spaces-list \
  "any(s.get('name') == '$SPACE' for s in d.get('data', []))"

run_cli spaces-get spaces get "$SPACE"
assert_json "spaces get returns $SPACE" spaces-get "d.get('space', {}).get('name') == '$SPACE'"

step "types list"
run_cli types-list types list "$SPACE" --all
assert_json "types list includes 'task'" types-list \
  "any(t.get('key') == 'task' for t in d)"

step "properties list"
run_cli properties-list properties list "$SPACE" --all
assert_json "properties list includes 'status'" properties-list \
  "any(p.get('key') == 'status' for p in d)"

step "tags list on status property"
run_cli tags-list tags list "$SPACE" status --all
assert_json "status tags include To Do / In Progress / Done" tags-list \
  "{t.get('name') for t in d} >= {'To Do', 'In Progress', 'Done'}"

# == object lifecycle: create -> update -> status -> get -> delete -> get =========================
step "object create (task)"
OBJ_NAME="anywrite-smoke-$(date +%s)"
run_cli object-create objects create "$SPACE" --type task --name "$OBJ_NAME"
assert_json "object create returned an id" object-create "d.get('object', {}).get('id')"
OBJ_ID="$(extract_json object-create "d['object']['id']")"
register_cleanup "\"$BIN\" objects delete \"$SPACE\" \"$OBJ_ID\""
echo "  object id: $OBJ_ID"
sleep 0.3

step "object update name + markdown"
run_cli object-update objects update "$SPACE" "$OBJ_ID" \
  --name "${OBJ_NAME}-renamed" --markdown "smoke test body"
sleep 0.3

step "object set status via --status \"To Do\""
run_cli object-status objects update "$SPACE" "$OBJ_ID" --status "To Do"
sleep 0.3

step "verify: object exists and status matches (positive case)"
run_cli verify-object-ok verify "$SPACE" "$OBJ_ID" --property status="To Do"
assert_json "verify reports found:true, pass:true for the smoke task" verify-object-ok \
  "d[0]['found'] is True and d[0]['pass'] is True"
sleep 0.3

step "verify: property mismatch is reported as pass:false, not silently ignored"
# Intentional non-zero exit (verify exits 1 when any object fails) — bypass run_cli's strict
# failure check with a direct invocation, same pattern as auth --status above.
"$BIN" verify "$SPACE" "$OBJ_ID" --property status="Done" \
  >"$WORKDIR/verify-object-mismatch.json" 2>"$WORKDIR/verify-object-mismatch.err" || true
assert_json "verify reports pass:false and the actual value when status does not match" \
  verify-object-mismatch "d[0]['pass'] is False and d[0]['propertyChecks'][0]['actual'] == 'To Do'"
sleep 0.3

step "verify: unknown object id is reported as found:false, not a crash"
"$BIN" verify "$SPACE" "bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
  >"$WORKDIR/verify-object-missing.json" 2>"$WORKDIR/verify-object-missing.err" || true
assert_json "verify reports found:false for a bogus id" verify-object-missing "d[0]['found'] is False"
sleep 0.3

step "object get shows name + markdown + status"
run_cli object-get-before-delete objects get "$SPACE" "$OBJ_ID"
assert_json "object name updated" object-get-before-delete \
  "d['object']['name'] == '${OBJ_NAME}-renamed'"
assert_json "object markdown updated" object-get-before-delete \
  "'smoke test body' in d['object'].get('markdown', '')"
assert_json "object status resolved to To Do tag" object-get-before-delete \
  "any(p.get('key') == 'status' and 'To Do' in (p.get('select') or {}).get('name', '') for p in d['object'].get('properties', []))"

step "object delete (archive)"
run_cli object-delete objects delete "$SPACE" "$OBJ_ID"
sleep 0.3

step "object get shows archived:true"
run_cli object-get-after-delete objects get "$SPACE" "$OBJ_ID"
assert_json "object archived after delete" object-get-after-delete "d['object']['archived'] is True"

# == file upload -> attach -> download -> delete ===================================================
step "file upload (generated unique fixture, see note below)"
# NOTE: the brief's fixture /tmp/anytype-preview/beresin-kk.png already exists in this space as
# a real user object ("beresin kk" / "ChatGPT Image May 31, 2026...") — Anytype dedupes file
# uploads by content hash, so uploading that exact file returns the EXISTING object_id rather
# than creating a new one. Deleting it at cleanup would archive real user data. This step
# generates a fresh, content-unique PNG instead so the upload is guaranteed new and safe to
# delete — same multipart/attach/download code path, no risk to real data.
FIXTURE_PNG="$WORKDIR/smoke-fixture.png"
python3 -c "
from PIL import Image, ImageDraw
import time
img = Image.new('RGB', (64, 64), color=(20, 140, 200))
d = ImageDraw.Draw(img)
d.text((2, 25), f'smoke {int(time.time())}', fill=(255, 255, 0))
img.save('$FIXTURE_PNG')
"
run_cli file-upload files upload "$SPACE" --file "$FIXTURE_PNG"
assert_json "file upload returned an object_id" file-upload "d.get('object_id')"
FILE_ID="$(extract_json file-upload "d['object_id']")"
register_cleanup "\"$BIN\" files delete \"$SPACE\" \"$FILE_ID\""
echo "  file object id: $FILE_ID"
sleep 0.3

step "attach file into a new object's markdown"
run_cli attach-create objects create "$SPACE" --type page --name "smoke-attach-$(date +%s)" \
  --body "![attached](http://127.0.0.1:47800/image/$FILE_ID)"
ATTACH_OBJ_ID="$(extract_json attach-create "d['object']['id']")"
register_cleanup "\"$BIN\" objects delete \"$SPACE\" \"$ATTACH_OBJ_ID\""
sleep 0.3
run_cli attach-get objects get "$SPACE" "$ATTACH_OBJ_ID"
assert_json "attached object's markdown references the uploaded file" attach-get \
  "'$FILE_ID' in d['object'].get('markdown', '')"

step "file download round-trips bytes"
DOWNLOADED_PNG="$WORKDIR/smoke-downloaded.png"
"$BIN" files download "$SPACE" "$FILE_ID" --output "$DOWNLOADED_PNG" >"$WORKDIR/file-download.json"
python3 -c "
import hashlib, sys
a = hashlib.sha256(open('$FIXTURE_PNG', 'rb').read()).hexdigest()
b = hashlib.sha256(open('$DOWNLOADED_PNG', 'rb').read()).hexdigest()
sys.exit(0 if a == b else 1)
" || fail "downloaded file bytes do not match the uploaded fixture"
pass "downloaded file bytes match the uploaded fixture"

step "delete file"
run_cli file-delete files delete "$SPACE" "$FILE_ID"
pass "file deleted"
sleep 0.3

step "delete attach object"
run_cli attach-delete objects delete "$SPACE" "$ATTACH_OBJ_ID"
pass "attach object archived"
sleep 0.3

# == search + pagination ============================================================================
step "search global"
run_cli search-global search global --query task --types task
assert_json "search global returns a data array" search-global "isinstance(d.get('data'), list)"

step "search space with --types + a select filter"
STATUS_TAG_ID="$(python3 -c "
import json
d = json.load(open('$WORKDIR/tags-list.json'))
print(next(t['id'] for t in d if t['name'] == 'To Do'))
")"
run_cli search-space-filtered search space "$SPACE" --types task \
  --json "{\"filters\":{\"operator\":\"and\",\"conditions\":[{\"property_key\":\"status\",\"condition\":\"eq\",\"select\":\"$STATUS_TAG_ID\"}]}}"
assert_json "search space with select filter returns a data array" search-space-filtered \
  "isinstance(d.get('data'), list)"

step "--all pagination on objects list"
run_cli objects-all objects list "$SPACE" --all
assert_json "objects list --all returns a non-empty array" objects-all "isinstance(d, list) and len(d) > 0"

# == lists (views / objects / collection add-remove) ===============================================
step "views of 'Task tracker' set"
run_cli set-views lists views "$SPACE" "$TASK_TRACKER_SET"
assert_json "'All' view present" set-views \
  "any(v.get('id') == '$TASK_TRACKER_ALL_VIEW' and v.get('name') == 'All' for v in d.get('data', []))"

step "objects of view 'All'"
run_cli set-view-all-objects lists objects "$SPACE" "$TASK_TRACKER_SET" "$TASK_TRACKER_ALL_VIEW"
assert_json "'All' view returns objects" set-view-all-objects "len(d.get('data', [])) > 0"

step "empty view_id returns all objects"
run_cli set-empty-view-objects lists objects "$SPACE" "$TASK_TRACKER_SET"
assert_json "omitted view_id returns the same object count as 'All'" set-empty-view-objects \
  "len(d.get('data', [])) == $(extract_json set-view-all-objects "len(d.get('data', []))")"

step "add/remove object on 'Journal' collection"
run_cli journal-throwaway-create objects create "$SPACE" --type note --name "smoke-journal-$(date +%s)"
JOURNAL_OBJ_ID="$(extract_json journal-throwaway-create "d['object']['id']")"
register_cleanup "\"$BIN\" objects delete \"$SPACE\" \"$JOURNAL_OBJ_ID\""
sleep 0.3

run_cli journal-add lists add "$SPACE" "$JOURNAL_COLLECTION" --objects "$JOURNAL_OBJ_ID"
sleep 0.3
run_cli journal-after-add lists objects "$SPACE" "$JOURNAL_COLLECTION"
assert_json "throwaway object appears in Journal after add" journal-after-add \
  "any(o.get('id') == '$JOURNAL_OBJ_ID' for o in d.get('data', []))"

run_cli journal-remove lists remove "$SPACE" "$JOURNAL_COLLECTION" "$JOURNAL_OBJ_ID"
sleep 0.3
run_cli journal-after-remove lists objects "$SPACE" "$JOURNAL_COLLECTION"
assert_json "throwaway object gone from Journal after remove" journal-after-remove \
  "not any(o.get('id') == '$JOURNAL_OBJ_ID' for o in d.get('data', []))"

step "delete Journal throwaway object"
run_cli journal-throwaway-delete objects delete "$SPACE" "$JOURNAL_OBJ_ID"
pass "Journal throwaway object archived"
sleep 0.3

# == chat ============================================================================================
step "chat: list chats"
run_cli chat-list chat list "$SPACE"
assert_json "chat list endpoint returns 200 with a data array" chat-list "isinstance(d.get('data'), list)"
CHAT_COUNT="$(extract_json chat-list "len(d.get('data', []))")"
if [ "$CHAT_COUNT" = "0" ]; then
  echo "DEFERRED: chat --follow (SSE) — no chats exist in this space to stream from;" \
    "empty chat list returning 200 is this matrix's success bar per the phase brief."
else
  echo "  space has $CHAT_COUNT chat(s) — chat --follow SSE is exercised manually, not by this script."
fi

# == property / tag / type create+patch+delete round-trip on throwaways ===========================
step "property create + patch + delete round-trip"
run_cli prop-create properties create "$SPACE" --format text --name "smoke-prop-$(date +%s)"
PROP_ID="$(extract_json prop-create "d['property']['id']")"
register_cleanup "\"$BIN\" properties delete \"$SPACE\" \"$PROP_ID\""
sleep 0.3
run_cli prop-patch properties update "$SPACE" "$PROP_ID" --name "smoke-prop-renamed"
assert_json "property patched name" prop-patch "d['property']['name'] == 'smoke-prop-renamed'"
sleep 0.3
run_cli prop-delete properties delete "$SPACE" "$PROP_ID"
assert_json "property delete round-trip returns the property id" prop-delete \
  "d['property']['id'] == '$PROP_ID'"
sleep 0.3

step "type create + patch + delete round-trip"
run_cli type-create types create "$SPACE" --layout basic --name "smoke-type-$(date +%s)" \
  --plural_name "smoke-types"
TYPE_ID="$(extract_json type-create "d['type']['id']")"
register_cleanup "\"$BIN\" types delete \"$SPACE\" \"$TYPE_ID\""
sleep 0.3
run_cli type-patch types update "$SPACE" "$TYPE_ID" --name "smoke-type-renamed"
assert_json "type patched name" type-patch "d['type']['name'] == 'smoke-type-renamed'"
sleep 0.3
run_cli type-delete types delete "$SPACE" "$TYPE_ID"
assert_json "type delete round-trip returns the type id" type-delete "d['type']['id'] == '$TYPE_ID'"
sleep 0.3

step "tag create + patch + delete round-trip (on a throwaway select property)"
run_cli tag-prop-create properties create "$SPACE" --format select --name "smoke-select-$(date +%s)"
TAG_PROP_ID="$(extract_json tag-prop-create "d['property']['id']")"
register_cleanup "\"$BIN\" properties delete \"$SPACE\" \"$TAG_PROP_ID\""
sleep 0.3
run_cli tag-create tags create "$SPACE" "$TAG_PROP_ID" --color red --name "smoke-tag"
TAG_ID="$(extract_json tag-create "d['tag']['id']")"
sleep 0.3
run_cli tag-patch tags update "$SPACE" "$TAG_PROP_ID" "$TAG_ID" --name "smoke-tag-renamed"
assert_json "tag patched name" tag-patch "d['tag']['name'] == 'smoke-tag-renamed'"
sleep 0.3

# == 410 / delete-idempotency observation ===========================================================
step "repeat delete on the same tag (live-observed delete-as-archive semantics)"
run_cli tag-delete-1 tags delete "$SPACE" "$TAG_PROP_ID" "$TAG_ID"
sleep 0.3
run_cli tag-delete-2 tags delete "$SPACE" "$TAG_PROP_ID" "$TAG_ID"
# LIVE-API OBSERVATION (recorded in docs/plan progress log): this API's DELETE endpoints are
# idempotent soft-deletes/archives across every resource tested (objects, properties, tags,
# types, files) — a repeat delete returns 200 with the same envelope again, never 410. The
# spec's 410/GoneError responses correspond to GET-after-purge or a deleted parent SPACE, which
# this smoke matrix does not trigger (too destructive). The client's 410 mapping itself is
# unit-tested (client.test.ts) via a mocked 410 response.
assert_json "repeat tag delete returns 200 with the same tag id (idempotent, not 410)" tag-delete-2 \
  "d['tag']['id'] == '$TAG_ID'"
sleep 0.3
run_cli tag-prop-delete properties delete "$SPACE" "$TAG_PROP_ID"
pass "throwaway select property (and its tag) archived"

printf '\n%d/%d steps passed. Smoke matrix green.\n' "$PASS_COUNT" "$PASS_COUNT"
