import fs from 'node:fs'

import {
  writeConfig,
  loadConfig,
  validatedAllowed,
  DEFAULT_CONFIG,
  configPath,
  type ProfileName,
} from './config'
import { assertClaudeHooksInstallable, installClaudeHook } from './claude-hook'
import { assertCursorHooksInstallable, cursorDirExists, installCursorHook } from './cursor-hook'
import {
  ALIAS_TARGETS,
  assertRcWritable,
  candidateRcPaths,
  CLAUDE_TARGET,
  CURSOR_AGENT_TARGET,
  detectShell,
  listSupportedShells,
  normalizeShellName,
  parseAliasBody,
  readAliasBlock,
  uninstallAliasesEverywhere,
  type AliasTargetId,
  type ShellName,
} from './shell-alias'
import {
  installBashLoginPathEntry,
  installPathEntry,
  pathRcPathForShell,
  shellsToInstall,
} from './shell-path'
import {
  installShim,
  readShim,
  resolveGeoGuardBin,
  shimDir,
  type InstallShimResult,
  type ShimTarget,
} from './shim'
import { installUserPathEntry } from './windows-path'
import { commandExists } from './resolve-bin'
import { rawValueAt, valueAt } from './args'
import { withPromptSession } from './prompt'
import { msg } from './i18n'

export type SetupOptions = Readonly<{
  yes: boolean
  countries: string | null
  /** Older one-shell spelling of `--shells`. */
  shell: string | null
  shells: string | null
  hook: boolean | null
  shim: boolean | null
  cursorShim: boolean | null
  forceShim: boolean
  cursor: boolean | null
  claudeCountries: string | null
  cursorCountries: string | null
  /** Flags to bake into the claude shim, e.g. `--dangerously-skip-permissions`. */
  claudeArgs: string | null
  cursorArgs: string | null
}>

/**
 * The alias flags, and what replaced them.
 *
 * Kept as a refusal rather than quietly dropped: `geo-guard setup --no-alias`
 * in someone's script used to mean "do not touch my shell", and letting it
 * through as an unknown-argument error would say nothing about where that
 * behaviour went.
 */
const RETIRED_ALIAS_FLAGS: Readonly<Record<string, string>> = {
  '--alias': '--shim',
  '--no-alias': '--no-shim',
  '--cursor-alias': '--cursor-shim',
  '--no-cursor-alias': '--no-cursor-shim',
  '--force-alias': '--force-shim',
}

export function parseArgs(argv: string[]): SetupOptions {
  const opts: {
    yes: boolean
    countries: string | null
    shell: string | null
    shells: string | null
    hook: boolean | null
    shim: boolean | null
    cursorShim: boolean | null
    forceShim: boolean
    cursor: boolean | null
    claudeCountries: string | null
    cursorCountries: string | null
    claudeArgs: string | null
    cursorArgs: string | null
  } = {
    yes: false,
    countries: null,
    shell: null,
    shells: null,
    hook: null,
    shim: null,
    cursorShim: null,
    forceShim: false,
    cursor: null,
    claudeCountries: null,
    cursorCountries: null,
    claudeArgs: null,
    cursorArgs: null,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === undefined) continue

    const valueFor = (name: string): string => {
      const { value, next } = valueAt(argv, i, name)
      i = next
      return value
    }

    /** For a value that is itself a flag, e.g. --claude-args --verbose. */
    const rawValueFor = (name: string): string => {
      const { value, next } = rawValueAt(argv, i, name)
      i = next
      return value
    }

    const retired = RETIRED_ALIAS_FLAGS[arg]
    if (retired !== undefined) {
      throw new Error(msg().retiredAliasFlag(arg, retired))
    }
    if (arg === '--alias-name' || arg.startsWith('--alias-name=')) {
      throw new Error(msg().retiredAliasNameFlag('--alias-name'))
    }

    if (arg === '--yes' || arg === '-y') {
      opts.yes = true
    } else if (arg === '--countries' || arg === '-c') {
      opts.countries = valueFor('--countries')
    } else if (arg.startsWith('--countries=')) {
      opts.countries = arg.slice('--countries='.length)
    } else if (arg === '--shell') {
      opts.shell = valueFor('--shell')
    } else if (arg.startsWith('--shell=')) {
      opts.shell = arg.slice('--shell='.length)
    } else if (arg === '--shells') {
      opts.shells = valueFor('--shells')
    } else if (arg.startsWith('--shells=')) {
      opts.shells = arg.slice('--shells='.length)
    } else if (arg === '--claude-countries') {
      opts.claudeCountries = valueFor('--claude-countries')
    } else if (arg.startsWith('--claude-countries=')) {
      opts.claudeCountries = arg.slice('--claude-countries='.length)
    } else if (arg === '--claude-args') {
      opts.claudeArgs = rawValueFor('--claude-args')
    } else if (arg.startsWith('--claude-args=')) {
      opts.claudeArgs = arg.slice('--claude-args='.length)
    } else if (arg === '--cursor-args') {
      opts.cursorArgs = rawValueFor('--cursor-args')
    } else if (arg.startsWith('--cursor-args=')) {
      opts.cursorArgs = arg.slice('--cursor-args='.length)
    } else if (arg === '--cursor-countries') {
      opts.cursorCountries = valueFor('--cursor-countries')
    } else if (arg.startsWith('--cursor-countries=')) {
      opts.cursorCountries = arg.slice('--cursor-countries='.length)
    } else if (arg === '--force-shim') {
      opts.forceShim = true
    } else if (arg === '--no-hook') {
      opts.hook = false
    } else if (arg === '--hook') {
      opts.hook = true
    } else if (arg === '--no-shim') {
      opts.shim = false
    } else if (arg === '--shim') {
      opts.shim = true
    } else if (arg === '--no-cursor-shim') {
      opts.cursorShim = false
    } else if (arg === '--cursor-shim') {
      opts.cursorShim = true
    } else if (arg === '--no-cursor') {
      opts.cursor = false
    } else if (arg === '--cursor') {
      opts.cursor = true
    } else {
      throw new Error(msg().unknownSetupArg(arg))
    }
  }

  return opts
}

