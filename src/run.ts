import { spawn } from 'node:child_process'
import path from 'node:path'

import {
  loadConfig,
  loadStrictestConfig,
  isProfileName,
  profilesConfigured,
  readConfigFile,
  PROFILE_NAMES,
  type GeoGuardConfig,
  type ProfileName,
} from './config'
import { detectCountry, isAllowed } from './geo'
import { profileFromEvent, readHookPayload } from './hook-payload'
import { resolveRealBin } from './resolve-bin'
import { DEPTH_ENV, depthExceeded, envWithNextDepth } from './shim-paths'
import { msg } from './i18n'

/**
 * `--profile cursor` / `--profile=cursor`, for manual runs and debugging.
 * Anything else is rejected rather than ignored: a mistyped flag must not
 * silently leave us on a policy the user didn't ask for.
 */
function profileFromArgs(argv: readonly string[]): ProfileName | null {
  let raw: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === undefined) continue
    if (arg === '--profile') {
      raw = argv[++i] ?? ''
    } else if (arg.startsWith('--profile=')) {
      raw = arg.slice('--profile='.length)
    } else {
      throw new Error(msg().unknownCheckArg(arg))
    }
  }
  if (raw === null) return null
  if (!isProfileName(raw)) {
    // Fail closed: a typo must not silently fall back to the shared policy.
    throw new Error(msg().unknownProfile(raw, PROFILE_NAMES.join(', ')))
  }
  return raw
}

/** The policy `check` should apply, and the profile name to report on a block. */
type CheckPolicy = Readonly<{ config: GeoGuardConfig; profile?: ProfileName }>

/**
 * Which policy this check runs under: explicit flag, then env, then the hook
 * host's own payload.
 *
 * With no profile configured anywhere — or with nothing piped in, which means a
 * person ran `geo-guard check` by hand — this is the shared config, exactly how
 * geo-guard behaved before profiles existed. The one case that is neither is a
 * host that piped us something unidentifiable: there we fall back to the
 * strictest policy rather than quietly picking the most permissive one.
 */
async function resolveCheckPolicy(argv: readonly string[]): Promise<CheckPolicy> {
  // Read the config once and pass it down: this runs on every prompt in both
  // tools, and each extra call here is another synchronous read and parse.
  const file = readConfigFile()

  const fromArgs = profileFromArgs(argv)
  if (fromArgs) return { config: loadConfig(fromArgs, file), profile: fromArgs }

  const fromEnv = process.env.GEO_GUARD_PROFILE
  if (fromEnv !== undefined && fromEnv !== '') {
    if (!isProfileName(fromEnv)) {
      throw new Error(msg().unknownProfile(fromEnv, PROFILE_NAMES.join(', ')))
    }
    return { config: loadConfig(fromEnv, file), profile: fromEnv }
  }

  // Nothing is configured per tool — don't pay for reading stdin at all.
  if (!profilesConfigured(file)) return { config: loadConfig(undefined, file) }

  const result = await readHookPayload()
  if (result.kind === 'none') return { config: loadConfig(undefined, file) }

  if (result.kind === 'payload') {
    const profile = profileFromEvent(result.payload.hook_event_name)
    if (profile) return { config: loadConfig(profile, file), profile }
  }

  return { config: loadStrictestConfig(file) }
}

/**
 * cmd.exe quoting for one argument.
 *
 * With `shell: true` Node joins the file and the arguments with spaces and
 * hands the line to `cmd /d /s /c "<line>"` verbatim — it escapes nothing — so
 * whatever contains a space or a quote has to arrive already quoted. `/s` makes
 * cmd strip only the outermost pair, which leaves ours intact.
 *
 * Note the one thing quotes cannot stop: cmd still expands %VAR% inside them.
 * The arguments here are what the user typed after `geo-guard claude`, so that
 * is their own shell's business, but it is worth knowing.
 */
