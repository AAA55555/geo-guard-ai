#!/bin/sh
# End-to-end smoke test for the real CLI (dist/cli.js) against a sandboxed $HOME.
# POSIX only — os.homedir() on POSIX reads $HOME, so ~/.zshrc, ~/.claude, ~/.cursor
# all resolve inside the sandbox. On Windows this isolation isn't reliable, so skip.
set -eu

if [ "${OS:-}" = "Windows_NT" ]; then
  echo "e2e: skipped on Windows (no reliable \$HOME-based sandboxing)"
  exit 0
fi

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
CLI="$ROOT/dist/cli.js"

SANDBOX="$(mktemp -d)"
SRV_PID=""

cleanup() {
  [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null || true
  rm -rf "$SANDBOX"
}
trap cleanup EXIT

fail() {
  echo "e2e: FAIL — $1" >&2
  exit 1
}

assert_contains() {
  # assert_contains <file> <needle>
  grep -qF -- "$2" "$1" || fail "$1 does not contain: $2"
}

# --- clean env: don't let ambient config leak into the sandbox ---
unset XDG_CONFIG_HOME APPDATA
unset GEO_GUARD_CONFIG_DIR GEO_GUARD_CONFIG_FILE GEO_GUARD_RC GEO_GUARD_SHELL
unset GEO_GUARD_ALLOWED GEO_GUARD_PROVIDERS GEO_GUARD_TIMEOUT GEO_GUARD_REAL_BIN GEO_GUARD_LANG
export HOME="$SANDBOX"
export GEO_GUARD_LANG=en
export SHELL=/bin/zsh

echo "e2e: sandbox HOME=$SANDBOX"

# --- seed foreign content in both config files, so the merge can be checked ---
mkdir -p "$HOME/.claude" "$HOME/.cursor"
cat > "$HOME/.claude/settings.json" <<'EOF'
{
  "model": "some-model",
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command", "command": "echo bye" }] }]
  }
}
EOF
cat > "$HOME/.cursor/hooks.json" <<'EOF'
{
  "version": 3,
  "hooks": {
    "sessionStart": [{ "command": "echo hi" }]
  }
}
EOF

# ============================================================
# 1. setup --yes with ~/.cursor present → both hooks installed
# ============================================================
node "$CLI" setup --yes --countries ES,PT --no-alias >/dev/null

CLAUDE_SETTINGS="$HOME/.claude/settings.json"
CURSOR_HOOKS="$HOME/.cursor/hooks.json"

assert_contains "$CLAUDE_SETTINGS" '"geo-guard check"'
assert_contains "$CLAUDE_SETTINGS" '"echo bye"'
assert_contains "$CLAUDE_SETTINGS" '"some-model"'

assert_contains "$CURSOR_HOOKS" '"geo-guard check"'
assert_contains "$CURSOR_HOOKS" '"echo hi"'
assert_contains "$CURSOR_HOOKS" '"version": 3'
assert_contains "$CURSOR_HOOKS" '"failClosed": true'

[ -f "$CURSOR_HOOKS.bak" ] || fail "no .bak created for hooks.json"
[ -f "$CLAUDE_SETTINGS.bak" ] || fail "no .bak created for settings.json"

# command strings must match byte-for-byte across both files (dedup invariant)
CLAUDE_CMD="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).hooks.UserPromptSubmit.flatMap(m=>m.hooks).find(h=>/geo-guard/.test(h.command)).command)" "$CLAUDE_SETTINGS")"
CURSOR_CMD="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).hooks.beforeSubmitPrompt.find(h=>/geo-guard/.test(h.command)).command)" "$CURSOR_HOOKS")"
[ "$CLAUDE_CMD" = "$CURSOR_CMD" ] || fail "command strings differ: '$CLAUDE_CMD' vs '$CURSOR_CMD'"