/**
 * `zsh,bash`, a single name, or `all` → the shells whose rc gets the PATH entry.
 * `all` is every shell actually installed here, which is what a user who lives
 * in more than one shell wants: the gate is only in effect where PATH says so.
 */
function resolveShells(raw: string, fallback: ShellName): ShellName[] {
  const list = listSupportedShells().join(', ')
  if (raw.trim().toLowerCase() === 'all') return shellsToInstall('all')

  const shells: ShellName[] = []
  for (const part of raw.split(',')) {
    const name = part.trim()
    if (!name) continue
    const normalized = normalizeShellName(name)
    if (!normalized) throw new Error(msg().unsupportedShellWithList(name, list))
    if (!shells.includes(normalized)) shells.push(normalized)
  }

  if (shells.length === 0) return [fallback]
  return shells
}

/**
 * The user's own flags, read out of the alias blocks we are about to remove.
 *
 * This is the whole of the migration: someone whose rc says
 * `alias claude="geo-guard claude --dangerously-skip-permissions"` must not
 * lose that flag because we changed how the gate is built.
 */
function aliasFlagsInRcFiles(): Map<AliasTargetId, string> {
  const flags = new Map<AliasTargetId, string>()

  for (const file of candidateRcPaths()) {
    let content: string
    try {
      content = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const target of ALIAS_TARGETS) {
      if (flags.has(target.id)) continue
      const block = readAliasBlock(content, target)
      // Only `custom` carries flags — a pristine block has none, and a foreign
      // one is not ours to read anything out of.
      if (block.kind !== 'custom') continue
      const extraArgs = parseAliasBody(block.body)?.extraArgs
      if (extraArgs) flags.set(target.id, extraArgs)
    }
  }

  return flags
}

/**
 * Flags go into the shim's `exec` line verbatim, so a newline there would split
 * the file into something we no longer generated — and could no longer read
 * back. Everything else is the user's own shell syntax and none of our business.
 */
function validatedShimArgs(raw: string): string {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) throw new Error(msg().invalidShimArgs(raw))
  return raw.trim()
}

/**
 * The flags the shim for a target should carry, and who decided them:
 *
 * 1. an explicit `--claude-args` / `--cursor-args` (an empty value clears them);
 * 2. what the shim already carries — so a reinstall, a package update or a
 *    re-run to change countries keeps flags the user put there;
 * 3. what our alias block had, for the one run that replaces it;
 * 4. nothing.
 *
 * Only (1) is allowed to overwrite flags already in place; the rest either
 * agree with the file or fill it in for the first time.
 */
