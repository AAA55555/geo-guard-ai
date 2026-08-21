#!/bin/sh
# Packs the real tarball and installs it into a throwaway prefix, to catch a
# forgotten `files` entry, a broken bin shim, or a failing postinstall —
# things unit tests never see because they run against dist/ directly.
set -eu

if [ "${OS:-}" = "Windows_NT" ]; then
  echo "pack-check: skipped on Windows"
  exit 0
fi

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

WORKDIR="$(mktemp -d)"
PREFIX="$WORKDIR/prefix"
SANDBOX_HOME="$WORKDIR/home"
mkdir -p "$PREFIX" "$SANDBOX_HOME"

cleanup() {
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

fail() {
  echo "pack-check: FAIL — $1" >&2
  exit 1
}

cd "$ROOT"
TARBALL_NAME="$(npm pack --silent --pack-destination "$WORKDIR")"
TARBALL="$WORKDIR/$TARBALL_NAME"
[ -f "$TARBALL" ] || fail "npm pack did not produce $TARBALL"

# Work docs and other non-shipped files must not be in the tarball.
if tar -tzf "$TARBALL" | grep -qE 'PLAN-|/test/|/\.github/|/scripts/'; then
  fail "tarball contains files outside package.json 'files' (dev-only content leaked)"
fi
for f in bin dist README.md README.ru.md LICENSE package.json; do
  tar -tzf "$TARBALL" | grep -q "^package/$f" || fail "tarball missing expected entry: $f"
done

unset XDG_CONFIG_HOME APPDATA
unset GEO_GUARD_CONFIG_DIR GEO_GUARD_CONFIG_FILE GEO_GUARD_RC GEO_GUARD_SHELL
unset GEO_GUARD_ALLOWED GEO_GUARD_PROVIDERS GEO_GUARD_TIMEOUT GEO_GUARD_REAL_BIN GEO_GUARD_LANG
export HOME="$SANDBOX_HOME"
export GEO_GUARD_LANG=en

npm install --silent --prefix "$PREFIX" --global "$TARBALL" >/dev/null 2>&1 || {
  npm install --prefix "$PREFIX" --global "$TARBALL"
  fail "install failed"
}

BIN="$PREFIX/bin/geo-guard"
[ -x "$BIN" ] || BIN="$PREFIX/geo-guard"
[ -e "$BIN" ] || fail "geo-guard binary not found under $PREFIX after install"

VERSION="$("$BIN" --version)"
[ -n "$VERSION" ] || fail "geo-guard --version produced no output"

set +e
GEO_GUARD_PROVIDERS='' "$BIN" check >/dev/null 2>&1
STATUS=$?
set -e
[ "$STATUS" = "2" ] || fail "geo-guard check with no providers should block (exit 2), got $STATUS"

echo "pack-check: OK (version $VERSION, tarball contents clean, check blocks with no providers)"