# idempotency: run setup again, no duplicate entries
node "$CLI" setup --yes --countries ES,PT --no-alias >/dev/null
CLAUDE_HOOK_COUNT="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).hooks.UserPromptSubmit.flatMap(m=>m.hooks).filter(h=>/geo-guard/.test(h.command)).length)" "$CLAUDE_SETTINGS")"
CURSOR_HOOK_COUNT="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).hooks.beforeSubmitPrompt.filter(h=>/geo-guard/.test(h.command)).length)" "$CURSOR_HOOKS")"
[ "$CLAUDE_HOOK_COUNT" = "1" ] || fail "duplicate claude hook after repeat setup"
[ "$CURSOR_HOOK_COUNT" = "1" ] || fail "duplicate cursor hook after repeat setup"

echo "e2e: setup (merge, dedup byte-match, idempotency) OK"

# ============================================================
# 2. uninstall → our entries gone, foreign content intact
# ============================================================
node "$CLI" uninstall --quiet >/dev/null

assert_contains "$CLAUDE_SETTINGS" '"echo bye"'
assert_contains "$CLAUDE_SETTINGS" '"some-model"'
if grep -qF '"geo-guard check"' "$CLAUDE_SETTINGS"; then fail "claude hook not removed"; fi

assert_contains "$CURSOR_HOOKS" '"echo hi"'
assert_contains "$CURSOR_HOOKS" '"version": 3'
if grep -qF '"geo-guard check"' "$CURSOR_HOOKS"; then fail "cursor hook not removed"; fi

echo "e2e: uninstall (foreign content preserved) OK"

# ============================================================
# 3. no ~/.cursor → --yes does not create a cursor hook
# ============================================================
rm -rf "$HOME/.cursor" "$CURSOR_HOOKS.bak"
node "$CLI" setup --yes --countries ES --no-alias >/dev/null
[ -f "$CURSOR_HOOKS" ] && fail "cursor hooks.json created despite absent ~/.cursor"
assert_contains "$CLAUDE_SETTINGS" '"geo-guard check"'
echo "e2e: setup without ~/.cursor (no cursor hook) OK"
node "$CLI" uninstall --quiet >/dev/null

# ============================================================
# 4. runCheck: fake local geo provider, no VPN needed
# ============================================================
SRV_OUT="$(mktemp)"
node -e 'const s=require("http").createServer((_,r)=>r.end("RU"));s.listen(0,"127.0.0.1",()=>console.log(s.address().port))' > "$SRV_OUT" &
SRV_PID=$!

PORT=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  PORT="$(cat "$SRV_OUT" 2>/dev/null || true)"
  [ -n "$PORT" ] && break
  sleep 0.2
done
[ -n "$PORT" ] || fail "fake geo provider did not start"

node "$CLI" setup --yes --countries ES --no-hook --no-cursor --no-alias >/dev/null

set +e
GEO_GUARD_PROVIDERS="http://127.0.0.1:$PORT/" node "$CLI" check >/dev/null 2>&1
BLOCKED_STATUS=$?
GEO_GUARD_ALLOWED=RU GEO_GUARD_PROVIDERS="http://127.0.0.1:$PORT/" node "$CLI" check >/dev/null 2>&1
ALLOWED_STATUS=$?
set -e

[ "$BLOCKED_STATUS" = "2" ] || fail "expected exit 2 for disallowed country, got $BLOCKED_STATUS"
[ "$ALLOWED_STATUS" = "0" ] || fail "expected exit 0 for allowed country, got $ALLOWED_STATUS"

kill "$SRV_PID" 2>/dev/null || true
SRV_PID=""
rm -f "$SRV_OUT"

echo "e2e: check (block/allow via fake provider) OK"

# ============================================================
# 5. exit 127 when the binary is missing from PATH (fail-open evidence, 2.6)
# ============================================================
set +e
env PATH=/usr/bin:/bin sh -c 'geo-guard check' >/dev/null 2>&1
MISSING_STATUS=$?
set -e
[ "$MISSING_STATUS" = "127" ] || echo "e2e: WARNING — expected 127 for missing binary, got $MISSING_STATUS (geo-guard may be on that minimal PATH)"

echo "e2e: all checks passed"
