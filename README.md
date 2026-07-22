# geo-guard-ai

**English** · [Русский](./README.ru.md)

**Geo-restriction for AI CLIs.** Lets Claude Code (or any other command) start only if your external IP resolves to an allowed country. If you're not where you should be, it blocks you before a single prompt goes out.

Cross-platform: **macOS / Linux / Windows**. TypeScript, runtime — Node 18+.

The CLI speaks **English or Russian**, picked automatically from your machine locale (`LC_ALL` / `LC_MESSAGES` / `LANG`), English by default. Force it with `GEO_GUARD_LANG=en|ru`.

---

## Why

Sometimes you're only allowed to use an AI tool from a specific country — company policy, a client's terms, jurisdiction, or a personal rule of "I don't work from the wrong place." The catch is how easy it is to forget: the VPN drops, you travel, the network switches — and you just keep working as if nothing happened.

`geo-guard-ai` is **insurance against "accidentally kept working from the wrong place."** It checks your country by external IP at two points:

| Checkpoint | What it does |
|---|---|
| **Command start** | `geo-guard claude …` (usually via the `claude` alias) checks the country first, and launches Claude Code only if it's allowed |
| **Every prompt** | The Claude Code `UserPromptSubmit` hook calls `geo-guard check` before each prompt is sent; country not allowed → the prompt is blocked (exit 2) |

The second checkpoint matters: you can start a session from an allowed country, and an hour later the VPN drops — the hook catches it on your next prompt.

**Fail-closed behavior:** no network, or no provider answered → block. Better safe than sorry.

## How it works

1. External IP → country (ISO code) via public providers (`ifconfig.co`, `ipinfo.io` by default). Providers are queried **in parallel** — the first valid answer wins (`Promise.any`).
2. The country is checked against the `allowed` list.

The check is always **fresh** — no cache. Every `check` call (i.e. every prompt) re-detects the country from scratch, so a dropped VPN is caught on the very next prompt, not after some window.

## What it is NOT

This is **not a security mechanism**, it's everyday insurance. It's trivial to bypass:

- running `claude` around the alias (the `geo-guard` wrapper),
- removing the hook,
- any VPN in an allowed country.

The point isn't to "protect" you, but to stop you from *accidentally* continuing to work from the wrong place.

---

## Install

```bash
npm install -g geo-guard-ai
geo-guard setup
```

Interactive `setup` asks:

1. **allowed countries** (ISO codes, comma-separated, default `ES`);
2. whether to install the **Claude Code hook** (default yes);
3. whether to add the **`claude` → `geo-guard claude` alias** to the current shell's rc (default yes).

Non-interactive (CI / scripts):

```bash
geo-guard setup --countries ES,PT --yes
```

Re-running `setup` **does not reset** custom `timeoutMs` / `providers` in the config — it only updates `allowed`.

## Alias and collisions

The point of installing is to route the familiar `claude` command through the check. To do that, a marker-delimited block is written to your rc:

```sh
# >>> geo-guard-ai begin >>>
alias claude="geo-guard claude"
# <<< geo-guard-ai end <<<
```

**If you already have your own `alias claude`** (or a function) — geo-guard *leaves it alone*:

- interactively it suggests a different name (default `cc`) or skipping the alias;
- with `--yes` it automatically picks a free name (`cc`, `ccg`, …) and tells you which.

Set the name explicitly:

```bash
geo-guard setup --alias-name cc      # run Claude Code via `cc`
```

Other people's aliases like `cc` / `c`, if already taken by something other than us, aren't overwritten either — the next free name is used.

### Shells

Auto-detected from `$SHELL` (PowerShell on Windows). Supported: **zsh, bash, fish, powershell**.

| Shell | File |
|---|---|
| zsh | `~/.zshrc` |
| bash | `~/.bashrc` (on macOS a login shell reads `~/.bash_profile` — add `source ~/.bashrc` there if needed) |
| fish | `~/.config/fish/config.fish` |
| PowerShell | `$PROFILE` (`Documents/PowerShell/…` or `~/.config/powershell/…`) |

