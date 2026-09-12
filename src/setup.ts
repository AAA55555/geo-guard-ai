import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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
  aliasConflictFor,
  assertAliasWritable,
  CURSOR_AGENT_TARGET,
  detectShell,
  installAlias,
  listSupportedShells,
  type InstallAliasResult,
  normalizeShellName,
  DEFAULT_ALIAS_NAME,
  type ShellName,
} from './shell-alias'
import { commandExists } from './resolve-bin'
import { valueAt } from './args'
import { withPromptSession, type PromptApi } from './prompt'
import { msg } from './i18n'

export type SetupOptions = Readonly<{
  yes: boolean
  countries: string | null
  shell: string | null
  hook: boolean | null
  alias: boolean | null
  cursorAlias: boolean | null
  aliasName: string | null
  forceAlias: boolean
  cursor: boolean | null
  claudeCountries: string | null
  cursorCountries: string | null
}>

/** Alias name candidates for a collision in non-interactive mode. */
const FALLBACK_ALIAS_NAMES = [DEFAULT_ALIAS_NAME, 'cc', 'ccg', 'geoclaude']

/** First free name among the candidates (desired first) or null. */
function pickFreeAliasName(shell: ShellName, desired: string): string | null {
  const candidates = [desired, ...FALLBACK_ALIAS_NAMES]
  const seen = new Set<string>()
  for (const name of candidates) {
    if (seen.has(name)) continue
    seen.add(name)
    if (!aliasConflictFor(shell, name)) return name
  }
  return null
}

/**
 * Interactively picks a free alias name.
 * Returns the name, or null if the user chose to skip the alias.
 */
async function resolveAliasNameInteractive(
  prompt: PromptApi,
  shell: ShellName,
  desired: string,
): Promise<string | null> {
  let name = desired
  let conflict = aliasConflictFor(shell, name)
  while (conflict) {
    console.log(msg().aliasConflictHeader(conflict.file, name))
    console.log(`      ${conflict.existing}`)
    console.log(msg().aliasWontTouch())
    const suggestion = name === DEFAULT_ALIAS_NAME ? 'cc' : ''
    const answer = await prompt.ask(msg().promptAliasName(), {
      defaultValue: suggestion,
    })
    if (!answer) return null
    name = answer
    conflict = aliasConflictFor(shell, name)
  }
  return name
}

/** `source` is meaningless in PowerShell — there the profile is re-read with a dot. */
function reloadHint(file: string): string {
  if (file.toLowerCase().endsWith('.ps1')) return msg().reloadRcPowershell(file)
  return msg().reloadRc(file)
}

/** Reports an alias block we deliberately left alone (custom flags or foreign content). */
function reportPreservedAlias(alias: InstallAliasResult, requestedName: string): void {
  if (alias.preserved === 'custom') {
    console.log(msg().aliasKeptCustom(alias.file))
  } else {
    console.log(msg().aliasKeptForeign(alias.file))
  }
  for (const line of (alias.existingBody ?? '').split('\n')) {
    console.log(`   ${line}`)
  }
  // --force-alias replaces an alias of ours; it does not delete foreign
  // content, so offering it there would be advice we refuse to carry out.
  if (alias.preserved === 'custom') {
    console.log(msg().aliasForceHint())
  } else {
    console.log(msg().aliasFixByHand())
  }
  if (alias.preserved === 'custom' && alias.name !== requestedName) {
    console.log(msg().aliasNameChangeSkipped(alias.name, requestedName))
  }
}

