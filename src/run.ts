import { spawn } from 'node:child_process'

import { loadConfig } from './config'
import { detectCountry, isAllowed } from './geo'
import { resolveRealBin } from './resolve-bin'
import { msg } from './i18n'

export async function runCheck(): Promise<void> {
  // Hook UserPromptSubmit: exit 2 = block. ANY error (broken config, EPIPE on
  // stderr, a future throw) must lead to a block, not exit 1 (fail-open).
  // Hence the whole body is in a single try, any throw → exit 2.
  try {
    const config = loadConfig()
    const country = await detectCountry(config)

    if (!country) {
      console.error(msg().checkNoCountryBlocked())
      process.exit(2)
    }

    if (!isAllowed(country, config)) {
      console.error(msg().checkCountryNotAllowedBlocked(country, config.allowed.join(',')))
      process.exit(2)
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

  const config = loadConfig()
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
    console.error(msg().wrapCountryNotAllowedBlocked(country, config.allowed.join(',')))
    process.exit(1)
  }

  console.error(msg().wrapGeoCheckOk(country))

  // No shell. On Windows, Node itself wraps .cmd/.bat into cmd.exe with
  // cmd-specific argument escaping (patched in 18.20+/20.12+, see engines),
  // which is safer than invoking cmd.exe by hand. On *nix — a direct binary launch.
  const child = spawn(realBin, args, {
    stdio: 'inherit',
    windowsHide: true,
  })

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