export function quoteForCmd(value: string): string {
  if (value === '') return '""'
  if (!/[\s"]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

/** The profile a wrapped command belongs to (`geo-guard claude …`). */
export function profileForCommand(command: string): ProfileName | undefined {
  const base = path
    .basename(command)
    .toLowerCase()
    .replace(/\.(cmd|bat|exe|ps1)$/, '')
  if (base === 'claude') return 'claude'
  if (base === 'cursor' || base === 'cursor-agent') return 'cursor'
  return undefined
}

export async function runCheck(argv: readonly string[] = []): Promise<void> {
  // Hook UserPromptSubmit: exit 2 = block. ANY error (broken config, EPIPE on
  // stderr, a future throw) must lead to a block, not exit 1 (fail-open).
  // Hence the whole body is in a single try, any throw → exit 2.
  try {
    const { config, profile } = await resolveCheckPolicy(argv)
    const country = await detectCountry(config)

    if (!country) {
      console.error(msg().checkNoCountryBlocked())
      process.exit(2)
    }

    if (!isAllowed(country, config)) {
      console.error(
        msg().checkCountryNotAllowedBlocked(country, config.allowed.join(','), profile),
      )
      process.exit(2)
    }

    // Silent on success when not a TTY (Claude hook). In an interactive terminal —
    // print confirmation so `geo-guard check` doesn't look like a no-op.
    if (process.stderr.isTTY) {
      console.error(msg().wrapGeoCheckOk(country))
    }
    // Control-JSON for hook hosts (Claude Code, Cursor), piped stdout only — never
    // in a TTY. Exact bytes, no trailing newline: Cursor's fallback parser requires
    // the string to end in '}' (see PLAN-cursor-hook.md 7.2 / 2.4).
    if (!process.stdout.isTTY) {
      process.stdout.write('{"continue":true}')
    }
    process.exit(0)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    try {
      console.error(msg().checkErrorBlocked(message))
    } catch {
      // stderr unavailable — block anyway
    }
    process.exit(2)
  }
}

export async function runWrap(
  command: string | undefined,
  args: string[],
  options: Readonly<{ selfEntry?: string }> = {},
): Promise<void> {
  if (!command) {
    console.error(msg().wrapNoCommand())
    console.error(msg().wrapSetupHint())
    process.exit(1)
  }

  // Backstop for the PATH gate. resolveRealBin already refuses to launch one of
  // our shims, so reaching this depth means a shim got past both of its checks —
  // and the next spawn would be another geo-guard, forever. Stop instead.
  if (depthExceeded()) {
    console.error(msg().wrapRecursionGuard(DEPTH_ENV))
    process.exit(1)
  }

  const config = loadConfig(profileForCommand(command))
  let realBin: string
  try {
    realBin = resolveRealBin(command, {
      realBinEnv: process.env.GEO_GUARD_REAL_BIN,
      selfEntry: options.selfEntry,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(msg().wrapError(message))
    process.exit(1)
  }

  const country = await detectCountry(config)
  if (!country) {
    console.error(msg().wrapNoCountryBlocked())
    process.exit(1)
  }

  if (!isAllowed(country, config)) {
    console.error(
      msg().wrapCountryNotAllowedBlocked(
        country,
        config.allowed.join(','),
        profileForCommand(command),
      ),
    )
    process.exit(1)
  }

  console.error(msg().wrapGeoCheckOk(country))

  // A direct launch everywhere except Windows batch files. Node 18.20.2 and
  // 20.12.2 (CVE-2024-27980) made spawn *refuse* .cmd and .bat without a shell:
  // it throws EINVAL instead of running them. npm installs its global CLIs as
  // .cmd shims on Windows, so `geo-guard claude` cannot start Claude Code there
  // at all without this. Found by the Windows CI job on its first run.
  const viaShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(realBin)
  const child = spawn(
    viaShell ? quoteForCmd(realBin) : realBin,
    viaShell ? args.map(quoteForCmd) : args,
    {
      stdio: 'inherit',
      windowsHide: true,
      shell: viaShell,
      // One level deeper, so a chain that somehow leads back to geo-guard is
      // counted rather than repeated.
      env: envWithNextDepth(),
    },
  )

  // Forward signals parent→child so claude is not orphaned when the wrapper is killed.
  const forwardedSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']
  const forward = (signal: NodeJS.Signals): void => {
    if (!child.killed) child.kill(signal)
  }
  for (const signal of forwardedSignals) {
    process.on(signal, forward)
  }
  const cleanupSignals = (): void => {
    for (const signal of forwardedSignals) {
      process.removeListener(signal, forward)
    }
  }

  child.on('error', err => {
    cleanupSignals()
    console.error(msg().wrapSpawnFailed(realBin, err.message))
    process.exit(1)
  })

  child.on('exit', (code, signal) => {
    cleanupSignals()
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 1)
  })
}
