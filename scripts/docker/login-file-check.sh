#!/bin/sh
# Runs inside a distribution container, as an ordinary account whose home came
# from that distribution's /etc/skel. Everything here is asserted against the
# rule, not against a per-distro table of expected answers: the rule is what the
# code implements, and a table would only record today's distributions.
#
# The rule: a login bash reads the FIRST of ~/.bash_profile, ~/.bash_login,
# ~/.profile that exists, and never ~/.bashrc; an interactive non-login bash
# reads ~/.bashrc and none of those. So the PATH entry has to be in both the
# first-existing login file and ~/.bashrc — and ~/.bash_profile may only be
# created when bash would read none of the three, since writing one next to an
# existing ~/.profile silently takes its place.
set -eu

CLI=/work/dist/cli.js
CONFIG_DIR="$HOME/.config-sandbox"
PATH_MARKER='# >>> geo-guard-ai path begin >>>'

# No provider is reachable here, and none is needed: setup never looks up a
# country, and a launch that cannot determine one is blocked — which is the
# outcome this test wants to see anyway.
export GEO_GUARD_PROVIDERS=
export GEO_GUARD_LANG=en
export GEO_GUARD_CONFIG_DIR="$CONFIG_DIR"
export GEO_GUARD_CONFIG_FILE="$CONFIG_DIR/config.json"
unset GEO_GUARD_RC GEO_GUARD_SHIM_DIR GEO_GUARD_SHELL GEO_GUARD_ALLOWED 2>/dev/null || true

DISTRO="$(. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-$ID}" || echo unknown)"
say() { echo "  $*"; }
fail() { echo "  ✖ $*" >&2; exit 1; }

# Byte comparison through node, not cmp: a minimal Fedora image ships neither
# cmp nor diff, and a check that silently turns into "tool missing" is worse
# than no check. node is here by definition — it is what runs the CLI.
same_file() {
  node -e '
    const fs = require("fs")
    const a = fs.readFileSync(process.argv[1])
    const b = fs.readFileSync(process.argv[2])
    process.exit(a.equals(b) ? 0 : 1)
  ' "$1" "$2"
}

LOGIN_FILES="$HOME/.bash_profile $HOME/.bash_login $HOME/.profile"

# --- what this distribution gives a fresh account --------------------------
existing=''
for f in $LOGIN_FILES; do
  [ -e "$f" ] && existing="$existing $f"
done

expected=''
for f in $LOGIN_FILES; do
  if [ -e "$f" ]; then expected="$f"; break; fi
done
[ -n "$expected" ] || expected="$HOME/.bash_profile"

echo "== $DISTRO"
say "login files present: ${existing:- (none)}"
say "the login file bash reads: $expected"

# Byte-for-byte copies, to prove uninstall puts them back.
BACKUP="$HOME/.login-file-backup"
mkdir -p "$BACKUP"
for f in $existing; do cp "$f" "$BACKUP/$(basename "$f")"; done

# /usr/local/bin/geo-guard and /usr/local/bin/claude are put there by the
# runner, as root: a login shell re-reads /etc/profile, which on Debian resets
# PATH outright, so anything we exported here would be gone by then. They stand
# in for an installed package and an installed Claude Code — nothing about the
# distribution itself is faked.
command -v geo-guard >/dev/null || fail 'the runner did not provide /usr/local/bin/geo-guard'
command -v claude >/dev/null || fail 'the runner did not provide a stand-in claude'

# --- install ----------------------------------------------------------------
node "$CLI" setup --yes --countries NL --shells bash --no-hook --no-cursor >/dev/null

grep -qF "$PATH_MARKER" "$expected" || fail "the PATH entry is not in $expected"
say "✅ the PATH entry is in $expected"

grep -qF "$PATH_MARKER" "$HOME/.bashrc" || fail 'the PATH entry is not in ~/.bashrc'
say '✅ the PATH entry is in ~/.bashrc'

# The heart of it: a file that did not exist must not have been created, or it
# would shadow the one the distribution actually ships.
for f in $LOGIN_FILES; do
  [ "$f" = "$expected" ] && continue
  case " $existing " in
    *" $f "*) continue ;;
  esac
  [ -e "$f" ] && fail "$f was created — it now shadows $expected"
done
say '✅ no login file was created over the one this distribution ships'

# Files we were not meant to write stay byte-identical.
for f in $existing; do
  [ "$f" = "$expected" ] && continue
  same_file "$f" "$BACKUP/$(basename "$f")" || fail "$f was modified and should not have been"
done

# --- does the gate actually gate? -------------------------------------------
if command -v bash >/dev/null 2>&1; then
  # Non-interactive login: `ssh host cmd`, cron, CI. This is the shape that a
  # distribution's early-returning ~/.bashrc silently drops.
  resolved="$(bash -lc 'command -v claude' 2>/dev/null || true)"
  case "$resolved" in
    "$HOME/.geo-guard/bin/claude") say "✅ login bash resolves claude to the shim" ;;
    *) fail "login bash resolves claude to '$resolved', not the shim" ;;
  esac

  out="$(bash -lc 'claude' 2>&1 || true)"
  case "$out" in
    *'Launch blocked'*) say '✅ the launch is blocked, and the real binary never ran' ;;
    *REAL-CLAUDE*) fail 'the real binary ran — the gate did not hold' ;;
    *) fail "unexpected output from the gated launch: $out" ;;
  esac
else
  say 'ⓘ no bash here — the login-file rule still applied, nothing to launch through'
fi

# --- uninstall puts everything back -----------------------------------------
node "$CLI" uninstall --quiet >/dev/null 2>&1 || node "$CLI" uninstall -q >/dev/null

for f in $LOGIN_FILES; do
  [ -e "$f" ] || continue
  grep -qF "$PATH_MARKER" "$f" && fail "$f still carries our block after uninstall"
done
grep -qF "$PATH_MARKER" "$HOME/.bashrc" && fail '~/.bashrc still carries the PATH entry after uninstall'
say '✅ uninstall removed every block it wrote'

for f in $existing; do
  same_file "$f" "$BACKUP/$(basename "$f")" || fail "$f did not come back to what it was"
done
say '✅ the files this distribution shipped are byte-for-byte as they were'

[ -e "$HOME/.geo-guard/bin/claude" ] && fail 'the shim survived uninstall'
say '✅ the shim is gone'

echo "  == $DISTRO OK"
