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
import { installClaudeHook } from './claude-hook'
import { installCursorHook } from './cursor-hook'
import {
  aliasConflictFor,
  detectShell,
  installAlias,
  listSupportedShells,
  type InstallAliasResult,
  normalizeShellName,
  DEFAULT_ALIAS_NAME,
  type ShellName,
} from './shell-alias'
import { withPromptSession, type PromptApi } from './prompt'
import { msg } from './i18n'

export type SetupOptions = Readonly<{
  yes: boolean
  countries: string | null
  shell: string | null
  hook: boolean | null
  alias: boolean | null
  aliasName: string | null
  forceAlias: boolean
  cursor: boolean | null
  claudeCountries: string | null
  cursorCountries: string | null
}>

/** Whether `~/.cursor` exists — gate for the cursor-hook question in --yes mode. */
function cursorDirExists(): boolean {
  return fs.existsSync(path.join(os.homedir(), '.cursor'))
}

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
  console.log(msg().aliasForceHint())
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
      const value = argv[++i]
      if (value === undefined || value.startsWith('-')) {
        throw new Error(msg().optionNeedsValue(name))
      }
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
  let wantCursor = opts.cursor
  let shell: ShellName = detectedShell
  let aliasName: string = opts.aliasName ?? DEFAULT_ALIAS_NAME
  let aliasSkipReason = ''
  let claudeCountries = opts.claudeCountries
  let cursorCountries = opts.cursorCountries

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
        wantAlias = await prompt.askYesNo(msg().promptAddAlias(aliasName, shell), {
          defaultYes: true,
        })
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
      if (alias.name !== DEFAULT_ALIAS_NAME) {
        console.log(msg().aliasClaudeTaken(alias.name))
        console.log(msg().aliasRunVia(alias.name))
      }
      console.log('')
      console.log(msg().reloadRc(alias.file))
      if (shell === 'bash' && process.platform === 'darwin') {
        console.log(msg().macosBashProfileHint())
      }
    }
  } else if (aliasSkipReason) {
    console.log(msg().aliasSkippedReason(aliasSkipReason))
  } else {
    console.log(msg().aliasSkipped())
  }

  console.log('')
  console.log(msg().setupDone())
  console.log(msg().configPathLine(configPath()))
}
