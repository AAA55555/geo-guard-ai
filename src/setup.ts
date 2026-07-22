import {
  writeConfig,
  parseAllowed,
  invalidCountryTokens,
  DEFAULT_CONFIG,
  configPath,
} from './config'
import { installClaudeHook } from './claude-hook'
import {
  aliasConflictFor,
  detectShell,
  installAlias,
  listSupportedShells,
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

export function parseArgs(argv: string[]): SetupOptions {
  const opts: {
    yes: boolean
    countries: string | null
    shell: string | null
    hook: boolean | null
    alias: boolean | null
    aliasName: string | null
  } = {
    yes: false,
    countries: null,
    shell: null,
    hook: null,
    alias: null,
    aliasName: null,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === undefined) continue

    if (arg === '--yes' || arg === '-y') {
      opts.yes = true
    } else if (arg === '--countries' || arg === '-c') {
      opts.countries = argv[++i] ?? null
    } else if (arg.startsWith('--countries=')) {
      opts.countries = arg.slice('--countries='.length)
    } else if (arg === '--shell') {
      opts.shell = argv[++i] ?? null
    } else if (arg.startsWith('--shell=')) {
      opts.shell = arg.slice('--shell='.length)
    } else if (arg === '--alias-name') {
      opts.aliasName = argv[++i] ?? null
    } else if (arg.startsWith('--alias-name=')) {
      opts.aliasName = arg.slice('--alias-name='.length)
    } else if (arg === '--no-hook') {
      opts.hook = false
    } else if (arg === '--hook') {
      opts.hook = true
    } else if (arg === '--no-alias') {
      opts.alias = false
    } else if (arg === '--alias') {
      opts.alias = true
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
  let shell: ShellName = detectedShell
  let aliasName: string = opts.aliasName ?? DEFAULT_ALIAS_NAME
  let aliasSkipReason = ''

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
        countries = await prompt.ask(msg().promptCountries(), {
          defaultValue: DEFAULT_CONFIG.allowed.join(','),
        })
      }
      if (wantHook === null) {
        wantHook = await prompt.askYesNo(msg().promptInstallHook(), {
          defaultYes: true,
        })
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
    countries = countries || DEFAULT_CONFIG.allowed.join(',')
    if (wantHook === null) wantHook = true
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

  const invalid = invalidCountryTokens(countries)
  if (invalid.length > 0) {
    throw new Error(msg().invalidCountryCodes(invalid.join(', ')))
  }
  const allowed = parseAllowed(countries)
  if (allowed.length === 0) {
    throw new Error(msg().emptyCountryList())
  }

  const { file: cfgFile, config } = writeConfig({ allowed })
  console.log(msg().configWritten(cfgFile))
  console.log(msg().allowedLine(config.allowed.join(', ')))

  if (wantHook) {
    const hook = installClaudeHook()
    console.log(msg().hookInstalled(hook.file))
    console.log(msg().hookCommandLine(hook.command))
  } else {
    console.log(msg().hookSkipped())
  }

  if (wantAlias) {
    // The name was already checked for a collision above → force, to avoid throwing again.
    const alias = installAlias(shell, { name: aliasName, force: true })
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
  } else if (aliasSkipReason) {
    console.log(msg().aliasSkippedReason(aliasSkipReason))
  } else {
    console.log(msg().aliasSkipped())
  }

  console.log('')
  console.log(msg().setupDone())
  console.log(msg().configPathLine(configPath()))
}
