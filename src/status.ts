/**
 * `geo-guard status` — say what is installed, and change nothing.
 *
 * Read-only on purpose: this is the command you reach for when you suspect
 * something is already wrong, so it must not "helpfully" create a config, a
 * hook file or a .bak while looking. For the same reason every section runs
 * inside its own try/catch — a settings.json full of broken JSON becomes one
 * line of the report instead of hiding the four checks below it. That is the
 * opposite of what setup does, where a malformed file is a hard stop because
 * the very next step would write into it.
 */

import fs from 'node:fs'

import { assertClaudeHooksInstallable, claudeHookInstalled, settingsPath } from './claude-hook'
import { assertCursorHooksInstallable, cursorHookInstalled, cursorHooksPath } from './cursor-hook'
import { configPath, loadConfig, readConfigFile, type GeoGuardConfigFile } from './config'
import { showConfig } from './config-cmd'
import { detectCountry, isAllowed } from './geo'
import { detectShell, readAliasBlock, rcPathForShellResolved } from './shell-alias'
import { msg } from './i18n'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The config path, the effective policy, and whether the file is actually there. */
function reportConfig(parsed: GeoGuardConfigFile | null): boolean {
  const file = configPath()
  try {
    // Same output as `geo-guard config` with no arguments — one place decides
    // how a policy is printed.
    showConfig(parsed ?? undefined)
  } catch (err) {
    // showConfig prints the path before it reads anything, so by the time it
    // can fail that line is already out — printing it again here would double it.
    console.log(msg().statusProblem(errorMessage(err)))
    return false
  }

  if (!fs.existsSync(file)) {
    console.log(msg().statusConfigMissing())
    return false
  }
  console.log(msg().statusConfigPresent())
  return true
}

/**
 * One hook file. `assertInstallable` is the same guard setup runs — here its
 * error is a line of the report, not a crash: "we could not install into this
 * file even if you asked" is exactly what the user wants to be told.
 */
function reportHook(
  header: (file: string) => string,
  pathOf: () => string,
  assertInstallable: () => void,
  isInstalled: () => boolean,
): boolean {
  let file: string
  try {
    file = pathOf()
  } catch (err) {
    console.log(msg().statusProblem(errorMessage(err)))
    return false
  }
  console.log(header(file))

  if (!fs.existsSync(file)) {
    console.log(msg().statusHookFileMissing())
    return false
  }

  try {
    assertInstallable()
    if (!isInstalled()) {
      console.log(msg().statusHookMissing())
      return false
    }
  } catch (err) {
    console.log(msg().statusProblem(errorMessage(err)))
    return false
  }

  console.log(msg().statusHookInstalled())
  return true
}

/** The marker block in the rc file: ours, ours-with-your-flags, or someone else's. */
function reportAlias(): boolean {
  let file: string
  let content: string
  try {
    // Inside the try: resolving the path reads the environment and the home
    // directory, and a report must not die on one section's bad luck.
    file = rcPathForShellResolved(detectShell())
    console.log(msg().statusAliasHeader(file))

    if (!fs.existsSync(file)) {
      console.log(msg().statusAliasFileMissing())
      return false
    }
    content = fs.readFileSync(file, 'utf8')
  } catch (err) {
    console.log(msg().statusProblem(errorMessage(err)))
    return false
  }

  // The same reading setup uses — answering this question twice is how the two
  // came to disagree about a block with no END marker.
  const block = readAliasBlock(content)

  if (block.kind === 'none') {
    console.log(msg().statusAliasMissing())
    return false
  }

  if (block.broken) {
    // setup can repair a block of ours; anything else it refuses to touch, so
    // saying "re-run setup" there would send the user in a circle.
    if (block.kind === 'pristine') {
      console.log(msg().statusAliasBrokenRepairable(block.body))
    } else {
      console.log(msg().statusAliasBroken(block.body))
    }
    return false
  }

  if (block.kind === 'pristine') {
    console.log(msg().statusAliasPristine(block.name ?? ''))
    return true
  }
  // Still our alias, still routed through the geo-check — the user just added
  // flags of their own, which setup deliberately keeps.
  if (block.kind === 'custom') {
    console.log(msg().statusAliasCustom(block.body))
    return true
  }

  console.log(msg().statusAliasForeign(block.body))
  return false
}

/**
 * Where the machine looks like it is. Informational only — a blocked country is
 * `check`'s business, not a sign that the install is broken, so it is kept out
 * of the exit code.
 */
async function reportCountry(file: GeoGuardConfigFile): Promise<void> {
  console.log(msg().statusCountryHeader())
  try {
    // detectCountry honours config.timeoutMs and aborts on it, so this cannot
    // hang the report waiting on a dead provider.
    const config = loadConfig(undefined, file)
    const country = await detectCountry(config)
    if (!country) {
      console.log(msg().statusCountryUnknown())
      return
    }

    const allowed = config.allowed.join(', ')
    if (isAllowed(country, config)) {
      console.log(msg().statusCountryAllowed(country, allowed))
    } else {
      console.log(msg().statusCountryNotAllowed(country, allowed))
    }
  } catch (err) {
    console.log(msg().statusProblem(errorMessage(err)))
  }
}

/** true — everything geo-guard installs is in place (the caller turns that into an exit code). */
export async function runStatus(argv: string[] = []): Promise<boolean> {
  const unknown = argv[0]
  if (unknown !== undefined) {
    throw new Error(msg().unknownStatusArg(unknown))
  }

  // One read of config.json for the whole report.
  let parsed: GeoGuardConfigFile | null = null
  let readError: unknown = null
  try {
    parsed = readConfigFile()
  } catch (err) {
    readError = err
  }

  const results: boolean[] = []

  if (readError) {
    console.log(msg().configPathLine(configPath()))
    console.log(msg().statusProblem(errorMessage(readError)))
    results.push(false)
  } else {
    results.push(reportConfig(parsed))
  }
  console.log('')

  results.push(
    reportHook(
      msg().statusClaudeHookHeader,
      settingsPath,
      assertClaudeHooksInstallable,
      claudeHookInstalled,
    ),
  )
  console.log('')

  results.push(
    reportHook(
      msg().statusCursorHookHeader,
      cursorHooksPath,
      assertCursorHooksInstallable,
      cursorHookInstalled,
    ),
  )
  console.log('')

  results.push(reportAlias())
  console.log('')

  // A config we could not read means the built-in defaults apply; the error was
  // already reported above, so it is not repeated here.
  await reportCountry(parsed ?? {})
  console.log('')

  const ok = results.every(Boolean)
  if (ok) {
    console.log(msg().statusOk())
    return true
  }
  console.log(msg().statusNotOk())
  console.log(msg().statusSetupHint())
  return false
}