function shimArgsFor(
  target: ShimTarget,
  option: string | null,
  carried: ReadonlyMap<AliasTargetId, string>,
): Readonly<{ extraArgs: string; fromOption: boolean }> {
  if (option !== null) return { extraArgs: validatedShimArgs(option), fromOption: true }

  const existing = readShim(target)
  // `parsed` matters: a shim of ours whose exec line someone rewrote tells us
  // nothing about what it runs, so its empty extraArgs is not an answer.
  if (existing.parsed && existing.extraArgs) {
    return { extraArgs: existing.extraArgs, fromOption: false }
  }

  return { extraArgs: carried.get(target.id) ?? '', fromOption: false }
}

/** `source` is meaningless in PowerShell — there the profile is re-read with a dot. */
function reloadHint(file: string): string {
  if (file.toLowerCase().endsWith('.ps1')) return msg().reloadRcPowershell(file)
  return msg().reloadRc(file)
}

/**
 * One shim: installed, already right, or deliberately left alone.
 *
 * `fromOption` only changes how the flags line reads — "kept" is a claim about
 * where they came from, and it would be untrue for flags the user just asked
 * for on the command line.
 */
function reportShim(result: InstallShimResult, fromOption: boolean): void {
  if (result.preserved === 'foreign') {
    console.log(msg().shimKeptForeign(result.file))
    return
  }
  if (result.preserved === 'custom') {
    console.log(msg().shimKeptCustom(result.file))
    if (result.extraArgs) console.log(msg().shimFlagsKept(result.extraArgs))
    console.log(msg().shimForceHint())
    return
  }

  if (result.changed) {
    console.log(msg().shimInstalled(result.file))
  } else {
    console.log(msg().shimUpToDate(result.file))
  }
  if (result.extraArgs) {
    if (fromOption) console.log(msg().shimFlagsSet(result.extraArgs))
    else console.log(msg().shimFlagsKept(result.extraArgs))
  }
}

/**
 * The user PATH entry on Windows, reported like every other step.
 *
 * A failure here is not a failed install: the PowerShell profile is already
 * written and the gate works there. Saying so, and saying what to add by hand,
 * beats both a crash and a silent half-gate.
 */
function installUserPath(): void {
  const result = installUserPathEntry(shimDir())
  if (result.outcome === 'added') {
    console.log(msg().userPathInstalled(result.dir))
    return
  }
  if (result.outcome === 'already-present') {
    console.log(msg().userPathAlreadyPresent(result.dir))
    return
  }
  console.log(msg().userPathUnavailable(result.dir, result.detail))
}

