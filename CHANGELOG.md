# Changelog

Notable changes per release. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Entries for `0.0.2` … `0.0.6` were written after the fact, reconstructed from the git history — they
say what each release changed, not everything each one touched.

## [0.0.7] — 2026-09-13

The launch gate stopped being a shell alias and became a PATH shim.

### Why

An alias is a substitution the shell makes while parsing a line you typed by hand. It never applied to
anything else: not to `\claude`, not to `command claude`, not to an absolute path, not to a call from a
script or a Makefile — and not at all in a shell whose rc file we had never written to. Installing it in
one rc, chosen from `$SHELL`, meant that opening `bash` on a machine set up under `zsh` left the launch
gate simply absent, with no sign that anything was missing. Covering more rc files would have narrowed
that hole without closing it.

A shim is a real executable in a directory that comes first on `PATH`, so it stands in front of every
launch by name, in any shell, interactive or not.

Note what did *not* change: the `UserPromptSubmit` hooks for Claude Code and Cursor never depended on
the shell, so prompt-time checks behaved the same throughout.

### Added

- `~/.geo-guard/bin` with one shim per tool — `claude` and `cursor-agent` (`.cmd` on Windows). Each is
  installed, classified and removed on its own, so removing one never disturbs the other.
- A marker block in the shell rc that prepends that directory to `PATH`, written so that it is
  idempotent in the shell itself, not only at install time.
- For bash the entry goes into two files, because bash reads a different one depending on how it
  started and neither covers the other: `~/.bashrc` for interactive shells, and the login file — the
  first of `~/.bash_profile`, `~/.bash_login`, `~/.profile` that exists, `~/.bash_profile` only when
  none of them does — for login ones. Sourcing `~/.bashrc` from the login file would not join the
  two: a distribution's stock `~/.bashrc` returns before anything appended to it unless the shell is
  interactive, so `bash -lc claude` ran past the entry entirely. Found by running the suite in a
  Debian container.
- `npm run test:docker` runs the suite on real Linux distributions (Debian, Fedora, Alpine) in
  containers. Which file a login bash reads is a property of the distribution, and a mocked `$HOME`
  only ever tests our belief about it.
- On Windows the shim directory also goes into the user `PATH` (`HKCU\Environment`), which is what
  cmd.exe, a shortcut, Explorer and every IDE read. The PowerShell profile entry stays: it takes effect
  in the session you are already in, and it is the fallback when the user `PATH` cannot be written.
  Only the user scope is ever read or written, the value is handled unexpanded, and `REG_EXPAND_SZ` is
  preserved — so nobody else's `%USERPROFILE%\…` entry stops expanding. If none of that is possible
  (no PowerShell, a `PATH` of an unexpected registry type), `setup` says so and names the directory to
  add by hand instead of guessing.
- `setup --shells <list|all>` — whose rc files get the `PATH` entry. `--shell <name>` is the
  single-shell form.
- `setup --shim / --no-shim`, `--cursor-shim / --no-cursor-shim`.
- `setup --claude-args "…"` / `--cursor-args "…"` — flags the gate passes to the tool on every launch
  (an empty value clears them). They survive re-running `setup`, a reinstall, and a move to another
  machine: the shim itself is the record of them, so nothing has to be re-typed.
- `setup --force-shim` regenerates a shim of ours whose body was edited beyond the `exec` line we know
  how to read. Changing the flags is `--claude-args` / `--cursor-args`; this is only for a file we can
  no longer interpret, which is otherwise left untouched and reported.
- Two independent guards against the recursion a shim invites: `resolveRealBin` refuses to launch a
  shim (recognized both by directory and by the marker in its first lines, so a stray copy is caught
  too), and `GEO_GUARD_DEPTH` stops a chain that somehow got past that, instead of forking forever.
- On Windows, `status` also reports whether the shim directory is in the user `PATH` (what every new
  process gets) and in the `PATH` of the running process (what this terminal has).
- `status` now answers whether the gate *works*, not whether files exist: per tool it reports the shim,
  whether the shim directory is actually on `PATH` ahead of the real binary, and whether the real
  binary is still reachable behind it. A terminal opened before `setup` is reported as not yet in
  effect.
