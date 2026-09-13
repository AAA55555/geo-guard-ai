import { spawnSync } from 'node:child_process'

import { commandExists } from './resolve-bin'

/**
 * The shim directory in the *user's* PATH on Windows.
 *
 * The PowerShell profile covers PowerShell sessions and nothing else: cmd.exe,
 * a shortcut, Explorer, another terminal emulator and every IDE read PATH from
 * the user environment and never execute that profile. Leaving the gate in the
 * profile alone would repeat, on Windows, exactly the hole that moving off the
 * shell alias was meant to close — a gate present in one place out of many.
 *
 * Everything here touches HKCU\Environment only. The machine PATH is never read
 * and never written: writing an expanded %PATH% (which contains the machine
 * half) into the user variable is the classic way to wreck an environment
 * irreversibly, so the raw user value is the only thing we ever handle.
 */

/** Windows separates PATH entries with a semicolon, on every shell. */
const SEP = ';'

/**
 * Entries are compared case-insensitively and without a trailing separator —
 * `C:\Users\x\.geo-guard\bin\` and `c:\users\x\.geo-guard\bin` are one entry.
 * Nothing here expands `%VAR%`: an entry is compared exactly as it is stored,
 * because expanding it would mean deciding what it means for another process.
 */
function normalizeEntry(entry: string): string {
  return entry.trim().replace(/[\\/]+$/, '').toLowerCase()
}

export function pathValueContains(raw: string, dir: string): boolean {
  const target = normalizeEntry(dir)
  if (target === '') return false
  return raw.split(SEP).some(entry => normalizeEntry(entry) === target)
}

/** The value PATH should become, or null when it already says what it should. */
export function addToPathValue(raw: string, dir: string): string | null {
  if (pathValueContains(raw, dir)) return null
  if (raw.trim() === '') return dir
  // Prepended: a gate found after the real binary is not a gate.
  return `${dir}${SEP}${raw}`
}

/** The value PATH should become, or null when our entry is not in it. */
export function removeFromPathValue(raw: string, dir: string): string | null {
  const target = normalizeEntry(dir)
  if (target === '') return null
  const parts = raw.split(SEP)
  const kept = parts.filter(entry => normalizeEntry(entry) !== target)
  if (kept.length === parts.length) return null
  return kept.join(SEP)
}

/** The only two value types a PATH may sensibly have. */
export type PathValueKind = 'String' | 'ExpandString'

export type UserPathRead =
  | Readonly<{ kind: 'ok'; name: string; valueKind: PathValueKind; raw: string }>
  /** HKCU\Environment has no Path at all — ours would be the first one. */
  | Readonly<{ kind: 'missing' }>
  /** A Path of a type we refuse to rewrite, or a name we refuse to quote. */
  | Readonly<{ kind: 'unsupported'; detail: string }>
  | Readonly<{ kind: 'error'; detail: string }>

function powershellCommand(): string | null {
  for (const exe of ['powershell', 'pwsh']) {
    if (commandExists(exe)) return exe
  }
  return null
}

type PowerShellRun = Readonly<{ ok: boolean; stdout: string; error: string }>

/**
 * Runs a script through -EncodedCommand: the script is handed over as base64
 * UTF-16, so no directory with a quote, a space or a `$` in it can turn into
 * PowerShell syntax on the way. -NoProfile keeps our own profile block (and the
 * user's) out of a run whose whole job is to read the registry.
 */
function runPowerShell(script: string): PowerShellRun {
  const exe = powershellCommand()
  if (exe === null) return { ok: false, stdout: '', error: 'PowerShell not found' }

  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const res = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (res.error) return { ok: false, stdout: '', error: res.error.message }
  if (res.status !== 0) {
    const stderr = (res.stderr ?? '').trim()
    return { ok: false, stdout: res.stdout ?? '', error: stderr || `exit ${String(res.status)}` }
  }
  return { ok: true, stdout: res.stdout ?? '', error: '' }
}

/**
 * DoNotExpandEnvironmentNames is the point of reading through the registry
 * rather than [Environment]::GetEnvironmentVariable: someone else's
 * `%USERPROFILE%\bin` must come back as it is written, or writing the value
 * back would bake today's expansion into their PATH forever.
 *
 * Output goes through [Console]::Out and not Write-Output: PowerShell's own
 * formatter wraps a long line at the console width, and a PATH is exactly the
 * kind of long line that would come back chopped into pieces.
 */
const READ_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $false)",
  "if ($null -eq $key) { [Console]::Out.WriteLine('GEOGUARD_MISSING'); exit 0 }",
  // The value is conventionally spelled `Path`, but the registry preserves
  // whatever case created it and rewriting it under another spelling would
  // leave two PATHs in one key.
  "$name = $key.GetValueNames() | Where-Object { $_ -ieq 'Path' } | Select-Object -First 1",
  "if ($null -eq $name) { [Console]::Out.WriteLine('GEOGUARD_MISSING'); exit 0 }",
  '$kind = $key.GetValueKind($name)',
  "$raw = [string]$key.GetValue($name, '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)",
  "[Console]::Out.WriteLine('GEOGUARD_NAME ' + $name)",
  "[Console]::Out.WriteLine('GEOGUARD_KIND ' + $kind)",
  "[Console]::Out.WriteLine('GEOGUARD_VALUE ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($raw)))",
  '$key.Close()',
].join('\n')

