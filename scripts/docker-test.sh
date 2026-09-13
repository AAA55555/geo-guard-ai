#!/bin/sh
# Runs the suite on real Linux distributions, from a machine that is not Linux.
#
# Why this exists: which file a login bash reads differs per distribution, and
# that decides where the PATH entry has to go. Debian and Ubuntu ship ~/.profile
# and no ~/.bash_profile, Fedora ships ~/.bash_profile, Arch ships neither, and
# Alpine has no bash at all. A mocked $HOME tests our belief about that; a
# container tests the distribution. CI covers exactly one of these rows.
#
#   sh scripts/docker-test.sh              # the default matrix
#   sh scripts/docker-test.sh debian       # one of them
#   sh scripts/docker-test.sh arch         # x86 only, see EXTRA_DISTROS
#   sh scripts/docker-test.sh --unit-only  # skip the distro-specific check
#
# Exits non-zero if any distribution failed.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE_PREFIX=geo-guard-test

# One distribution per shape of home directory: Debian ships ~/.profile and a
# ~/.bashrc that returns early unless the shell is interactive, Fedora ships
# ~/.bash_profile, and Alpine ships neither — with busybox, musl and no bash at
# all, so the gate has to behave rather than crash where the shell it talks
# about is missing.
DISTRO_NAMES='debian alpine fedora'

# Named explicitly to run. Arch is the fourth shape — bash present, no login
# file — but it publishes no arm64 image, and under emulation its package
# install does not survive. That branch is covered by the unit suite; on an
# x86 machine `sh scripts/docker-test.sh arch` exercises it for real.
EXTRA_DISTROS='arch'

# Arch publishes no arm64 image, so on Apple Silicon it only runs emulated. It
# earns the wait: it is the one distribution here that has bash and yet ships no
# login file at all, which is the branch where we may create ~/.bash_profile.
platform_for() {
  case "$1" in
    arch) echo 'linux/amd64' ;;
    *) echo '' ;;
  esac
}

base_for() {
  case "$1" in
    debian) echo 'node:20-bookworm-slim' ;;
    alpine) echo 'node:20-alpine' ;;
    fedora) echo 'fedora:41' ;;
    arch) echo 'archlinux:latest' ;;
    *) return 1 ;;
  esac
}

unit_only=no
wanted=''
for arg in "$@"; do
  case "$arg" in
    --unit-only) unit_only=yes ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *)
      base_for "$arg" >/dev/null || { echo "unknown distribution: $arg (have: $DISTRO_NAMES $EXTRA_DISTROS)" >&2; exit 2; }
      wanted="$wanted $arg"
      ;;
  esac
done
[ -n "$wanted" ] || wanted="$DISTRO_NAMES"

if ! docker info >/dev/null 2>&1; then
  echo 'docker is not answering — start Docker (or OrbStack) and try again.' >&2
  exit 1
fi

# The repository is copied in, never mounted read-write: a container must not be
# able to leave build output or root-owned files in the working tree. .git and
# dist are skipped — one is large, the other is rebuilt inside.
container_script() {
  cat <<'SETUP'
set -eu
mkdir -p /work
tar -C /src --exclude=./.git --exclude=./dist -cf - . | tar -C /work -xf -
chown -R tester /work
su tester -c "cd /work && npm test && npm run test:e2e"
SETUP
  if [ "$unit_only" = no ]; then
    # Written as root into a directory every distribution has on PATH: a login
    # shell re-reads /etc/profile, and Debian's resets PATH outright, so nothing
    # exported from inside the check would survive into `bash -lc`.
    cat <<'GATE'
printf '#!/bin/sh\nexec node /work/dist/cli.js "$@"\n' > /usr/local/bin/geo-guard
printf '#!/bin/sh\necho REAL-CLAUDE "$@"\n' > /usr/local/bin/claude
chmod +x /usr/local/bin/geo-guard /usr/local/bin/claude
su tester -c "sh /work/scripts/docker/login-file-check.sh"
GATE
  fi
}

passed=''
failed=''

for name in $wanted; do
  base="$(base_for "$name")"
  echo ''
  echo "### $name ($base)"
  image="$IMAGE_PREFIX-$name"

  # `set -e` must not end the run on the first red distribution: the point of a
  # matrix is the whole row of answers, not the first one.
  ok=yes
  platform="$(platform_for "$name")"
  platform_arg=''
  [ -n "$platform" ] && platform_arg="--platform=$platform"

  # shellcheck disable=SC2086 -- an empty platform_arg must expand to nothing
  docker build -q $platform_arg \
    -f "$ROOT/scripts/docker/Dockerfile" \
    --build-arg "BASE=$base" \
    -t "$image" "$ROOT/scripts/docker" >/dev/null || ok=no

  if [ "$ok" = yes ]; then
    # shellcheck disable=SC2086 -- same
    docker run --rm $platform_arg -v "$ROOT:/src:ro" "$image" sh -c "$(container_script)" || ok=no
  else
    echo '  ✖ image build failed' >&2
  fi

  if [ "$ok" = yes ]; then
    echo "  ### $name OK"
    passed="$passed $name"
  else
    echo "  ✖ $name FAILED" >&2
    failed="$failed $name"
  fi
done

echo ''
echo "docker-test: passed:${passed:- none}"
if [ -n "$failed" ]; then
  echo "docker-test: FAILED:$failed" >&2
  exit 1
fi
echo 'docker-test: all distributions passed'
