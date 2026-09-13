import fs from 'node:fs'
import path from 'node:path'

import { msg } from './i18n'
import { isShimFile } from './shim-paths'

function pathDirs(): string[] {
  return (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean)
}

function winExts(): string[] {
  return (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
}

function tryResolve(file: string): string | null {
  try {
    if (!fs.existsSync(file)) return null
    const real = fs.realpathSync(file)
    if (process.platform !== 'win32') {
      try {
        fs.accessSync(real, fs.constants.X_OK)
      } catch {
        return null
      }
    }
    return real
  } catch {
    return null
  }
}

function candidatesFor(command: string, dir: string): string[] {
  if (process.platform !== 'win32') {
    return [path.join(dir, command)]
  }
  if (path.extname(command)) {
    return [path.join(dir, command)]
  }
  return [path.join(dir, command), ...winExts().map(ext => path.join(dir, command + ext))]
}

export function whichAll(command: string): string[] {
  const results: string[] = []
  const seen = new Set<string>()
  for (const dir of pathDirs()) {
    for (const file of candidatesFor(command, dir)) {
      const resolved = tryResolve(file)
      if (!resolved || seen.has(resolved)) continue
      seen.add(resolved)
      results.push(resolved)
    }
  }
  return results
}

function isSelf(resolvedPath: string, selfPaths: string[]): boolean {
  const normalized = path.normalize(resolvedPath)
  const base = path.basename(normalized).toLowerCase()
  // Basename heuristic: filters out the npm shim geo-guard(.cmd/.ps1/.js).
  // Very rare case: a third-party binary with the same name would also be skipped —
  // then set GEO_GUARD_REAL_BIN explicitly.
  if (
    base === 'geo-guard' ||
    base === 'geo-guard.cmd' ||
    base === 'geo-guard.ps1' ||
    base === 'geo-guard.js'
  ) {
    return true
  }
  return selfPaths.some(self => Boolean(self) && normalized === path.normalize(self))
}

/**
 * Anything we must not launch as the target: geo-guard itself, or one of our
 * PATH shims.
 *
 * Without the shim half the whole PATH gate is a fork bomb: the shim runs
 * `geo-guard claude`, and the first `claude` on PATH is the shim again, because
 * putting it first is the entire point. `isShimFile` answers on two independent
 * grounds — "sits in our shim directory" and "carries our marker" — so a shim
 * left by an older install, by another GEO_GUARD_SHIM_DIR, or copied somewhere
 * by hand is caught as well.
 */
function isOurs(resolvedPath: string, selfPaths: string[]): boolean {
  return isSelf(resolvedPath, selfPaths) || isShimFile(resolvedPath)
}

export type ResolveRealBinOptions = Readonly<{
  realBinEnv?: string
  selfEntry?: string
}>

/** Resolve target binary, skipping geo-guard itself (avoid recursion). */
export function resolveRealBin(command: string, options: ResolveRealBinOptions = {}): string {
  const { realBinEnv, selfEntry } = options

  if (realBinEnv) {
    const resolved = tryResolve(realBinEnv)
    if (!resolved) throw new Error(msg().realBinNotFound(realBinEnv))
    // An explicit override pointed at a shim loops just as happily as a PATH
    // hit does, so it gets the same refusal rather than a special case.
    if (isShimFile(resolved)) throw new Error(msg().targetIsSelf(realBinEnv))
    return resolved
  }

  const selfPaths: string[] = []
  if (selfEntry) {
    try {
      selfPaths.push(fs.realpathSync(selfEntry))
    } catch {
      selfPaths.push(path.resolve(selfEntry))
    }
    selfPaths.push(path.resolve(path.dirname(selfEntry), 'geo-guard'))
  }

  if (command.includes('/') || command.includes('\\') || path.isAbsolute(command)) {
    const resolved = tryResolve(command)
    if (!resolved) throw new Error(msg().binNotFound(command))
    if (isOurs(resolved, selfPaths)) {
      throw new Error(msg().targetIsSelf(command))
    }
    return resolved
  }

  for (const candidate of whichAll(command)) {
    if (isOurs(candidate, selfPaths)) continue
    return candidate
  }

  throw new Error(msg().binNotFoundInPath(command))
}

/**
 * Whether a command is on PATH at all.
 *
 * setup and status use it to decide whether a cursor-agent alias is wanted:
 * aliasing a command that isn't installed would turn "command not found" into
 * our own "binary not found" error, which is a worse answer to the same
 * question. Never throws — an unreadable PATH entry is not a reason to fail.
 */
export function commandExists(command: string): boolean {
  try {
    return whichAll(command).length > 0
  } catch {
    return false
  }
}
