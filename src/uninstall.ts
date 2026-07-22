import fs from 'node:fs'

import { configDir, configPath } from './config'
import { uninstallClaudeHook } from './claude-hook'
import { uninstallAliasesEverywhere } from './shell-alias'
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
 * - the UserPromptSubmit hook with geo-guard check / geo-check
 * - the alias marker block (and unmanaged claude-geo / geo-guard claude lines)
 * - config.json (+ the empty config directory)
 *
 * Leaves untouched: other aliases (cc/c), the rest of settings.json, settings.json.bak.
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

  const aliasResults = uninstallAliasesEverywhere()
  const aliases = aliasResults.filter(a => a.changed)
  const keptModified = aliasResults.filter(a => a.modified)
  if (aliases.length > 0) {
    for (const a of aliases) {
      log(quiet, msg().aliasRemoved(a.file))
    }
  } else {
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
    if (aliases.length > 0) {
      console.log(msg().reloadRc(aliases[0]?.file ?? ''))
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
