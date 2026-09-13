import fs from 'node:fs'
import path from 'node:path'

import { SHIM_MARKER_TAG, SHIM_MARKER_VERSION } from './config'
import { whichAll } from './resolve-bin'
import { ALIAS_TARGETS, CLAUDE_TARGET, CURSOR_AGENT_TARGET, type AliasTarget } from './shell-alias'
import { inShimDir, isShimFile, looksLikeShim, shimDir } from './shim-paths'

export { shimDir, inShimDir, isShimFile, looksLikeShim }
export {
  DEPTH_ENV,
  MAX_DEPTH,
  currentDepth,
  depthExceeded,
  envWithNextDepth,
} from './shim-paths'

/**
 * A shim gates a command the way an alias does, but at the level of PATH: it is
 * a real executable, so `\claude`, `command claude`, a Makefile, a script and a
 * non-interactive shell all go through it — none of which an alias in one rc
 * file ever saw.
 *
 * The targets are the alias targets: claude and cursor-agent must stay separate
 * everywhere (own file, own marker, own profile, own removal), and a second
 * list of them here would be one more place to forget to update.
 */
export type ShimTarget = AliasTarget
export const SHIM_TARGETS: readonly ShimTarget[] = ALIAS_TARGETS
export { CLAUDE_TARGET, CURSOR_AGENT_TARGET }

/** The first-line marker for a target, e.g. `geo-guard-ai shim v1: claude`. */
function markerFor(target: ShimTarget): string {
  return `${SHIM_MARKER_TAG} ${SHIM_MARKER_VERSION}: ${target.command}`
}

const DO_NOT_EDIT = 'Managed by geo-guard-ai. Do not edit: `geo-guard setup` regenerates this file.'

/** Shim file name for the current platform. */
export function shimFileName(target: ShimTarget): string {
  if (process.platform === 'win32') return `${target.command}.cmd`
  return target.command
}

export function shimPathFor(target: ShimTarget): string {
  return path.join(shimDir(), shimFileName(target))
}

/**
 * The `geo-guard` the shim should call, resolved at install time.
 *
 * An absolute path is what makes the shim work from a cron job or a Makefile,
 * where PATH may be nothing like the user's. The generated body still falls
 * back to a bare `geo-guard` — an npm prefix that moves later must not leave
 * every gated command dead.
 */
export function resolveGeoGuardBin(): string {
  const explicit = process.env.GEO_GUARD_BIN
  if (explicit) return explicit

  for (const candidate of whichAll('geo-guard')) {
    // Our own shims are never the answer, and the npm shim is what we want.
    if (isShimFile(candidate)) continue
    return candidate
  }

  return 'geo-guard'
}

/** `exec` tail: the wrapped subcommand plus whatever flags the user kept. */
function commandWithArgs(target: ShimTarget, extraArgs: string): string {
  const extra = extraArgs.trim()
  if (!extra) return target.command
  return `${target.command} ${extra}`
}

function posixBody(target: ShimTarget, geoGuardBin: string, extraArgs: string): string {
  return [
    '#!/bin/sh',
    `# >>> ${markerFor(target)} >>>`,
    `# ${DO_NOT_EDIT}`,
    `GG="${geoGuardBin}"`,
    '[ -x "$GG" ] || GG=geo-guard',
    `exec "$GG" ${commandWithArgs(target, extraArgs)} "$@"`,
    '',
  ].join('\n')
}

function windowsBody(target: ShimTarget, geoGuardBin: string, extraArgs: string): string {
  return [
    '@echo off',
    `@rem >>> ${markerFor(target)} >>>`,
    `@rem ${DO_NOT_EDIT}`,
    `set "GG=${geoGuardBin}"`,
    'if not exist "%GG%" set "GG=geo-guard"',
    `call "%GG%" ${commandWithArgs(target, extraArgs)} %*`,
    'exit /b %errorlevel%',
    '',
  ].join('\r\n')
}

/** The exact bytes we write for this target, binary and flags. */
export function shimBody(target: ShimTarget, geoGuardBin: string, extraArgs = ''): string {
  if (process.platform === 'win32') return windowsBody(target, geoGuardBin, extraArgs)
  return posixBody(target, geoGuardBin, extraArgs)
}

