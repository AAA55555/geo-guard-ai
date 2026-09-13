# Test image for one Linux distribution.
#
# What is under test here is not Node — it is the distribution's own idea of
# what an account's home directory contains. Which file a login bash reads
# (~/.bash_profile, ~/.bash_login, ~/.profile) decides where the PATH entry has
# to go, and every distribution answers that differently. A mocked $HOME in the
# unit suite tests our belief about that; this tests the thing itself.
ARG BASE=node:20-bookworm-slim
FROM ${BASE}

# Some bases ship Node already; the rest get it from their own packages. How it
# arrives does not matter — nothing in the matrix is about the Node build.
RUN set -eux; \
    if ! command -v node >/dev/null 2>&1; then \
      if command -v dnf >/dev/null 2>&1; then dnf -y install nodejs tar util-linux shadow-utils && dnf clean all; \
      elif command -v pacman >/dev/null 2>&1; then pacman -Syu --noconfirm nodejs npm && pacman -Scc --noconfirm; \
      else echo 'no node, and no package manager this file knows' >&2; exit 1; \
      fi; \
    fi; \
    node --version

# Created the ordinary way, so the home directory is populated from /etc/skel
# exactly as a real account on this distribution would be. Anything else would
# be us inventing the very thing we came to observe.
RUN set -eux; \
    if command -v useradd >/dev/null 2>&1; then useradd -m -s /bin/sh tester; \
    else adduser -D -s /bin/sh tester; fi

WORKDIR /work