function lineAfter(stdout: string, tag: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith(`${tag} `)) return line.slice(tag.length + 1).trim()
    if (line.trim() === tag) return ''
  }
  return null
}

/** A name we are willing to interpolate into a script. */
const SAFE_VALUE_NAME = /^[A-Za-z]+$/

export function readUserPath(): UserPathRead {
  const run = runPowerShell(READ_SCRIPT)
  if (!run.ok) return { kind: 'error', detail: run.error }
  if (run.stdout.includes('GEOGUARD_MISSING')) return { kind: 'missing' }

  const name = lineAfter(run.stdout, 'GEOGUARD_NAME')
  const kind = lineAfter(run.stdout, 'GEOGUARD_KIND')
  const value = lineAfter(run.stdout, 'GEOGUARD_VALUE')
  if (name === null || kind === null || value === null) {
    return { kind: 'error', detail: run.stdout.trim() || 'unreadable PowerShell output' }
  }
  if (!SAFE_VALUE_NAME.test(name)) {
    return { kind: 'unsupported', detail: `unexpected value name ${name}` }
  }
  // Anything but a string (a REG_MULTI_SZ, a REG_BINARY someone put there) is
  // not a PATH we know how to rewrite — and a wrong guess is unrecoverable.
  if (kind !== 'String' && kind !== 'ExpandString') {
    return { kind: 'unsupported', detail: `unexpected value type ${kind}` }
  }

  let raw: string
  try {
    raw = Buffer.from(value, 'base64').toString('utf8')
  } catch {
    return { kind: 'error', detail: 'unreadable PATH value' }
  }
  return { kind: 'ok', name, valueKind: kind, raw }
}

/**
 * Writes the value back with the type it already had. REG_EXPAND_SZ is kept on
 * purpose: demoting it to REG_SZ would stop every `%VAR%` in somebody else's
 * entry from expanding, and they would have no idea why.
 */
function writeUserPath(name: string, valueKind: PathValueKind, value: string): PowerShellRun {
  const encodedValue = Buffer.from(value, 'utf8').toString('base64')
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)",
    "if ($null -eq $key) { $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment') }",
    `$value = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedValue}'))`,
    `$key.SetValue('${name}', $value, [Microsoft.Win32.RegistryValueKind]::${valueKind})`,
    '$key.Close()',
    "[Console]::Out.WriteLine('GEOGUARD_OK')",
  ].join('\n')
  return runPowerShell(script)
}

export type UserPathOutcome =
  | 'added'
  | 'already-present'
  | 'removed'
  | 'absent'
  /** We could not read or write the user PATH — nothing was changed. */
  | 'unavailable'

export type UserPathResult = Readonly<{
  outcome: UserPathOutcome
  dir: string
  /** Why, when the outcome is 'unavailable'. Empty otherwise. */
  detail: string
}>

function unavailable(dir: string, detail: string): UserPathResult {
  return { outcome: 'unavailable', dir, detail }
}

export function installUserPathEntry(dir: string): UserPathResult {
  const current = readUserPath()
  if (current.kind === 'error' || current.kind === 'unsupported') {
    return unavailable(dir, current.detail)
  }

  // No Path of our own making yet. REG_EXPAND_SZ is what Windows itself creates
  // it as, so a later `%VAR%` entry of the user's keeps working.
  if (current.kind === 'missing') {
    const write = writeUserPath('Path', 'ExpandString', dir)
    if (!write.ok) return unavailable(dir, write.error)
    return { outcome: 'added', dir, detail: '' }
  }

  const next = addToPathValue(current.raw, dir)
  if (next === null) return { outcome: 'already-present', dir, detail: '' }

  const write = writeUserPath(current.name, current.valueKind, next)
  if (!write.ok) return unavailable(dir, write.error)
  return { outcome: 'added', dir, detail: '' }
}

export function uninstallUserPathEntry(dir: string): UserPathResult {
  const current = readUserPath()
  if (current.kind === 'missing') return { outcome: 'absent', dir, detail: '' }
  if (current.kind === 'error' || current.kind === 'unsupported') {
    return unavailable(dir, current.detail)
  }

  const next = removeFromPathValue(current.raw, dir)
  if (next === null) return { outcome: 'absent', dir, detail: '' }

  const write = writeUserPath(current.name, current.valueKind, next)
  if (!write.ok) return unavailable(dir, write.error)
  return { outcome: 'removed', dir, detail: '' }
}

/** What `status` needs: is our directory in the user PATH, and can we tell. */
export type UserPathState = 'present' | 'missing' | 'unknown'

export function userPathState(dir: string): Readonly<{ state: UserPathState; detail: string }> {
  const current = readUserPath()
  if (current.kind === 'missing') return { state: 'missing', detail: '' }
  if (current.kind === 'error' || current.kind === 'unsupported') {
    return { state: 'unknown', detail: current.detail }
  }
  if (pathValueContains(current.raw, dir)) return { state: 'present', detail: '' }
  return { state: 'missing', detail: '' }
}

/** Whether the PATH this very process inherited already reaches the shims. */
export function processPathContains(dir: string): boolean {
  return pathValueContains(process.env.PATH ?? process.env.Path ?? '', dir)
}