/** Pulls the flags back out of a shim we generated, for any geo-guard path. */
function parseExtraArgs(content: string, target: ShimTarget): string | null {
  const command = escapeRe(target.command)
  const posix = new RegExp(`^exec "\\$GG" ${command}([^\\n]*?) "\\$@"$`, 'm')
  const windows = new RegExp(`^call "%GG%" ${command}([^\\r\\n]*?) %\\*\\r?$`, 'm')

  const match = posix.exec(content) ?? windows.exec(content)
  if (!match) return null
  return (match[1] ?? '').trim()
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * What the shim file for a target currently is:
 * - `none`     — no such file;
 * - `pristine` — ours, wrapping the command and nothing else;
 * - `custom`   — ours, carrying flags the user added;
 * - `foreign`  — a file with that name that is not ours.
 *
 * Note that `pristine` is about the shape, not the bytes: a shim still pointing
 * at an npm prefix that has since moved is pristine and gets regenerated.
 */
export type ShimKind = 'none' | 'pristine' | 'custom' | 'foreign'

export type ShimFile = Readonly<{
  kind: ShimKind
  file: string
  /** Flags the user added, '' for a pristine shim and for anything not ours. */
  extraArgs: string
  /**
   * false — our marker is there but the exec line is not one we can read, so
   * `extraArgs` says nothing about what this shim actually runs.
   */
  parsed: boolean
  /** Raw content, '' when there is no file. Lets install compare byte-for-byte. */
  content: string
}>

export function readShim(target: ShimTarget): ShimFile {
  const file = shimPathFor(target)

  let content: string
  try {
    content = fs.readFileSync(file, 'utf8')
  } catch {
    return { kind: 'none', file, extraArgs: '', parsed: true, content: '' }
  }

  // The marker has to be near the top, where we put it — a file that merely
  // mentions geo-guard somewhere down the middle is not ours.
  const head = content.split('\n').slice(0, 5).join('\n')
  if (!head.includes(SHIM_MARKER_TAG)) {
    return { kind: 'foreign', file, extraArgs: '', parsed: false, content }
  }

  const extraArgs = parseExtraArgs(content, target)
  // Our marker, but an exec line we cannot read: someone edited the body. Ours
  // to remove, never ours to silently rewrite — same rule as a custom alias.
  if (extraArgs === null) return { kind: 'custom', file, extraArgs: '', parsed: false, content }
  if (extraArgs === '') return { kind: 'pristine', file, extraArgs, parsed: true, content }
  return { kind: 'custom', file, extraArgs, parsed: true, content }
}

/**
 * Why an existing shim was left alone:
 * - `custom`  — our shim plus flags of the user's own;
 * - `foreign` — a file of that name that we did not write.
 */
export type PreservedShimKind = 'custom' | 'foreign'

export type InstallShimResult = Readonly<{
  target: ShimTarget
  file: string
  /** null — the file is now exactly what it should be. */
  preserved: PreservedShimKind | null
  /** true — we wrote the file (false also means "already correct"). */
  changed: boolean
  /** The flags in effect afterwards, whether ours or the ones we kept. */
  extraArgs: string
}>

export type InstallShimOptions = Readonly<{
  /** Flags to bake in, e.g. `--dangerously-skip-permissions` from an alias. */
  extraArgs?: string
  /** Replace a shim of ours we would otherwise leave alone. Never touches `foreign`. */
  overwriteCustom?: boolean
  /** The geo-guard to call; resolved from PATH when not given. */
  geoGuardBin?: string
}>

export function installShim(
  target: ShimTarget,
  options: InstallShimOptions = {},
): InstallShimResult {
  const extraArgs = (options.extraArgs ?? '').trim()
  const existing = readShim(target)

  // A file we did not write is never overwritten, with or without a force flag:
  // there is no backup, and a same-named binary of the user's own is exactly
  // the thing a launch gate must not eat.
  if (existing.kind === 'foreign') {
    return { target, file: existing.file, preserved: 'foreign', changed: false, extraArgs: '' }
  }

  // Flags the user added survive a reinstall. They are only rewritten on an
  // explicit request, or when the caller asks for those very same flags — then
  // regenerating changes nothing but a stale geo-guard path.
  const sameFlags = existing.parsed && existing.extraArgs === extraArgs
  const keepCustom =
    existing.kind === 'custom' && !sameFlags && !(options.overwriteCustom ?? false)
  if (keepCustom) {
    return {
      target,
      file: existing.file,
      preserved: 'custom',
      changed: false,
      extraArgs: existing.extraArgs,
    }
  }

  const body = shimBody(target, options.geoGuardBin ?? resolveGeoGuardBin(), extraArgs)
  if (existing.content === body) {
    // Already byte-for-byte right. Rewriting would only churn the mtime, and on
    // Windows a rewrite of a running .cmd is a sharing violation.
    return { target, file: existing.file, preserved: null, changed: false, extraArgs }
  }

  fs.mkdirSync(shimDir(), { recursive: true })
  fs.writeFileSync(existing.file, body)
  if (process.platform !== 'win32') fs.chmodSync(existing.file, 0o755)

  return { target, file: existing.file, preserved: null, changed: true, extraArgs }
}

export type UninstallShimResult = Readonly<{
  target: ShimTarget
  file: string
  /** true — our shim was deleted. */
  removed: boolean
  /** true — a file is there, but not ours to delete. */
  foreign: boolean
}>

export function uninstallShim(target: ShimTarget): UninstallShimResult {
  const existing = readShim(target)
  if (existing.kind === 'none') {
    return { target, file: existing.file, removed: false, foreign: false }
  }
  if (existing.kind === 'foreign') {
    return { target, file: existing.file, removed: false, foreign: true }
  }

  fs.rmSync(existing.file, { force: true })
  return { target, file: existing.file, removed: true, foreign: false }
}

/**
 * Removes every shim of ours and, if nothing else is left there, the directory.
 * A non-empty directory stays: whatever the user put next to our files is not
 * ours to delete.
 */
export function uninstallShimsEverywhere(): UninstallShimResult[] {
  const results = SHIM_TARGETS.map(uninstallShim)
  removeShimDirIfEmpty()
  return results
}

export function removeShimDirIfEmpty(): boolean {
  const dir = shimDir()
  try {
    if (fs.readdirSync(dir).length > 0) return false
    fs.rmdirSync(dir)
    return true
  } catch {
    return false
  }
}

/** Whether a target is gated at launch right now (for `status`). */
export function shimInstalled(target: ShimTarget): boolean {
  const kind = readShim(target).kind
  return kind === 'pristine' || kind === 'custom'
}