export function parseArgs(argv: string[]): SetupOptions {
  const opts: {
    yes: boolean
    countries: string | null
    shell: string | null
    hook: boolean | null
    alias: boolean | null
    cursorAlias: boolean | null
    aliasName: string | null
    forceAlias: boolean
    cursor: boolean | null
    claudeCountries: string | null
    cursorCountries: string | null
  } = {
    yes: false,
    countries: null,
    shell: null,
    hook: null,
    alias: null,
    cursorAlias: null,
    aliasName: null,
    forceAlias: false,
    cursor: null,
    claudeCountries: null,
    cursorCountries: null,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === undefined) continue

    const valueFor = (name: string): string => {
      const { value, next } = valueAt(argv, i, name)
      i = next
      return value
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
    } else if (arg === '--alias-name') {
      opts.aliasName = valueFor('--alias-name')
    } else if (arg.startsWith('--alias-name=')) {
      opts.aliasName = arg.slice('--alias-name='.length)
    } else if (arg === '--claude-countries') {
      opts.claudeCountries = valueFor('--claude-countries')
    } else if (arg.startsWith('--claude-countries=')) {
      opts.claudeCountries = arg.slice('--claude-countries='.length)
    } else if (arg === '--cursor-countries') {
      opts.cursorCountries = valueFor('--cursor-countries')
    } else if (arg.startsWith('--cursor-countries=')) {
      opts.cursorCountries = arg.slice('--cursor-countries='.length)
    } else if (arg === '--force-alias') {
      opts.forceAlias = true
    } else if (arg === '--no-hook') {
      opts.hook = false
    } else if (arg === '--hook') {
      opts.hook = true
    } else if (arg === '--no-alias') {
      opts.alias = false
    } else if (arg === '--alias') {
      opts.alias = true
    } else if (arg === '--no-cursor-alias') {
      opts.cursorAlias = false
    } else if (arg === '--cursor-alias') {
      opts.cursorAlias = true
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

export async function runSetup(argv: string[] = []): Promise<void> {
  const opts = parseArgs(argv)
  const detectedShell = detectShell()

  let countries = opts.countries
  let wantHook = opts.hook
  let wantAlias = opts.alias
  let wantCursorAlias = opts.cursorAlias
  let wantCursor = opts.cursor
  let shell: ShellName = detectedShell
  const requestedAliasName: string = opts.aliasName ?? DEFAULT_ALIAS_NAME
  let aliasName: string = requestedAliasName
  let aliasSkipReason = ''
  let claudeCountries = opts.claudeCountries
  let cursorCountries = opts.cursorCountries
  // Aliasing a command nobody has installed would replace the shell's honest
  // "command not found" with our own "binary not found".
  const cursorAgentPresent = commandExists(CURSOR_AGENT_TARGET.command)

  // `--no-alias` is the answer to "stay out of my rc file", so it covers both
  // aliases — unless the cursor one was asked for by name.
  if (opts.alias === false && opts.cursorAlias === null) wantCursorAlias = false

  // The alias name goes into the rc as `alias <name>=…` — spaces and special
  // characters are not allowed, otherwise the line breaks. Allow letters/digits/_/-/.
  if (!/^[\w.-]+$/.test(aliasName)) {
    throw new Error(msg().invalidAliasName(aliasName))
  }

  if (opts.shell) {
    const normalized = normalizeShellName(opts.shell)
    if (!normalized) {
      throw new Error(msg().unsupportedShellWithList(opts.shell, listSupportedShells().join(', ')))
    }
    shell = normalized
  }

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
      if (wantAlias === null) {
        wantAlias = await prompt.askYesNo(msg().promptAddAlias(aliasName, shell, 'claude'), {
          defaultYes: true,
        })
      }
      if (wantCursorAlias === null && cursorAgentPresent) {
        wantCursorAlias = await prompt.askYesNo(
          msg().promptAddCursorAlias(CURSOR_AGENT_TARGET.defaultName, shell),
          { defaultYes: true },
        )
      }
      if (!opts.shell) {
        const shellAnswer = await prompt.ask(msg().promptShell(listSupportedShells().join('/')), {
          defaultValue: shell,
        })
        const normalized = normalizeShellName(shellAnswer)
        if (!normalized) {
          throw new Error(msg().unsupportedShell(shellAnswer))
        }
        shell = normalized
      }

      if (wantAlias) {
        const resolved = await resolveAliasNameInteractive(prompt, shell, aliasName)
        if (resolved === null) {
          wantAlias = false
          aliasSkipReason = msg().aliasSkipUserChose()
        } else {
          aliasName = resolved
        }
      }
    })
  } else {
    if (wantHook === null) wantHook = true
    if (wantCursor === null) wantCursor = cursorDirExists()
    if (wantAlias === null) wantAlias = true
    if (wantCursorAlias === null) wantCursorAlias = cursorAgentPresent

    if (wantAlias) {
      const resolved = pickFreeAliasName(shell, aliasName)
      if (resolved === null) {
        wantAlias = false
        aliasSkipReason = msg().aliasSkipAllTaken(aliasName)
      } else {
        aliasName = resolved
      }
    }
  }

  // Everything that can refuse the install is checked before the first write.
  // setup has no rollback, so failing halfway leaves a machine with a config but
  // no hook — and the usual reason to fail is a malformed hook file, which we
  // can see up front.
  if (wantHook) assertClaudeHooksInstallable()
  if (wantCursor) assertCursorHooksInstallable()
  if (wantAlias || wantCursorAlias) assertAliasWritable(shell)

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

  // Printed once, after every rc change: two aliases in one run must not ask
  // the user to reload their shell twice.
  let rcHintFile: string | null = null

  if (wantAlias) {
    // The name was already checked for a collision above → skipConflictCheck,
    // to avoid throwing again. overwriteCustom only on an explicit --force-alias.
    const alias = installAlias(shell, {
      name: aliasName,
      skipConflictCheck: true,
      overwriteCustom: opts.forceAlias,
    })
    if (alias.preserved) {
      reportPreservedAlias(alias, aliasName)
    } else {
      console.log(msg().aliasInstalled(alias.file))
      console.log(`   ${alias.snippet.split('\n')[1] || alias.snippet}`)
      // Only when the name actually changed under us — saying "'claude' was
      // taken" on an empty rc, or when the user asked for something else
      // entirely, is simply untrue.
      if (alias.name !== requestedAliasName) {
        console.log(msg().aliasNameTaken(requestedAliasName, alias.name))
      }
      if (alias.name !== DEFAULT_ALIAS_NAME) {
        console.log(msg().aliasRunVia(alias.name))
      }
      rcHintFile = alias.file
    }
  } else if (aliasSkipReason) {
    console.log(msg().aliasSkippedReason(aliasSkipReason))
  } else {
    console.log(msg().aliasSkipped())
  }

  if (wantCursorAlias) {
    const name = CURSOR_AGENT_TARGET.defaultName
    const conflict = aliasConflictFor(shell, name)
    if (conflict) {
      // No fallback name here, unlike `claude`: an alias under another name
      // would not stand in front of the `cursor-agent` the user actually types,
      // so it would look installed and guard nothing.
      console.log(msg().cursorAliasSkippedConflict(name, conflict.existing))
    } else {
      const alias = installAlias(shell, {
        name,
        target: CURSOR_AGENT_TARGET,
        skipConflictCheck: true,
        overwriteCustom: opts.forceAlias,
      })
      if (alias.preserved) {
        reportPreservedAlias(alias, name)
      } else {
        console.log(msg().cursorAliasInstalled(alias.file))
        console.log(`   ${alias.snippet.split('\n')[1] || alias.snippet}`)
        rcHintFile = alias.file
      }
    }
  } else if (opts.cursorAlias !== false && !cursorAgentPresent) {
    console.log(msg().cursorAliasSkippedMissing(CURSOR_AGENT_TARGET.command))
  }

  if (rcHintFile) {
    console.log('')
    console.log(reloadHint(rcHintFile))
    if (shell === 'bash' && process.platform === 'darwin') {
      console.log(msg().macosBashProfileHint())
    }
  }

  console.log('')
  console.log(msg().setupDone())
  console.log(msg().configPathLine(configPath()))
}