Force it: `geo-guard setup --shell zsh`, or `GEO_GUARD_SHELL=bash` / `GEO_GUARD_RC=/path/to/rc`.

After setup, reload the rc:

```bash
source ~/.zshrc   # or your own file
```

## Commands

```bash
geo-guard setup [options]       # configure
geo-guard uninstall [options]   # remove hook + alias + config
geo-guard check                 # check for the hook (exit 0 = ok, 2 = block)
geo-guard claude [args…]        # wrapper: check geo and launch claude
geo-guard <command> [args…]     # same for any command
geo-guard --help
```

`setup` options:

| Option | Meaning |
|---|---|
| `-y, --yes` | no questions, defaults |
| `-c, --countries ES,PT` | allowed countries |
| `--shell zsh\|bash\|fish\|powershell` | target shell for the alias |
| `--alias-name cc` | alias name (default `claude`; on collision it suggests another) |
| `--hook` / `--no-hook` | install / skip the Claude hook |
| `--alias` / `--no-alias` | install / skip the alias |

## Config

JSON:

- macOS/Linux: `~/.config/geo-guard-ai/config.json`
- Windows: `%APPDATA%\geo-guard-ai\config.json`

```json
{
  "allowed": ["ES"],
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
| `GEO_GUARD_REAL_BIN` | explicit path to the target binary (bypasses PATH lookup) |
| `GEO_GUARD_CONFIG_DIR` | config directory |
| `GEO_GUARD_CONFIG_FILE` | path to `config.json` |
| `GEO_GUARD_SHELL` / `GEO_GUARD_RC` | shell / file for the alias. If `GEO_GUARD_RC` is set, `uninstall` works **only** on that file and doesn't touch system rc files |
| `GEO_GUARD_LANG` | force the CLI language (`en`, `ru`), overriding the auto-detected machine locale |

A provider must return a two-letter ISO country code as text (`ES`). A response not matching `^[A-Za-z]{2}$` is ignored. `allowed` also accepts **only** ISO alpha-2 (`ES`, `PT`); values like `SPAIN` / `ESP` are rejected by `setup` and dropped when loading the config. An empty `providers` list (`[]`) means "no providers" → country can't be determined → block.

## Uninstall

```bash
geo-guard uninstall               # hook + alias in all rc files + config
geo-guard uninstall --keep-config # same, but keep config.json
geo-guard uninstall -q            # quiet (no output), e.g. for scripts
npm uninstall -g geo-guard-ai     # remove the package itself
```

> ⚠️ Run `geo-guard uninstall` first, then `npm uninstall`. In npm 7+ the `preuninstall` script **does not run**, so `npm uninstall` alone won't remove the hook and alias — they'd stay behind in `~/.claude/settings.json` and in your rc.

`geo-guard uninstall` removes **only what the package added**:

- our hook in `~/.claude/settings.json`;
- the alias marker block (`# >>> geo-guard-ai begin >>>` …) in all known rc files;
- `config.json` and the empty config directory.

Safety on uninstall:

- **other people's aliases** (`cc` / `c` / your own `claude`) aren't touched;
- by default all known rc files are scanned (`~/.zshrc`, `~/.bashrc`, …). If `GEO_GUARD_RC` is set — only that one: system rc files are neither read nor written in that case;
- if our marker block was **edited by hand** (something other than what we wrote inside the markers) — it's **left as is**; uninstall doesn't remove it but warns instead. You never know what important thing was added there;
- the rest of `settings.json` and `settings.json.bak` aren't touched.

## Verify

```bash
geo-guard check; echo $?                          # 0 — ok
GEO_GUARD_ALLOWED=XX geo-guard check; echo $?     # 2 — block (you're not in XX)
geo-guard claude --version                        # the wrapper launches claude
```

## Development

```bash
npm install          # husky + build (prepare)
npm run typecheck
npm run build
npm test
```

Git hooks (Husky):

- **pre-commit** — `npm run typecheck`
- **pre-push** — `npm run typecheck && npm test`

License — [MIT](./LICENSE).