export async function runSetup(argv: string[] = []): Promise<void> {
  const opts = parseArgs(argv)
  const detectedShell = detectShell()

  let countries = opts.countries
  let wantHook = opts.hook
  let wantShim = opts.shim
  let wantCursorShim = opts.cursorShim
  let wantCursor = opts.cursor
  let claudeCountries = opts.claudeCountries
  let cursorCountries = opts.cursorCountries
  let claudeArgs = opts.claudeArgs
  let cursorArgs = opts.cursorArgs
  // Read (never written) before the questions: the flags a shim would end up
  // with are the default we offer, and that answer can come from an alias block
  // this very run is about to remove.
  const carriedFlags = aliasFlagsInRcFiles()
  // Gating a command nobody has installed would replace the shell's honest
  // "command not found" with our own "binary not found".
  const cursorAgentPresent = commandExists(CURSOR_AGENT_TARGET.command)

  // `--no-shim` is the answer to "stay off my PATH", so it covers both targets —
  // unless the cursor one was asked for by name.
  if (opts.shim === false && opts.cursorShim === null) wantCursorShim = false

  // `--shell zsh` is the older spelling of `--shells zsh`; null means "nobody
  // said", which is a question in an interactive run and the current shell in a
  // `--yes` one.
  const shellSpec = opts.shells ?? opts.shell
  let shells: ShellName[] | null = null
  if (shellSpec !== null) shells = resolveShells(shellSpec, detectedShell)

  // Rejected here rather than at install time: a bad value must not leave the
  // config and both hooks already written.
  if (claudeArgs !== null) validatedShimArgs(claudeArgs)
  if (cursorArgs !== null) validatedShimArgs(cursorArgs)

  if (!opts.yes) {
    await withPromptSession(async prompt => {
      if (!countries) {
        // The default offered is what is configured now, not the built-in one:
        // pressing Enter on an already-configured machine must change nothing.
        countries = await prompt.ask(msg().promptCountries(), {
          defaultValue: loadConfig().allowed.join(',') || DEFAULT_CONFIG.allowed.join(','),
        })
      }
      if (wantHook === null) {
        wantHook = await prompt.askYesNo(msg().promptInstallHook(), {
          defaultYes: true,
        })
      }
      if (wantCursor === null && cursorDirExists()) {
        wantCursor = await prompt.askYesNo(msg().promptInstallCursorHook(), {
          defaultYes: true,
        })
      }
      if (wantCursor && cursorCountries === null) {
        const separate = await prompt.askYesNo(msg().promptCursorSeparateCountries(), {
          defaultYes: false,
        })
        if (separate) {
          cursorCountries = await prompt.ask(msg().promptCursorCountries(), {
            defaultValue: countries ?? loadConfig().allowed.join(','),
          })
        }
      }
      if (wantShim === null) {
        wantShim = await prompt.askYesNo(msg().promptInstallShim(CLAUDE_TARGET.command), {
          defaultYes: true,
        })
      }
      if (wantCursorShim === null && cursorAgentPresent) {
        wantCursorShim = await prompt.askYesNo(
          msg().promptInstallCursorShim(CURSOR_AGENT_TARGET.command),
          { defaultYes: true },
        )
      }
      // Asked only when there is something to lose: on a fresh install the
      // answer is empty, and a question whose answer is always empty is noise.
      // Pressing Enter here keeps exactly what is in place already.
      if (wantShim && claudeArgs === null) {
        const current = shimArgsFor(CLAUDE_TARGET, null, carriedFlags).extraArgs
        if (current) {
          claudeArgs = await prompt.ask(msg().promptShimArgs(CLAUDE_TARGET.command), {
            defaultValue: current,
          })
        }
      }
      if (wantCursorShim && cursorArgs === null) {
        const current = shimArgsFor(CURSOR_AGENT_TARGET, null, carriedFlags).extraArgs
        if (current) {
          cursorArgs = await prompt.ask(msg().promptShimArgs(CURSOR_AGENT_TARGET.command), {
            defaultValue: current,
          })
        }
      }

      // Nothing to put on PATH — asking whose rc to edit would be a question
      // with no consequence.
      if (shells === null && (wantShim || wantCursorShim)) {
        const answer = await prompt.ask(msg().promptShells(listSupportedShells().join('/')), {
          defaultValue: detectedShell,
        })
        shells = resolveShells(answer, detectedShell)
      }
    })
  } else {
    if (wantHook === null) wantHook = true
    if (wantCursor === null) wantCursor = cursorDirExists()
    if (wantShim === null) wantShim = true
    if (wantCursorShim === null) wantCursorShim = cursorAgentPresent
  }

  if (claudeArgs !== null) validatedShimArgs(claudeArgs)
  if (cursorArgs !== null) validatedShimArgs(cursorArgs)

  const targetShells = shells ?? [detectedShell]

  // Everything that can refuse the install is checked before the first write.
  // setup has no rollback, so failing halfway leaves a machine with a config but
  // no hook — and the usual reason to fail is a malformed hook file, which we
  // can see up front.
  if (wantHook) assertClaudeHooksInstallable()
  if (wantCursor) assertCursorHooksInstallable()
  if (wantShim || wantCursorShim) {
    for (const shell of targetShells) assertRcWritable(pathRcPathForShell(shell))
  }

  // Validate every list before writing anything: a typo in --cursor-countries
  // must not leave the shared list already rewritten.
  const profileLists: [ProfileName, string[]][] = []
  if (claudeCountries !== null) {
    profileLists.push(['claude', validatedAllowed(claudeCountries)])
  }
  if (cursorCountries !== null) {
    profileLists.push(['cursor', validatedAllowed(cursorCountries)])
  }

  // No country list given (--yes without -c, or a profile-only run) → leave the
  // configured one alone. Passing DEFAULT_CONFIG here would silently reset a
  // machine that is already set up, which is now a normal thing to do: people
  // re-run setup to add a profile.
  let partial: { allowed?: string[] } = {}
  if (countries !== null) {
    partial = { allowed: validatedAllowed(countries) }
  }

  const { file: cfgFile, config } = writeConfig(partial)
  console.log(msg().configWritten(cfgFile))
  console.log(msg().allowedLine(config.allowed.join(', ')))

  for (const [profile, list] of profileLists) {
    const written = writeConfig({ allowed: list }, { profile })
    console.log(msg().allowedProfileLine(profile, written.config.allowed.join(', ')))
  }

  if (wantHook) {
    const hook = installClaudeHook()
    console.log(msg().hookInstalled(hook.file))
    console.log(msg().hookCommandLine(hook.command))
    if (hook.kept) console.log(msg().hookCustomKept())
  } else {
    console.log(msg().hookSkipped())
  }

  if (wantCursor) {
    const cursorHook = installCursorHook()
    console.log(msg().cursorHookInstalled(cursorHook.file))
    console.log(msg().hookCommandLine(cursorHook.command))
    if (cursorHook.kept) console.log(msg().hookCustomKept())
  } else {
    console.log(msg().cursorHookSkipped())
  }

  // The alias gate is gone, so an alias block of ours left in an rc is a dead
  // second layer. The user's own flags were read out of it above, before this
  // removes it — losing a --dangerously-skip-permissions in an upgrade would be
  // our doing. Blocks holding anything we did not write are never touched.
  for (const removal of uninstallAliasesEverywhere()) {
    if (removal.changed) console.log(msg().aliasBlockReplaced(removal.file))
    else if (removal.modified) console.log(msg().aliasBlockManuallyEdited(removal.file))
  }

  const geoGuardBin = resolveGeoGuardBin()
  const installFor = (target: ShimTarget, option: string | null): void => {
    const args = shimArgsFor(target, option, carriedFlags)
    reportShim(
      installShim(target, {
        extraArgs: args.extraArgs,
        // Asking for particular flags is saying what the file should be, so it
        // outranks the rule that keeps flags already there.
        overwriteCustom: opts.forceShim || args.fromOption,
        geoGuardBin,
      }),
      args.fromOption,
    )
  }

  if (wantShim) {
    installFor(CLAUDE_TARGET, claudeArgs)
  } else {
    console.log(msg().shimSkipped())
  }

  if (wantCursorShim) {
    installFor(CURSOR_AGENT_TARGET, cursorArgs)
  } else if (opts.cursorShim !== false && !cursorAgentPresent) {
    console.log(msg().shimSkippedMissing(CURSOR_AGENT_TARGET.command))
  }

  const changedRcFiles: string[] = []
  if (wantShim || wantCursorShim) {
    // GEO_GUARD_RC points every shell at one file, so the same rc can come up
    // twice; writing it once and reporting it once is the honest account.
    const seen = new Set<string>()
    for (const shell of targetShells) {
      const entry = installPathEntry(shell)
      if (seen.has(entry.file)) continue
      seen.add(entry.file)

      if (entry.preserved === 'foreign') {
        console.log(msg().pathEntryKeptForeign(entry.file))
      } else if (entry.alreadyPresent) {
        console.log(msg().pathEntryAlreadyPresent(entry.file))
      } else {
        console.log(msg().pathEntryInstalled(entry.file))
        changedRcFiles.push(entry.file)
      }

      // A login bash reads its login file and never ~/.bashrc, where the entry
      // above just went — and an interactive one reads ~/.bashrc and never the
      // login file. Neither covers the other, so both get an entry of their own.
      if (shell === 'bash' && process.platform !== 'win32') {
        const login = installBashLoginPathEntry()
        if (login?.changed && !seen.has(login.file)) {
          seen.add(login.file)
          console.log(msg().pathEntryLoginFile(login.file))
          changedRcFiles.push(login.file)
        }
      }
    }

    // The PowerShell profile above only ever reaches PowerShell sessions.
    // cmd.exe, a shortcut, Explorer and every IDE take PATH from the user
    // environment — so without this the gate on Windows is one door in a wall
    // full of them.
    if (process.platform === 'win32') installUserPath()
  }

  if (wantShim || wantCursorShim) {
    console.log('')
    const currentRc = pathRcPathForShell(detectedShell)
    if (changedRcFiles.includes(currentRc)) console.log(reloadHint(currentRc))
    console.log(msg().reloadForPath(shimDir()))
  }

  console.log('')
  console.log(msg().setupDone())
  console.log(msg().configPathLine(configPath()))
}
