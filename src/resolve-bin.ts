import fs from 'node:fs'
import path from 'node:path'

import { msg } from './i18n'

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

export type ResolveRealBinOptions = Readonly<{
  realBinEnv?: string
  selfEntry?: string
}>

/** Resolve target binary, skipping geo-guard itself (avoid recursion). */
export function resolveRealBin(command: string, options: ResolveRealBinOptions = {}): string {
  const { realBinEnv, selfEntry } = options

  if (realBinEnv) {
    const resolved = tryResolve(realBinEnv)
    if (resolved) return resolved
    throw new Error(msg().realBinNotFound(realBinEnv))
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
    if (isSelf(resolved, selfPaths)) {
      throw new Error(msg().targetIsSelf(command))
    }
    return resolved
  }

  for (const candidate of whichAll(command)) {
    if (isSelf(candidate, selfPaths)) continue
    return candidate
  }

  throw new Error(msg().binNotFoundInPath(command))
}
