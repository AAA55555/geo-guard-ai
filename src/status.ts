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
import { configPath, loadConfig } from './config'
import { showConfig } from './config-cmd'
import { detectCountry, isAllowed } from './geo'
import {
  detectShell,
  isPristineAliasBody,
  markedBlockBody,
  parseAliasBody,
  rcPathForShellResolved,
} from './shell-alias'
import { msg } from './i18n'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The config path, the effective policy, and whether the file is actually there. */
function reportConfig(): boolean {
  const file = configPath()
  try {
    // Same output as `geo-guard config` with no arguments — one place decides
    // how a policy is printed.
    showConfig()
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
  header: string,
  file: string,
  assertInstallable: () => void,
  isInstalled: () => boolean,
): boolean {
  console.log(header)

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
  const file = rcPathForShellResolved(detectShell())
  console.log(msg().statusAliasHeader(file))

  let content: string
  try {
    if (!fs.existsSync(file)) {
      console.log(msg().statusAliasFileMissing())
      return false
    }
    content = fs.readFileSync(file, 'utf8')
  } catch (err) {
    console.log(msg().statusProblem(errorMessage(err)))
    return false
  }

  const body = markedBlockBody(content)
  if (body === null) {
    console.log(msg().statusAliasMissing())
    return false
  }

  const parsed = parseAliasBody(body)
  if (isPristineAliasBody(body)) {
    console.log(msg().statusAliasPristine(parsed?.name ?? ''))
    return true
  }
  // Still our alias, still routed through the geo-check — the user just added
  // flags of their own, which setup deliberately keeps.
  if (parsed) {
    console.log(msg().statusAliasCustom(body))
    return true
  }

  console.log(msg().statusAliasForeign(body))
  return false
}

/**
 * Where the machine looks like it is. Informational only — a blocked country is
 * `check`'s business, not a sign that the install is broken, so it is kept out
 * of the exit code.
 */
async function reportCountry(): Promise<void> {
  console.log(msg().statusCountryHeader())
  try {
    // detectCountry honours config.timeoutMs and aborts on it, so this cannot
    // hang the report waiting on a dead provider.
    const config = loadConfig()
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

  const results: boolean[] = []

  results.push(reportConfig())
  console.log('')

  const claudeFile = settingsPath()
  results.push(
    reportHook(
      msg().statusClaudeHookHeader(claudeFile),
      claudeFile,
      assertClaudeHooksInstallable,
      claudeHookInstalled,
    ),
  )
  console.log('')

  const cursorFile = cursorHooksPath()
  results.push(
    reportHook(
      msg().statusCursorHookHeader(cursorFile),
      cursorFile,
      assertCursorHooksInstallable,
      cursorHookInstalled,
    ),
  )
  console.log('')

  results.push(reportAlias())
  console.log('')

  await reportCountry()
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
