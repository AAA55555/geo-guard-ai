import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { SHIM_MARKER_TAG } from './config'

/**
 * Where the shims live, and how to recognize one.
 *
 * This is its own module rather than part of `shim.ts` on purpose: resolve-bin
 * must skip our shims while scanning PATH, and shim.ts needs resolve-bin to
 * find the real `geo-guard`. Splitting the two facts these modules share keeps
 * the import graph acyclic — a cycle would work in CommonJS today and break the
 * first time either module does something at load time.
 */

/** Directory holding the shim executables. */
export function shimDir(): string {
  const override = process.env.GEO_GUARD_SHIM_DIR
  if (override) return override
  return path.join(os.homedir(), '.geo-guard', 'bin')
}

/** Comparison that matches how the two platforms treat case in paths. */
function samePath(a: string, b: string): boolean {
  const left = path.normalize(a)
  const right = path.normalize(b)
  if (process.platform === 'win32') return left.toLowerCase() === right.toLowerCase()
  return left === right
}

/**
 * The shim directory, plus its symlink-resolved form when it exists: PATH
 * candidates arrive from resolve-bin already realpath'ed, so a shim dir reached
 * through a symlinked $HOME would otherwise never match.
 */
function shimDirs(): string[] {
  const dir = path.resolve(shimDir())
  const dirs = [dir]
  try {
    const real = fs.realpathSync(dir)
    if (!samePath(real, dir)) dirs.push(real)
  } catch {
    // Not created yet — the unresolved path is all we have, and it is enough.
  }
  return dirs
}

/** Whether a file sits directly in the shim directory. */
export function inShimDir(file: string): boolean {
  const parent = path.dirname(path.resolve(file))
  return shimDirs().some(dir => samePath(dir, parent))
}

/** Enough to cover the shebang plus our marker line, and never a whole binary. */
const SNIFF_BYTES = 512
const SNIFF_LINES = 5

/**
 * Whether a file is one of our shims, judged by its own content.
 *
 * `inShimDir` alone is not enough: a shim from an earlier install, from another
 * GEO_GUARD_SHIM_DIR, or one copied somewhere by hand would sail past it and
 * put geo-guard back on PATH in front of the real binary — an endless chain of
 * forks. Reading is deliberately defensive: any unreadable or binary file is
 * simply "not ours".
 */
export function looksLikeShim(file: string): boolean {
  let fd: number | null = null
  try {
    fd = fs.openSync(file, 'r')
    const buffer = Buffer.alloc(SNIFF_BYTES)
    const read = fs.readSync(fd, buffer, 0, SNIFF_BYTES, 0)
    // latin1, not utf8: a real binary decodes to garbage either way, but latin1
    // cannot throw or replace bytes in a way that hides the marker.
    const head = buffer.subarray(0, read).toString('latin1')
    return head.split('\n').slice(0, SNIFF_LINES).join('\n').includes(SHIM_MARKER_TAG)
  } catch {
    return false
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd)
      } catch {
        // Nothing useful to do about a failing close on a read-only probe.
      }
    }
  }
}

/** Either rubric says "this is a shim, do not launch it as the real binary". */
export function isShimFile(file: string): boolean {
  return inShimDir(file) || looksLikeShim(file)
}

/**
 * Re-entry counter, carried to the child through the environment.
 *
 * The two checks above are what normally keeps `shim claude` → `geo-guard
 * claude` → `resolveRealBin('claude')` from finding the shim again. This is the
 * backstop for the case where they both fail (an exotic PATH, a shim we cannot
 * read): the chain stops with an error instead of forking forever.
 */
export const DEPTH_ENV = 'GEO_GUARD_DEPTH'

/** Two nested wraps is already more than any legitimate launch needs. */
export const MAX_DEPTH = 2

export function currentDepth(): number {
  const raw = Number(process.env[DEPTH_ENV])
  if (!Number.isFinite(raw) || raw < 0) return 0
  return Math.floor(raw)
}

export function depthExceeded(): boolean {
  return currentDepth() >= MAX_DEPTH
}

/** The environment for a child launch, one level deeper than ours. */
export function envWithNextDepth(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, [DEPTH_ENV]: String(currentDepth() + 1) }
}
