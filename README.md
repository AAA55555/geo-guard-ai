# geo-guard-ai

[![npm version](https://img.shields.io/npm/v/geo-guard-ai.svg)](https://www.npmjs.com/package/geo-guard-ai)

**English** · [Русский](./README.ru.md)

**Geo-restriction for AI CLIs.** Lets Claude Code (or any other command) start only if your external IP resolves to an allowed country. If you're not where you should be, it blocks you before a single prompt goes out.

Also gates the **Cursor** chat (IDE and `cursor-agent`) the same way, via its own hook config — see [Cursor](#cursor) below.

Cross-platform: **macOS / Linux / Windows**. TypeScript, runtime — Node **18.20+ or 20.12+** (not 18.0–18.19, not 19.x, not 20.0–20.11: those are the versions where `spawn` refuses to launch a `.cmd` on Windows).

The CLI speaks **English or Russian**, picked automatically from your machine locale (`LC_ALL` / `LC_MESSAGES` / `LANG`), English by default. Force it with `GEO_GUARD_LANG=en|ru`.

---

## Why

Sometimes you're only allowed to use an AI tool from a specific country — company policy, a client's terms, jurisdiction, or a personal rule of "I don't work from the wrong place." The catch is how easy it is to forget: the VPN drops, you travel, the network switches — and you just keep working as if nothing happened.

`geo-guard-ai` is **insurance against "accidentally kept working from the wrong place."** It checks your country by external IP at two points:

| Checkpoint | What it does |
|---|---|
| **Command start** | typing `claude` reaches a small **shim** on your `PATH` that checks the country first, and launches the real Claude Code only if it's allowed. The same goes for `cursor-agent` |
| **Every prompt** | The Claude Code `UserPromptSubmit` hook calls `geo-guard check` before each prompt is sent; country not allowed → the prompt is blocked (exit 2) |

The second checkpoint matters: you can start a session from an allowed country, and an hour later the VPN drops — the hook catches it on your next prompt.

### Coverage

| Where | Gated by |
|---|---|
| Terminal / IDE integrated terminal | the `claude` shim on `PATH` → `geo-guard claude` wrapper |
| Claude Code extension panel | the `UserPromptSubmit` hook in `~/.claude/settings.json` |
| Cursor chat (IDE) | the `beforeSubmitPrompt` hook in `~/.cursor/hooks.json` |
| `cursor-agent` (terminal) | the `cursor-agent` shim on `PATH` → `geo-guard cursor-agent` wrapper, plus the same `~/.cursor/hooks.json` hook |

**Fail-closed behavior:** no network, or no provider answered → block. Better safe than sorry.

## How it works

1. External IP → country (ISO code) via public providers (`ifconfig.co`, `ipinfo.io` by default). Providers are queried **in parallel** — the first valid answer wins (`Promise.any`).
2. The country is checked against the `allowed` list.

The check is always **fresh** — no cache. Every `check` call (i.e. every prompt) re-detects the country from scratch, so a dropped VPN is caught on the very next prompt, not after some window.

## What it is NOT

This is **not a security mechanism**, it's everyday insurance. It's trivial to bypass:

- calling the real binary by its full path, or putting it ahead of the shim on `PATH`,
- removing the hook (Claude Code or Cursor),
- any VPN in an allowed country.

The point isn't to "protect" you, but to stop you from *accidentally* continuing to work from the wrong place.

---

## Install

```bash
npm install -g geo-guard-ai
geo-guard setup
```

Interactive `setup` asks:

1. **allowed countries** (ISO codes, comma-separated, default `NL`);
2. whether to install the **Claude Code hook** (default yes);
3. whether to install the **Cursor hook** — only asked if `~/.cursor` exists (default yes);
4. whether **Cursor needs a country list of its own** — only asked if the Cursor hook is going in (default no; see [Different countries per tool](#different-countries-per-tool));
5. whether to **gate `claude` at launch** with a shim on your `PATH` (default yes);
6. whether to **gate `cursor-agent`** the same way — only asked if `cursor-agent` is on your `PATH` (default yes);
7. which **flags the gate should pass on** — only asked when there are already some to keep (from the shim, or from an alias block being replaced), with those offered as the default;
8. which **shells** get the `PATH` entry — the detected one is offered as the default; answer `all` for every shell you have.

The default offered for the countries is whatever is configured now, so pressing Enter through a second run changes nothing.

Non-interactive (CI / scripts):

```bash
geo-guard setup --countries ES,PT --yes
```

With `--yes`, the Cursor hook is installed automatically **only if `~/.cursor` already exists**; pass `--cursor` to force it regardless (e.g. provisioning a machine ahead of installing Cursor itself), or `--no-cursor` to skip it:

```bash
geo-guard setup --yes --cursor      # force, even without ~/.cursor
geo-guard setup --yes --no-cursor   # skip
```

Re-running `setup` **does not reset** custom `timeoutMs` / `providers` in the config — it only updates `allowed`.

### Change allowed countries

```bash
geo-guard config --countries NL
```

This touches **only** `config.json` — your rc file, the shims and both hook configs are left alone. `geo-guard setup -y -c NL` also works, but it walks the whole install again; prefer `config` for a routine change.

`setup` no longer resets anything you didn't ask it to: run it without `--countries` and the configured list stays as it is (so does `timeoutMs`, `providers`, and any profile).

For a one-off check without writing the config: `GEO_GUARD_ALLOWED=NL geo-guard check`.

### Back to defaults

```bash
geo-guard config --reset                  # whole config, profiles included
geo-guard config --reset --profile cursor # one profile only (same as --unset)
```

`--reset` leaves `config.json` exactly as a fresh install would: `allowed: ["NL"]`, the default `timeoutMs` and `providers`, and no `profiles`. It does **not** reinstall or remove anything — the hook configs, the shims and the rc file are untouched, so unlike `uninstall` the guard keeps working, just on the default policy.

`setup` checks everything that could refuse the install **before** it writes anything: if `~/.claude/settings.json` or `~/.cursor/hooks.json` is not valid JSON, or its hook section is not the shape those tools write (say `"UserPromptSubmit"` holding a string), you get a message naming the file and the key, and nothing is changed at all. geo-guard will not rewrite data it doesn't recognize, and it will not leave you with a config but no hook. Entries it doesn't understand *inside* an otherwise valid list are stepped over and left in place.

## The launch gate

The point of installing is to route the familiar `claude` command through the check. geo-guard does that with a **shim**: a tiny executable named after the command, in a directory of ours that goes first on your `PATH`.

```
~/.geo-guard/bin/claude        # on Windows: ~/.geo-guard/bin/claude.cmd
```

```sh
#!/bin/sh
# >>> geo-guard-ai shim v1: claude >>>
# Managed by geo-guard-ai. Do not edit: `geo-guard setup` regenerates this file.
GG="/usr/local/bin/geo-guard"
[ -x "$GG" ] || GG=geo-guard
exec "$GG" claude "$@"
```

…and a marker-delimited block in your rc that puts that directory in front:

```sh
# >>> geo-guard-ai path begin >>>
case ":$PATH:" in
  *":/Users/me/.geo-guard/bin:"*) ;;
  *) PATH="/Users/me/.geo-guard/bin:$PATH" ;;
esac
export PATH
# <<< geo-guard-ai path end <<<
```

The `geo-guard` path is baked in at install time so the shim works from a cron job or a Makefile, where `PATH` may be nothing like yours; it falls back to a bare `geo-guard` if that path ever stops existing. The `PATH` line is written so that re-sourcing your rc does not grow `PATH` a copy at a time.

### Why not an alias

Earlier versions wrote `alias claude="geo-guard claude"` instead. An alias is a shell-interactive convenience, and it let through everything that is not an interactive prompt in the one shell whose rc we had written to:

| What you type | Alias | Shim |
|---|---|---|
| `claude` in the shell setup touched | gated | gated |
| `claude` in a shell whose rc we never wrote (you typed `bash`) | **through** | gated |
| `\claude`, `command claude` | **through** | gated |
| `claude` from a script, a Makefile, a cron job, an editor task | **through** | gated |
| `/usr/local/bin/claude` (full path) | **through** | **through** |

A `PATH` entry is read by every shell that starts, and a shim is a real file on disk, so everything that resolves a command by name goes through it. The last row is the one thing neither can do anything about — and is one of the reasons this is insurance, not security.

`setup` removes our old alias block when it finds one, and moves any flags you had added in it into the shim, so `alias claude="geo-guard claude --dangerously-skip-permissions"` becomes a shim that runs `geo-guard claude --dangerously-skip-permissions "$@"`. Your own aliases are never touched, and neither is foreign content someone put between our markers.

### Flags the gate passes on

The gate can carry flags of your own on every launch — `--dangerously-skip-permissions` being the usual one:

```sh
exec "$GG" claude --dangerously-skip-permissions "$@"
```

Set them explicitly, per command:

```bash
geo-guard setup --claude-args "--dangerously-skip-permissions"
geo-guard setup --cursor-args "--force"
geo-guard setup --claude-args ""      # clear them
```

Once set, **they survive everything**: re-running `setup` to change countries, a package update, a reinstall. Where the flags come from, in order of who decides:

1. `--claude-args` / `--cursor-args`, when you pass them (an empty value clears);
2. what the shim already carries — this is what makes them stick;
3. what our old `alias claude="geo-guard claude --dangerously-skip-permissions"` block had, for the single run that replaces it;
4. nothing.

Interactive `setup` asks about them **only when there is something to keep**, offering the current flags as the default — so pressing Enter changes nothing, and a fresh install never sees the question.

Editing the shim by hand works too, and is read back the same way. If you change the body beyond the `exec` line we generate, setup can no longer tell what it runs and leaves the whole file alone; `--force-shim` regenerates it.

**A file of that name that we did not write is never overwritten**, with or without `--force-shim`: there is no backup, and a binary of your own called `claude` is exactly the thing a launch gate must not eat. setup reports it and leaves it alone.

Your own `timeout` / `statusMessage` / `failClosed` in the hook entries (`~/.claude/settings.json`, `~/.cursor/hooks.json`) survive a re-run the same way — only the `command` is ours to rewrite.

### The `cursor-agent` gate

Cursor's terminal client gets a shim of its own, `~/.geo-guard/bin/cursor-agent`, and is handled separately everywhere: its own file, its own country policy (the `cursor` profile), its own flags, its own line in `status`, its own removal. Taking one gate away never disturbs the other.

It is installed only when `cursor-agent` is actually on your `PATH` — gating a command you don't have would replace the shell's honest "command not found" with an error of ours. Control it with `--cursor-shim` / `--no-cursor-shim`; `--no-shim` means "stay off my `PATH`" and covers both.

Why bother, when `~/.cursor/hooks.json` already guards Cursor? Because the hook only fires once a prompt is submitted, and `cursor-agent` draws a blocked submission as a status line that its next redraw wipes — you see the reason for a second or two and then it's gone. Blocking the launch says it once, up front, and it stays on screen.

### Shells

The shim directory has to be added to `PATH` in each shell you use. `setup` writes to the detected shell by default; `--shells` takes a comma-separated list, or `all` for every shell installed on the machine.

| Shell | File the `PATH` entry goes into |
|---|---|
| zsh | `~/.zshrc` |
| bash | `~/.bashrc` |
| fish | `~/.config/fish/config.fish` (as `fish_add_path -p`) |
| PowerShell | `$PROFILE` (`Documents/PowerShell/…` or `~/.config/powershell/…`) |

```bash
geo-guard setup --shells zsh,bash
geo-guard setup --shells all
```

**bash gets the entry twice, and needs to.** bash reads a different file depending on how it started, and neither covers the other: a *login* bash (what Terminal and iTerm start on macOS, and what `bash -l`, cron and `ssh host 'cmd'` produce) reads a login file and never `~/.bashrc`, while an *interactive non-login* bash (what a Linux terminal starts) reads `~/.bashrc` and never the login file. So the block goes into both.

The login file is the one bash itself would read: the first of `~/.bash_profile`, `~/.bash_login`, `~/.profile` that exists — and `~/.bash_profile` is created only when none of them does. That order matters on Linux, where `~/.profile` usually exists and `~/.bash_profile` does not: creating one would shadow everything your distribution put in `~/.profile`.

Sourcing `~/.bashrc` from the login file — the usual macOS workaround — looks like it would join the two, but it does not. Debian's stock `~/.bashrc` returns on its second line unless the shell is interactive, so `bash -lc claude` runs straight past anything appended to it. (Found by running the suite in a Debian container; see `npm run test:docker`.) It would also drag your whole interactive configuration into every login shell, which is a change to your environment we have no business making on behalf of a `PATH` entry.

**Windows:** the PowerShell profile is read by PowerShell sessions and nothing else — cmd.exe, a shortcut, Explorer and IDEs take `PATH` from the user environment. So setup also adds the shim directory to your user `PATH` (`HKCU\Environment`), which applies to every process started after it. Only the user scope is touched, the value is read and written unexpanded, and a `REG_EXPAND_SZ` stays one — an entry of yours spelled `%USERPROFILE%\…` keeps working. If that cannot be done (no PowerShell on `PATH`, or a `PATH` of an unexpected registry type), setup says so and names the directory for you to add by hand; the profile entry is still in place, so the gate works in PowerShell either way.

Force the shell another way: `GEO_GUARD_SHELL=bash`, or `GEO_GUARD_RC=/path/to/rc` to pin every operation to one file.

After setup, **open a new terminal** — that is what re-reads the rc and gives the shell the new `PATH`. Re-sourcing works too:

```bash
source ~/.zshrc   # or your own file
```

Check that it took effect:

```bash
geo-guard status   # exit 0 = the gate is in place and in effect
which claude       # should print ~/.geo-guard/bin/claude
```

`status` does not just look for files: it checks that the shim directory is on the `PATH` of the shell you are in, and that it comes **before** the real binary. That is the check that catches "setup ran, but this terminal started before it did".

## Cursor

Cursor (the IDE chat and `cursor-agent`) reads Claude Code's hook configs by itself — `~/.claude/settings.json` and the project-level equivalents — and imports any hooks it finds there. This is a one-way, load-time import, not a sync; it's controlled by Cursor's own **Third-Party Imports** setting (on by default).

`geo-guard setup` (with `~/.cursor` present, or `--cursor`) also writes a `beforeSubmitPrompt` hook straight into `~/.cursor/hooks.json`, with `failClosed: true`:

```json
{
  "version": 1,
  "hooks": {
    "beforeSubmitPrompt": [
      { "command": "geo-guard check", "timeout": 10, "failClosed": true }
    ]
  }
}
```

Cursor deduplicates hooks it imported from Claude Code against hooks already declared in its own config, matching on the exact command string. Since `geo-guard setup` writes the identical `geo-guard check` command to both files, the check still runs **once per prompt**, not twice — the explicit entry simply wins and the imported copy is dropped. You can confirm this in Cursor's hook logs (Output panel → hooks channel): look for `Removed duplicate claude-user hook for beforeSubmitPrompt: command:geo-guard check`.

**`failClosed: true`** means any hook failure blocks the prompt — network error, timeout (10s), a crash, **or the `geo-guard` binary missing from PATH** (exit 127). The last case is the one to know about: if the package gets removed some other way than `geo-guard uninstall` / `npm uninstall -g geo-guard-ai` (e.g. `--ignore-scripts`, deleting the install directory by hand, a Node version switch that drops the global bin), the Cursor chat stops working entirely — every prompt blocks — until the stale entry is removed.

**Recovering from that:** open `~/.cursor/hooks.json` (and, for symmetry, `~/.claude/settings.json`) in a text editor and delete the `geo-guard check` hook entry by hand. `geo-guard uninstall` does the same thing programmatically, but it can't run if the reason you're in this state is that the binary itself is gone.

**If Third-Party Imports is off**, the `~/.claude/settings.json` import doesn't happen at all — the explicit `~/.cursor/hooks.json` entry from `geo-guard setup` is then the *only* thing gating Cursor, and it keeps working normally.

To see exactly what a hook host sees, pipe stdout: `geo-guard check | cat`. On success it prints exactly `{"continue":true}` with no trailing newline (this is the general `geo-guard check` contract on any non-interactive stdout, not a Cursor-only detail — Claude Code sees the same bytes). In an interactive terminal, stdout stays empty and the confirmation (`✅ Geo-check: RU`) goes to stderr.

Only the **global** `~/.cursor/hooks.json` is managed; project-level `.cursor/hooks.json` is out of scope.

Verified against: Cursor 3.15.6, `cursor-agent 2026.08.25-3e8eec8`, Claude Code 2.1.227.

## Commands

```bash
geo-guard setup [options]       # configure
geo-guard uninstall [options]   # remove hook + launch gate + config
geo-guard config [options]      # show / change the allowed countries
geo-guard check                 # check for the hook (exit 0 = ok, 2 = block)
geo-guard status                # what is installed (exit 0 = all in place, 1 = not)
geo-guard claude [args…]        # wrapper: check geo and launch claude
geo-guard <command> [args…]     # same for any command
geo-guard -- <command> [args…]  # same, when the name looks like a subcommand
geo-guard version               # also --version, -v
geo-guard --help                # also help, -h
```

`setup` options:

| Option | Meaning |
|---|---|
| `-y, --yes` | no questions, defaults |
| `-c, --countries ES,PT` | allowed countries |
| `--shells zsh,bash` \| `all` | whose rc files get the `PATH` entry (default: the shell you are in; `all` = every shell installed here) |
| `--shell zsh` | one shell — the same as `--shells zsh` |
| `--claude-args "--flag …"` | flags the gate passes to `claude` on every launch; an empty value clears them. They survive later runs on their own — see [Flags the gate passes on](#flags-the-gate-passes-on) |
| `--cursor-args "--flag …"` | the same for `cursor-agent` |
| `--force-shim` | regenerate a shim **of ours** whose body you edited past the line we can read (default: leave it alone). It never overwrites a file we did not write — there is no backup, and geo-guard does not replace what it did not create |
| `--hook` / `--no-hook` | install / skip the Claude Code hook |
| `--cursor` / `--no-cursor` | install / skip the Cursor hook (default: install if `~/.cursor` exists) |
| `--shim` / `--no-shim` | install / skip the launch gate (`--no-shim` covers both commands) |
| `--cursor-shim` / `--no-cursor-shim` | install / skip the `cursor-agent` gate (default: on when `cursor-agent` is on `PATH`) |
| `--claude-countries ES,PT` | countries for Claude Code only (see [Different countries per tool](#different-countries-per-tool)) |
| `--cursor-countries PL` | countries for Cursor only |

The alias flags (`--alias`, `--no-alias`, `--cursor-alias`, `--no-cursor-alias`, `--alias-name`, `--force-alias`) are **gone**, and are refused with a message naming what replaced them rather than silently doing nothing.

`config` options — change the policy **without** touching your rc file, the shims or either hook config:

| Option | Meaning |
|---|---|
| *(none)* | print the effective config |
| `-c, --countries ES,PT` | set the allowed countries |
| `-p, --profile claude\|cursor` | apply to that tool only |
| `--unset --profile cursor` | drop the profile; that tool goes back to the shared list |
| `--reset` | everything back to the defaults, every profile dropped |
| `--reset --profile cursor` | same as `--unset --profile cursor` |

## Config

JSON:

- macOS/Linux: `~/.config/geo-guard-ai/config.json`
- Windows: `%APPDATA%\geo-guard-ai\config.json`

```json
{
  "allowed": ["NL"],
  "timeoutMs": 5000,
  "providers": [
    "https://ifconfig.co/country-iso",
    "https://ipinfo.io/country"
  ]
}
```

Env overrides the file:

| Variable | Purpose |
|---|---|
| `GEO_GUARD_ALLOWED` | `ES,PT` |
| `GEO_GUARD_TIMEOUT` | provider request timeout, **seconds** (in the file `timeoutMs` is milliseconds) |
| `GEO_GUARD_PROVIDERS` | provider URLs, space-separated (empty → no providers → block) |
| `GEO_GUARD_ALLOWED_CLAUDE` / `GEO_GUARD_ALLOWED_CURSOR` | the same, for one tool only (likewise `GEO_GUARD_TIMEOUT_*` / `GEO_GUARD_PROVIDERS_*`) — see [Different countries per tool](#different-countries-per-tool) |
| `GEO_GUARD_PROFILE` | force the profile for `geo-guard check` (`claude`, `cursor`) |
| `GEO_GUARD_REAL_BIN` | explicit path to the target binary (bypasses PATH lookup) |
| `GEO_GUARD_CONFIG_DIR` | config directory |
| `XDG_CONFIG_HOME` | not ours, but honoured: the config lives under `$XDG_CONFIG_HOME/geo-guard-ai` when it is set (macOS/Linux) |
| `GEO_GUARD_CONFIG_FILE` | path to `config.json` |
| `GEO_GUARD_SHELL` / `GEO_GUARD_RC` | shell / rc file for the `PATH` entry. If `GEO_GUARD_RC` is set, every command works **only** on that file and doesn't touch system rc files |
| `GEO_GUARD_SHIM_DIR` | where the launch-gate shims live (default `~/.geo-guard/bin`) |
| `GEO_GUARD_LANG` | force the CLI language (`en`, `ru`), overriding the auto-detected machine locale |

An empty value is not the same everywhere, and the difference is deliberate: `GEO_GUARD_ALLOWED=''` means "nothing is allowed" and blocks, because a country list you emptied on purpose should not silently fall back to a default; an empty `GEO_GUARD_TIMEOUT` carries no such meaning and falls back.

A provider must return a two-letter ISO country code as text (`ES`). A response not matching `^[A-Za-z]{2}$` is ignored. `allowed` also accepts **only** ISO alpha-2 (`ES`, `PT`); values like `SPAIN` / `ESP` are rejected by `setup` and dropped when loading the config. An empty `providers` list (`[]`) means "no providers" → country can't be determined → block.

### Different countries per tool

Claude Code and Cursor share one policy by default. When they need to differ, add a **profile** — an optional `profiles` section that overrides the shared level for one tool:

```json
{
  "allowed": ["NL", "DE"],
  "timeoutMs": 5000,
  "profiles": {
    "cursor": { "allowed": ["PL"] }
  }
}
```

Here Claude Code allows NL/DE and Cursor allows PL. A profile may override `allowed`, `timeoutMs` and `providers`; whatever it leaves out is inherited from the shared level. A config with no `profiles` behaves exactly as before.

Set it from the CLI — no rc file or hook config is touched:

```bash
geo-guard config                                   # show the effective policy per tool
geo-guard config --countries NL,DE                 # shared
geo-guard config --countries PL --profile cursor   # Cursor only
geo-guard config --unset --profile cursor          # back to the shared list
```

```
Config: ~/.config/geo-guard-ai/config.json
  shared   allowed: NL, DE (from the file)   timeout: 5s
  claude   allowed: NL, DE   (inherited)
  cursor   allowed: PL   (own profile)
```

The label says where each list actually comes from, so an env var in your shell doesn't read as a file setting: with `GEO_GUARD_ALLOWED_CURSOR=CN` set, the cursor line says `(overridden by GEO_GUARD_ALLOWED_CURSOR)`. Env never changes what is written to the file.

`setup` can do it too, at install time: `geo-guard setup --countries NL,DE --cursor-countries PL`, or by answering *"Use a different country list for Cursor?"* in the interactive flow.

Priority, highest first:

1. `GEO_GUARD_ALLOWED_CLAUDE` / `GEO_GUARD_ALLOWED_CURSOR` (and the `_TIMEOUT_` / `_PROVIDERS_` equivalents)
2. `GEO_GUARD_ALLOWED` and friends
3. `profiles.<tool>` in `config.json`
4. the top level of `config.json`
5. built-in defaults

**Which profile a launch uses.** `geo-guard <command>` picks it from the command name: `claude` runs under the `claude` profile, `cursor` and `cursor-agent` under `cursor`. Anything else — `geo-guard echo hi` — runs under the shared policy, since it belongs to no tool. So with `cursor: ["PL"]` configured, `cursor-agent` is blocked at launch on the Cursor list while `claude` starts on its own, in the same shell, in the same second.

**How the hook knows which tool is asking.** It can't be a flag in the command: Cursor imports Claude Code's hooks and drops the ones whose command string matches its own byte for byte — that exact match is what keeps the check running once per prompt instead of twice (see [Cursor](#cursor)). So both config files keep the identical `geo-guard check`, and the profile is worked out at run time from the JSON the host pipes to stdin: Claude Code sends `hook_event_name: "UserPromptSubmit"`, Cursor `"beforeSubmitPrompt"`. That's the real host, whichever file the entry came from.

If nothing is piped in at all — you ran `geo-guard check` yourself in a terminal — the **shared** policy applies, the same behaviour as before profiles existed. If a host did pipe something in but it can't be identified (garbage, or a future event name we don't know), the **strictest** policy applies instead: only countries that the shared list and every configured profile allow. Guessing one tool's policy for another is the one thing worth failing closed over.

Worth knowing what that means if your lists don't overlap — `claude: ["NL"]`, `cursor: ["PL"]` intersect to nothing, so an unidentifiable host blocks every prompt. That is the intended direction to fail in, but if a future version of either tool renames its event you'd see everything blocked rather than a warning. `geo-guard check --profile claude` tells you immediately whether that is what happened.

You can force a profile explicitly for debugging:

```bash
geo-guard check --profile cursor     # or GEO_GUARD_PROFILE=cursor
```

The stdin read is skipped entirely when no profile is configured anywhere, so the common setup pays nothing for this.

## Uninstall

```bash
geo-guard uninstall               # hook + launch gate + PATH entries + config
geo-guard uninstall --keep-config # same, but keep config.json
geo-guard uninstall -q            # quiet (no output), e.g. for scripts
npm uninstall -g geo-guard-ai     # remove the package itself
```

> ⚠️ Run `geo-guard uninstall` first, then `npm uninstall`. In npm 7+ the `preuninstall` script **does not run**, so `npm uninstall` alone won't remove the hooks and the launch gate — they'd stay behind in `~/.claude/settings.json`, `~/.cursor/hooks.json`, `~/.geo-guard/bin`, and in your rc. A shim left behind without the `geo-guard` it calls makes `claude` fail to start.

`geo-guard uninstall` removes **only what the package added**:

- our hook in `~/.claude/settings.json`;
- our hook in `~/.cursor/hooks.json`;
- both shims in `~/.geo-guard/bin`, and that directory itself if nothing else is left in it;
- the `PATH` marker block (`# >>> geo-guard-ai path begin >>>` …) in all known rc files, including whichever bash login file it went into (`~/.bash_profile`, `~/.bash_login` or `~/.profile`);
- on Windows, the shim directory in your user `PATH` — that entry only, every other one left exactly as it was;
- both alias marker blocks from earlier versions (`# >>> geo-guard-ai begin >>>` … and `# >>> geo-guard-ai cursor-agent begin >>>` …), each judged on its own — one you edited by hand is no reason to leave the other behind;
- `config.json` and the empty config directory.

If the `geo-guard` binary itself is gone (see [Cursor](#cursor) → `failClosed`), `geo-guard uninstall` can't run — remove the hook entries from both files by hand instead.

Safety on uninstall:

- **your own aliases and `PATH` lines** aren't touched, and neither is a file in `~/.geo-guard/bin` that we did not write — it stays, and so does the directory holding it;
- by default all known rc files are scanned (`~/.zshrc`, `~/.bashrc`, …). If `GEO_GUARD_RC` is set — only that one: system rc files are neither read nor written in that case;
- a marker block is removed even if you added your own flags inside it (`geo-guard claude --dangerously-skip-permissions` is still our alias, and a shim with your flags is still our shim). But if the markers hold something **foreign** — not a `geo-guard` line at all — the block is **left as is**; uninstall doesn't remove it but warns instead. You never know what important thing was added there;
- a marker block whose `# <<< geo-guard-ai end <<<` line has been deleted is **left alone even when the alias inside it is ours** — without that marker there is no way to tell where the block stops, so uninstall warns instead of guessing where to cut;
- our hook entries in both `settings.json` and `hooks.json` are removed **by matching the command string**, the same way in both files — even if you'd hand-edited `timeout` or added a flag, it's still recognized and removed; the automatic `.bak` is your safety net if that's not what you wanted;
- the rest of `settings.json` / `hooks.json` and both `.bak` files aren't touched.

## Status

`geo-guard status` answers "is this thing actually installed and working?" — it **reads only**: no file is created, changed or backed up, so it is safe to run on a broken setup.

```console
$ geo-guard status
Config: /Users/me/.config/geo-guard-ai/config.json
  shared   allowed: RU, NL (from the file)   timeout: 5s
  claude   allowed: RU, NL   (inherited)
  cursor   allowed: RU, NL   (inherited)
  ✅ config file found

Claude Code hook: /Users/me/.claude/settings.json
  ✅ our hook entry is in place

Cursor hook: /Users/me/.cursor/hooks.json
  ✖ our hook entry is missing

Launch gate (PATH shims): /Users/me/.geo-guard/bin
  ✅ claude goes through geo-guard, with flags of your own: --dangerously-skip-permissions
  ✅ cursor-agent goes through geo-guard

PATH entry: /Users/me/.zshrc
  ✅ /Users/me/.geo-guard/bin is added to PATH
  ✅ also in: /Users/me/.bashrc

Country:
  ✅ RU — allowed (allowed: RU, NL)

✖ Something is missing or broken (see the ✖ lines above).
   Fix it with: geo-guard setup
```

Exit code: `0` — everything geo-guard installs is in place, `1` — something is missing or broken, so it works in a script:

```bash
geo-guard status >/dev/null || geo-guard setup --yes
```

`setup` deliberately keeps its hands off anything you edited, so this loop converges on everything it can fix and stops short of what it cannot: a marker block holding your own content, or a file of yours where our shim would go, stays reported until you deal with it. The one thing `setup` cannot fix either is a terminal that started before it ran — for that, open a new one.

What it checks:

- the config file: whether it exists and what the effective policy is (the same output as `geo-guard config`);
- both hook files: whether our entry is there, **and** whether the file is in a shape we could install into at all. A machine with no Cursor is not a broken install — `setup` skips that hook, so `status` says the tool is not installed here and leaves it out of the exit code — a `settings.json` full of broken JSON, or a `hooks` key holding a string, shows up as a line of the report instead of a crash;
- **each launch gate separately** (the `cursor-agent` one is reported as "not needed" when that command isn't installed): whether our shim is there, **which flags it passes on** (printed, so they are visible rather than buried in a file), or whether a file that is not ours sits in its place (not fine);
- **whether the gate is actually in effect** — not just installed. `status` checks that the shim directory is on the `PATH` of the process it runs in, and that the shim comes *before* the real binary. This is what catches "setup ran, but this shell started first", which no amount of looking at files can tell you. It also checks that the real binary behind the shim can still be found: a gate that resolves to nothing would fail every launch;
- the `PATH` entry: which rc file carries it for the shell you are in, and which others also have it. On Windows it also reports the user `PATH` (`HKCU\Environment`) — what every newly started process gets, including cmd.exe and anything launched from Explorer — separately from the `PATH` of the process `status` itself runs in;
- **alias blocks left over from an earlier version**: reported so you can be rid of the dead layer — `setup` takes ours out, and says so when a block is not ours to cut;
- the current country and whether your policy allows it. This is the one part that does **not** affect the exit code: a blocked country is `geo-guard check`'s business, not a sign that the install is broken. With no network it says `could not determine` instead of failing.

## Verify

```bash
geo-guard check; echo $?                          # 0 — ok
GEO_GUARD_ALLOWED=XX geo-guard check; echo $?     # 2 — block (you're not in XX)
geo-guard check | cat                             # what a hook host sees on success: {"continue":true}
geo-guard claude --version                        # the wrapper launches claude
geo-guard status; echo $?                         # 0 — the gate is in place and in effect
which claude                                      # ~/.geo-guard/bin/claude — the gate is first on PATH
```

## Development

```bash
npm install          # husky + build (prepare)
npm run typecheck
npm run build
npm test
npm run test:e2e      # real CLI against a sandboxed $HOME, POSIX only
npm run test:pack     # npm pack → install the tarball → smoke test
```

`npm test` runs `test/*.test.cjs` — split by area (`config`, `alias`, `shim`, `shell-path`, `hooks`, `check`, `setup`, `status`, `core`), plus `hook-invariants`, which asserts over a couple of dozen shapes of `settings.json` and `hooks.json` that we never remove an entry that is not ours and never rewrite a file we took nothing out of.

`scripts/windows-smoke.ps1` covers what the two `sh` scripts above cannot: the PowerShell branch of the `PATH` entry, the `.cmd` form of the shim, `%APPDATA%` for the config, `PATHEXT` resolution and spawning a `.cmd`, reading the hook payload from stdin, and `status`. It needs Windows, so CI runs it — see below.

`npm run test:docker` runs the suite on real Linux distributions, from a machine that is not one. Which file a login bash reads is a property of the distribution, not of our code: Debian ships `~/.profile` and a `~/.bashrc` that returns before anything appended to it unless the shell is interactive, Fedora ships `~/.bash_profile`, Alpine ships neither and has no bash at all. A mocked `$HOME` in the unit suite tests our belief about that; a container tests the thing. It needs Docker (or OrbStack) running, and each distribution gets the unit suite, `test:e2e`, and a check that the PATH entry landed where that distribution's bash would read it — then that `uninstall` gives every file back byte-for-byte.


Git hooks (Husky):

- **pre-commit** — `npm run typecheck`
- **pre-push** — `npm run typecheck && npm test && npm run test:e2e && npm run test:pack`

CI runs the full suite on Ubuntu across Node 18.20 / 20 / 22, on macOS (which has a branch of its own: a login bash shell there reads `~/.bash_profile`, not `~/.bashrc` — so the entry goes into both), and on Windows across the `engines` floor and the current release. The Node version axis lives on Ubuntu; the other two are there for their platforms, not their Node versions. The Windows job runs the unit suite and `windows-smoke.ps1`; it does not run `test:e2e` or `test:pack`, which skip themselves there — a green that means "nothing was checked" is worse than no job. That job earned its place on its first run, by catching that `spawn` refuses to launch a `.cmd` without a shell (CVE-2024-27980, in the very Node versions `engines` names) — which meant `geo-guard claude` could not start Claude Code on Windows at all, since npm installs global CLIs as `.cmd` shims.

### Manual pre-release checklist

`test:e2e` sandboxes `$HOME`, so it can't see how the *real* Cursor / Claude Code read their *real* config files. Before a release, on a machine with both installed:

1. `geo-guard setup --cursor` → block a prompt in Cursor chat from a disallowed country → confirm it blocks with our message, and that the hook log shows `Removed duplicate claude-user hook for beforeSubmitPrompt: command:geo-guard check` (Output panel → hooks channel) — the sign the check ran once, not twice.
2. Turn off Cursor's **Third-Party Imports** setting → the block above should still work, gated purely by `~/.cursor/hooks.json`.
3. `geo-guard check | cat` → byte-exact `{"continue":true}`, no trailing newline, no extra output.
4. With **different countries per tool** (`geo-guard config --countries <allowed> --profile claude` and `--countries <blocked> --profile cursor`): a Claude Code prompt goes through while a Cursor prompt blocks, then swap the two lists and confirm it reverses. This is the only check that the run-time host detection works against the real hosts — the profile is read from the payload each one pipes to stdin, and `test:e2e` never sees those. Confirm the `Removed duplicate claude-user hook` line is *still* in Cursor's hook log while doing it: if that line is gone, the two config files have drifted apart and Cursor is running the check twice per prompt.

5. In a **new terminal**, `command -v claude` must point into `~/.geo-guard/bin`, and `geo-guard status` must exit 0. This is the one check that the `PATH` entry landed in a file the shell actually reads — `test:e2e` cannot see which files your terminal really sources, and `npm run test:docker` only answers for the distributions in its matrix.

Changelog — [CHANGELOG.md](./CHANGELOG.md).

License — [MIT](./LICENSE).
