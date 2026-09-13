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
import path from 'node:path'

import { assertClaudeHooksInstallable, claudeHookInstalled, settingsPath } from './claude-hook'
import {
  assertCursorHooksInstallable,
  cursorDirExists,
  cursorHookInstalled,
  cursorHooksPath,
} from './cursor-hook'
import { configPath, loadConfig, readConfigFile, type GeoGuardConfigFile } from './config'
import { showConfig } from './config-cmd'
import { detectCountry, isAllowed } from './geo'
import {
  ALIAS_TARGETS,
  CLAUDE_TARGET,
  CURSOR_AGENT_TARGET,
  candidateRcPaths,
  detectShell,
  readAliasBlock,
} from './shell-alias'
import { pathRcPathForShell, readPathBlock } from './shell-path'
import { isShimFile, readShim, shimDir, type ShimTarget } from './shim'
import { processPathContains, userPathState } from './windows-path'
import { commandExists, resolveRealBin, whichAll } from './resolve-bin'
import { msg } from './i18n'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Whether a path is there — distinguishing "no such file" from "cannot look".
 * existsSync answers false to both, and reporting an unreadable directory as
 * "not installed" is simply untrue.
 */
function fileState(file: string): 'present' | 'missing' | { problem: string } {
  try {
    fs.statSync(file)
    return 'present'
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    return { problem: errorMessage(err) }
  }
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

  const state = fileState(file)
  if (state === 'missing') {
    console.log(msg().statusConfigMissing())
    return false
  }
  if (state !== 'present') {
    console.log(msg().statusProblem(state.problem))
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
  options: Readonly<{ wanted?: () => boolean }> = {},
): boolean {
  let file: string
  try {
    file = pathOf()
  } catch (err) {
    console.log(msg().statusProblem(errorMessage(err)))
    return false
  }
  console.log(header(file))

  // Not installed and not supposed to be: setup skips the Cursor hook on a
  // machine with no Cursor, so demanding it here would report a healthy install
  // as broken and send the user to a command that changes nothing.
  if (options.wanted && !options.wanted()) {
    console.log(msg().statusHookNotNeeded())
    return true
  }

  const state = fileState(file)
  if (state === 'missing') {
    console.log(msg().statusHookFileMissing())
    return false
  }
  if (state !== 'present') {
    console.log(msg().statusProblem(state.problem))
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

/**
 * Whether PATH actually reaches our shim for this command, before anything else.
 *
 * This is the question `status` exists to answer. A shim file and a PATH block
 * in an rc both being present proves only that setup ran: the shell the user is
 * typing in may have started before either existed, and then the gate is not in
 * effect and nothing on disk says so.
 */
function reportShimEffective(target: ShimTarget): boolean {
  const first = whichAll(target.command)[0]
  if (first === undefined) {
    console.log(msg().statusShimNotOnPath(shimDir()))
    return false
  }
  if (!isShimFile(first)) {
    console.log(msg().statusShimNotFirst(first))
    return false
  }

  try {
    // The shim launches whatever this resolves to. If it resolves to nothing,
    // the gate is in place and every launch through it fails.
    resolveRealBin(target.command)
  } catch (err) {
    console.log(msg().statusShimNoRealBin(target.command, errorMessage(err)))
    return false
  }
  return true
}

/**
 * The launch gate for one command. One target per call — claude and
 * cursor-agent have their own file, their own policy and their own answer.
 *
 * `wanted` is for a command that is not installed here: setup gates no
 * cursor-agent it cannot find, so demanding a shim for it would report a
 * healthy install as broken.
 */
function reportShim(
  target: ShimTarget,
  options: Readonly<{ wanted?: () => boolean }> = {},
): boolean {
  const wanted = options.wanted === undefined || options.wanted()

  let shim: ReturnType<typeof readShim>
  try {
    shim = readShim(target)
  } catch (err) {
    console.log(msg().statusProblem(errorMessage(err)))
    return false
  }

  if (shim.kind === 'none') {
    if (!wanted) {
      console.log(msg().statusShimNotNeeded(target.command))
      return true
    }
    console.log(msg().statusShimMissing(target.command))
    return false
  }

  if (shim.kind === 'foreign') {
    console.log(msg().statusShimForeign(shim.file))
    return false
  }

  if (shim.extraArgs) {
    console.log(msg().statusShimCustom(target.command, shim.extraArgs))
  } else {
    console.log(msg().statusShimPristine(target.command))
  }

  return reportShimEffective(target)
}

/** Our PATH block: the rc of the current shell decides, the others are noted. */
function reportPathEntry(): boolean {
  const dir = shimDir()

  let file: string
  try {
    file = pathRcPathForShell(detectShell())
  } catch (err) {
    console.log(msg().statusProblem(errorMessage(err)))
    return false
  }
  console.log(msg().statusPathHeader(file))

  let ok = false
  const state = fileState(file)
  if (state === 'missing') {
    console.log(msg().statusPathFileMissing())
  } else if (state !== 'present') {
    console.log(msg().statusProblem(state.problem))
  } else {
    ok = reportPathBlockIn(file, dir)
  }

  const others = candidateRcPaths().filter(
    other => path.normalize(other) !== path.normalize(file) && hasPathEntry(other, dir),
  )
  if (others.length > 0) console.log(msg().statusPathAlsoIn(others.join(', ')))

  return ok
}

/** The verdict on one file's PATH block, printed. */
function reportPathBlockIn(file: string, dir: string): boolean {
  let block
  try {
    block = readPathBlock(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    console.log(msg().statusProblem(errorMessage(err)))
    return false
  }

  if (block.kind === 'foreign') {
    console.log(msg().statusPathForeign())
    return false
  }
  if (block.kind === 'pristine' && block.dir === dir) {
    console.log(msg().statusPathPresent(dir))
    return true
  }
  // A block naming some other directory is as good as no block: the shims we
  // install are not on the PATH it builds.
  console.log(msg().statusPathMissing(dir))
  return false
}

/** Quiet version of the above, for the rc files we only mention. */
function hasPathEntry(file: string, dir: string): boolean {
  try {
    const block = readPathBlock(fs.readFileSync(file, 'utf8'))
    return block.kind === 'pristine' && block.dir === dir
  } catch {
    return false
  }
}

/**
 * The Windows half of "does the gate actually work".
 *
 * The PowerShell profile checked above says nothing about cmd.exe, a shortcut
 * or an IDE — those read the user PATH. Both answers are reported: the user
 * PATH is what every new process will get, the process PATH is what this
 * terminal has, and a terminal opened before setup differs from both.
 *
 * A user PATH we could not read is not counted as a fault: we have no evidence
 * either way, and failing the report on that would send the user to a setup run
 * that would fail in the same place.
 */
function reportUserPath(): boolean {
  const dir = shimDir()
  console.log(msg().statusUserPathHeader())

  const user = userPathState(dir)
  let ok = true
  if (user.state === 'present') {
    console.log(msg().statusUserPathPresent(dir))
  } else if (user.state === 'missing') {
    console.log(msg().statusUserPathMissing(dir))
    ok = false
  } else {
    console.log(msg().statusUserPathUnknown(user.detail))
  }

  if (processPathContains(dir)) {
    console.log(msg().statusProcessPathPresent(dir))
  } else {
    console.log(msg().statusProcessPathMissing(dir))
    ok = false
  }

  return ok
}

/**
 * Alias blocks from before the PATH gate.
 *
 * They gate nothing the shim does not already gate, and they shadow it in an
 * interactive shell — so an old block with old flags quietly wins over the one
 * setup just wrote. Reported only when there is one: a machine that never had
 * an alias should not be told about a section that does not apply to it.
 */
function reportAliasLeftovers(): boolean {
  const lines: string[] = []

  for (const file of candidateRcPaths()) {
    let content: string
    try {
      content = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }

    for (const target of ALIAS_TARGETS) {
      const block = readAliasBlock(content, target)
      // Foreign content between our markers is not reported here at all: it is
      // not an alias of ours, and it is nobody's business but the user's.
      if (block.kind !== 'pristine' && block.kind !== 'custom') continue

      // A block with no END marker is ours by its body and not ours to cut —
      // setup leaves it alone, so saying "setup takes it out" would send the
      // user round a loop that never closes.
      if (block.broken) lines.push(msg().statusAliasLeftoverBroken(file))
      else lines.push(msg().statusAliasLeftover(file))
      break
    }
  }

  if (lines.length === 0) return true

  console.log(msg().statusAliasLeftoverHeader())
  for (const line of lines) console.log(line)
  console.log('')
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
      { wanted: cursorDirExists },
    ),
  )
  console.log('')

  console.log(msg().statusShimHeader(shimDir()))
  results.push(reportShim(CLAUDE_TARGET))
  results.push(
    reportShim(CURSOR_AGENT_TARGET, {
      wanted: () => commandExists(CURSOR_AGENT_TARGET.command),
    }),
  )
  console.log('')

  results.push(reportPathEntry())
  console.log('')

  if (process.platform === 'win32') {
    results.push(reportUserPath())
    console.log('')
  }

  results.push(reportAliasLeftovers())

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
