/**
 * `geo-guard config` — read and change config.json, and nothing else.
 *
 * Deliberately separate from `setup`: changing the allowed countries should not
 * make you re-run a command that also rewrites your rc file and both hook
 * configs. This is the command to reach for day to day.
 */

import {
  configPath,
  hasProfileSection,
  isProfileName,
  loadConfig,
  removeProfile,
  resetConfig,
  validatedAllowed,
  writeConfig,
  PROFILE_NAMES,
  type ProfileName,
} from './config'
import { msg } from './i18n'

export type ConfigOptions = Readonly<{
  countries: string | null
  profile: ProfileName | null
  reset: boolean
  /** `--unset` is `--reset --profile <name>`; tracked apart only to keep its own wording. */
  unset: boolean
}>

export function parseConfigArgs(argv: string[]): ConfigOptions {
  let countries: string | null = null
  let profile: ProfileName | null = null
  let reset = false
  let unset = false

  const takeProfile = (raw: string | null): ProfileName => {
    if (raw === null || !isProfileName(raw)) {
      throw new Error(msg().unknownProfile(String(raw), PROFILE_NAMES.join(', ')))
    }
    return raw
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

    if (arg === '--countries' || arg === '-c') {
      countries = valueFor('--countries')
    } else if (arg.startsWith('--countries=')) {
      countries = arg.slice('--countries='.length)
    } else if (arg === '--profile' || arg === '-p') {
      profile = takeProfile(valueFor('--profile'))
    } else if (arg.startsWith('--profile=')) {
      profile = takeProfile(arg.slice('--profile='.length))
    } else if (arg === '--reset') {
      reset = true
    } else if (arg === '--unset') {
      unset = true
      reset = true
    } else {
      throw new Error(msg().unknownConfigArg(arg))
    }
  }

  return { countries, profile, reset, unset }
}

/** Prints the effective config: the shared policy and what each tool ends up with. */
function showConfig(): void {
  console.log(msg().configPathLine(configPath()))

  const shared = loadConfig()
  console.log(msg().configLineShared(shared.allowed.join(', '), shared.timeoutMs / 1000))

  for (const profile of PROFILE_NAMES) {
    const config = loadConfig(profile)
    let source = msg().configSourceInherited()
    if (hasProfileSection(profile)) source = msg().configSourceProfile()
    console.log(msg().configLineProfile(profile, config.allowed.join(', '), source))
  }
}

/** One operation, two spellings: the error has to name the flag the user typed. */
function withCountriesError(unset: boolean): string {
  if (unset) return msg().configUnsetWithCountries()
  return msg().configResetWithCountries()
}

/** `--reset`, and its profile-scoped spelling `--unset --profile <name>`. */
function runReset(opts: ConfigOptions): void {
  // --unset is meaningless without a profile; --reset without one is the full reset.
  if (opts.unset && !opts.profile) {
    throw new Error(msg().configUnsetNeedsProfile(PROFILE_NAMES.join(', ')))
  }
  if (opts.countries !== null) {
    throw new Error(withCountriesError(opts.unset))
  }

  if (opts.profile) {
    const { removed } = removeProfile(opts.profile)
    if (removed) {
      console.log(msg().configProfileUnset(opts.profile))
    } else {
      console.log(msg().configProfileNotSet(opts.profile))
    }
  } else {
    const { file } = resetConfig()
    console.log(msg().configResetDone(file))
  }

  console.log('')
  showConfig()
}

export async function runConfig(argv: string[] = []): Promise<void> {
  const opts = parseConfigArgs(argv)

  if (opts.reset) {
    runReset(opts)
    return
  }

  if (opts.countries === null) {
    showConfig()
    return
  }

  const allowed = validatedAllowed(opts.countries)
  const { file, config } = writeConfig(
    { allowed },
    opts.profile ? { profile: opts.profile } : {},
  )

  console.log(msg().configWritten(file))
  if (opts.profile) {
    console.log(msg().allowedProfileLine(opts.profile, config.allowed.join(', ')))
  } else {
    console.log(msg().allowedLine(config.allowed.join(', ')))
  }
  console.log('')
  showConfig()
}