- `GEO_GUARD_SHIM_DIR` overrides the shim directory.
- This changelog.

### Changed

- `setup` no longer installs shell aliases. It removes the alias blocks it wrote previously, carrying
  any flags of yours out of them and into the shim, so a customized
  `alias claude="geo-guard claude --flag"` keeps working as a gate that now covers more.
- `uninstall` removes the shims, the `PATH` entries (on Windows including the one in the user `PATH`,
  leaving every other entry as it was), and any alias blocks left from earlier versions. It also cleans
  `~/.bash_login` and `~/.profile`, which the login-file choice above can write to.

### Removed

- `setup --alias`, `--no-alias`, `--alias-name`, `--cursor-alias`, `--force-alias`. They fail with an
  explanation and the flag that replaces them, rather than being accepted and quietly ignored.

### Migration

1. `geo-guard setup` — removes the old alias blocks and installs the shims.
2. Open a new terminal. The `PATH` entry only applies to shells started after it was written.
3. `geo-guard status` — exits non-zero while anything is still missing.

Flags you had on the alias are carried over automatically on that first run. To set or change them
later, use `--claude-args` / `--cursor-args`.

### Unchanged, and worth saying out loud

Nothing we did not write is ever overwritten or deleted — a foreign file where a shim would go, and
foreign content between our markers, are both left exactly as they are and reported instead.

## [0.0.6] — 2026-09-13

Launch gating for Cursor, and a long pass over what the tool *claimed* versus what it did.

### Added

- `cursor-agent` is gated at launch by an alias of its own, in its own marker block. The Cursor hook
  already blocked prompts, but `cursor-agent` redraws over a blocked submission, so the message was
  gone before it could be read — saying it once at launch keeps it on screen.
- `geo-guard status`: what is installed, what works, exit 0 or 1. The win32 code path went under CI
  with it.
- A macOS job in CI, alongside Ubuntu and Windows.

### Fixed

- Launching a `.cmd` on Windows. Node 18.20.2 / 20.12.2 (CVE-2024-27980) made `spawn` refuse batch
  files without a shell, and npm installs global CLIs as `.cmd` shims — so `geo-guard claude` could
  not start Claude Code on Windows at all. Caught by the Windows CI job on its first run.
- `--force-alias` no longer deletes content it did not write.
- The interactive `setup` survives being piped, and stops misreporting which alias it installed.
- `status` stopped calling a healthy install broken, and stopped asserting things about files that
  were not true.
- An alias block is read one way, not two: `status` and `setup` had drifted into different answers
  about a block whose END marker was missing.
- The config is read once per report instead of once per line.

### Changed

- Both READMEs corrected to match what the code actually does, and to cover what they had left out —
  including which profile a launch runs under, and that a machine without Cursor is not broken.
- The test suite split out of one `unit.test.cjs` into files per area.

## [0.0.5] — 2026-09-12

Per-tool policies, and a refusal to mangle files it does not understand.

### Added

- Profiles: separate allowed-country lists for Claude Code and Cursor, resolved from the payload each
  host pipes to the hook, with the shared list as the fallback.
- `config --reset` puts the configuration back to defaults.

### Changed

- Re-running `setup` keeps an alias or hook entry you customized instead of overwriting it.
- A hook file we cannot parse is refused outright rather than rewritten — there is no backup of it.

## [0.0.4] — 2026-08-21

### Added

- Cursor support: the `beforeSubmitPrompt` hook in `~/.cursor/hooks.json`, and the tests around it.
- README instructions for changing the allowed countries, and an npm version badge.

## [0.0.3] — 2026-07-22

### Added

- ISO alpha-2 validation for country codes, so a typo is refused instead of quietly allowing nothing.
- CI, and a postinstall message in the user's language.

### Changed

- The geo-check success line prints only on an interactive TTY, so it cannot end up inside a hook's
  piped output.

## [0.0.2] — 2026-07-22

First published version: the country check, the Claude Code `UserPromptSubmit` hook, the alias-based
launch gate, `setup` / `uninstall` / `config` / `check`, and bilingual (en/ru) docs and CLI output.
