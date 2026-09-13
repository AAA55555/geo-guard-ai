import fs from 'node:fs'

import { configDir, configPath } from './config'
import { uninstallClaudeHook } from './claude-hook'
import { uninstallCursorHook } from './cursor-hook'
import { uninstallAliasesEverywhere } from './shell-alias'
import { uninstallPathEntriesEverywhere } from './shell-path'
import { shimDir, uninstallShimsEverywhere } from './shim'
import { uninstallUserPathEntry } from './windows-path'
import { msg } from './i18n'

export type UninstallOptions = Readonly<{
  keepConfig?: boolean
  quiet?: boolean
}>

function log(quiet: boolean, message: string): void {
  if (!quiet) console.log(message)
}

function removeOurConfig(): { removed: string[] } {
  const removed: string[] = []
  const file = configPath()
  if (fs.existsSync(file)) {
    fs.unlinkSync(file)
    removed.push(file)
  }

  const dir = configDir()
  if (fs.existsSync(dir)) {
    const left = fs.readdirSync(dir)
    if (left.length === 0) {
      fs.rmdirSync(dir)
      removed.push(dir)
    }
  }

  return { removed }
}

function parseUninstallArgs(argv: string[]): UninstallOptions {
  let keepConfig = false
  let quiet = false
  for (const arg of argv) {
    if (arg === '--keep-config') keepConfig = true
    else if (arg === '--quiet' || arg === '-q') quiet = true
    else if (arg === '--shell' || arg.startsWith('--shell=')) {
      // ignore: we clean all rc files, not a single shell
    } else if (arg.startsWith('-')) {
      throw new Error(msg().unknownUninstallArg(arg))
    }
  }
  return { keepConfig, quiet }
}

/**
 * Removes only what geo-guard-ai added:
 * - the UserPromptSubmit hook with geo-guard check / geo-check in ~/.claude/settings.json
 * - the beforeSubmitPrompt hook in ~/.cursor/hooks.json
 * - the shim executables in ~/.geo-guard/bin (and that directory, if empty)
 * - the PATH marker block in every rc file, and the ~/.bash_profile block that
 *   makes a login shell read ~/.bashrc
 * - the alias marker block from earlier versions (and unmanaged claude-geo /
 *   geo-guard claude lines)
 * - config.json (+ the empty config directory)
 *
 * Leaves untouched: the user's own aliases and PATH lines, a file in the shim
 * directory we did not write, the rest of settings.json / hooks.json, and both
 * .bak files.
 */
export async function runUninstall(argv: string[] = []): Promise<void> {
  const opts = parseUninstallArgs(argv)
  const quiet = opts.quiet ?? false

  const hook = uninstallClaudeHook()
  if (hook.changed) {
    log(quiet, msg().hookRemoved(hook.file))
  } else {
    log(quiet, msg().hookNotFound())
  }

  const cursorHook = uninstallCursorHook()
  if (cursorHook.changed) {
    log(quiet, msg().hookRemoved(cursorHook.file))
  } else {
    log(quiet, msg().cursorHookNotFound())
  }

  const shims = uninstallShimsEverywhere()
  const removedShims = shims.filter(shim => shim.removed)
  for (const shim of removedShims) {
    log(quiet, msg().shimRemoved(shim.file))
  }
  for (const shim of shims.filter(shim => shim.foreign)) {
    log(quiet, msg().shimKeptOnUninstall(shim.file))
  }
  if (removedShims.length === 0 && shims.every(shim => !shim.foreign)) {
    log(quiet, msg().shimsNotFound())
  }

  const pathResults = uninstallPathEntriesEverywhere()
  const pathRemoved = pathResults.filter(entry => entry.changed)
  for (const entry of pathRemoved) {
    log(quiet, msg().pathEntryRemoved(entry.file))
  }
  const pathKept = pathResults.filter(entry => entry.modified)
  for (const entry of pathKept) {
    log(quiet, msg().pathEntryManuallyEdited(entry.file))
  }
  if (pathRemoved.length === 0 && pathKept.length === 0) {
    log(quiet, msg().pathEntriesNotFound())
  }

  // The other half of the Windows gate: setup puts the shim directory into
  // HKCU\Environment, and a leftover entry there would keep pointing at a
  // directory this very run is deleting.
  if (process.platform === 'win32') {
    const userPath = uninstallUserPathEntry(shimDir())
    if (userPath.outcome === 'removed') {
      log(quiet, msg().userPathRemoved(userPath.dir))
    } else if (userPath.outcome === 'unavailable') {
      log(quiet, msg().userPathRemoveFailed(userPath.dir, userPath.detail))
    } else {
      log(quiet, msg().userPathNotFound())
    }
  }

  const aliasResults = uninstallAliasesEverywhere()
  const aliases = aliasResults.filter(a => a.changed)
  const keptModified = aliasResults.filter(a => a.modified)
  if (aliases.length > 0) {
    for (const a of aliases) {
      log(quiet, msg().aliasRemoved(a.file))
    }
  } else if (keptModified.length === 0) {
    // Only when there is genuinely nothing: saying "no blocks found" and then
    // "a block was left as is" in the next breath contradicts itself.
    log(quiet, msg().aliasBlocksNotFound())
  }
  for (const a of keptModified) {
    log(quiet, msg().aliasBlockManuallyEdited(a.file))
  }

  if (opts.keepConfig) {
    log(quiet, msg().configKept(configPath()))
  } else {
    const { removed } = removeOurConfig()
    if (removed.length > 0) {
      for (const item of removed) {
        log(quiet, msg().removed(item))
      }
    } else {
      log(quiet, msg().configNotFound())
    }
  }

  if (!quiet) {
    // Whichever rc we actually changed: the shell still has the old PATH (or
    // the old alias) in memory until it re-reads one of them.
    const touched = pathRemoved[0]?.file ?? aliases[0]?.file ?? ''
    if (touched) {
      if (touched.toLowerCase().endsWith('.ps1')) {
        console.log(msg().reloadRcPowershell(touched))
      } else {
        console.log(msg().reloadRc(touched))
      }
    }
    console.log(msg().uninstallDone())
  }
}

/** For npm preuninstall: never fails the package removal. */
export async function runPreuninstall(): Promise<void> {
  try {
    await runUninstall(['--quiet'])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(msg().preuninstallError(message))
  }
}
