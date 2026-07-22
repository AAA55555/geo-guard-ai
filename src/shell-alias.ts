import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { BEGIN_MARKER, END_MARKER } from './config'
import { msg } from './i18n'

export type ShellName = 'zsh' | 'bash' | 'fish' | 'powershell'

export const DEFAULT_ALIAS_NAME = 'claude'

const SUPPORTED_SHELLS: ShellName[] = ['zsh', 'bash', 'fish', 'powershell']

/** Alias body for a specific shell and name. */
function aliasBody(shell: ShellName, name: string): string {
  if (shell === 'powershell') return `function ${name} { geo-guard claude @args }`
  return `alias ${name}="geo-guard claude"`
}

/** Our previous (unmanaged) variants — cleaned up on reinstall/uninstall. */
function legacyOurLines(name: string): Set<string> {
  return new Set([
    `alias ${name}="claude-geo"`,
    `alias ${name}='claude-geo'`,
    `alias ${name}="geo-guard claude"`,
    `alias ${name}='geo-guard claude'`,
  ])
}

/** Whether the block body matches what we generate (for any name). */
const OUR_BODY_PATTERNS: RegExp[] = [
  /^alias\s+[\w.-]+=(["'])geo-guard claude\1$/,
  /^function\s+[\w.-]+\s*\{\s*geo-guard claude @args\s*\}$/,
]

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export class AliasConflictError extends Error {
  readonly aliasName: string
  readonly existing: string
  readonly file: string
  constructor(aliasName: string, existing: string, file: string) {
    super(msg().aliasAlreadyExists(aliasName, existing))
    this.name = 'AliasConflictError'
    this.aliasName = aliasName
    this.existing = existing
    this.file = file
  }
}

export function listSupportedShells(): ShellName[] {
  return [...SUPPORTED_SHELLS]
}

export function normalizeShellName(raw: string): ShellName | null {
  const s = String(raw).toLowerCase().replace(/\.exe$/, '')
  if (s.includes('zsh')) return 'zsh'
  if (s.includes('bash')) return 'bash'
  if (s.includes('fish')) return 'fish'
  if (s.includes('pwsh') || s.includes('powershell')) return 'powershell'
  return null
}

export function detectShell(): ShellName {
  if (process.env.GEO_GUARD_SHELL) {
    return normalizeShellName(process.env.GEO_GUARD_SHELL) ?? 'zsh'
  }

  const shellPath = process.env.SHELL || ''
  const base = path.basename(shellPath).toLowerCase()
  if (base) {
    const name = normalizeShellName(base)
    if (name) return name
  }

  return process.platform === 'win32' ? 'powershell' : 'zsh'
}

export function rcPathForShell(shell: ShellName): string {
  const home = os.homedir()
  switch (shell) {
    case 'zsh':
      return path.join(home, '.zshrc')
    case 'bash': {
      const bashrc = path.join(home, '.bashrc')
      const profile = path.join(home, '.bash_profile')
      if (fs.existsSync(bashrc)) return bashrc
      if (process.platform === 'darwin' && fs.existsSync(profile)) return profile
      return bashrc
    }
    case 'fish':
      return path.join(home, '.config', 'fish', 'config.fish')
    case 'powershell': {
      if (process.env.GEO_GUARD_RC) return process.env.GEO_GUARD_RC
      if (process.platform === 'win32') {
        return path.join(home, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1')
      }
      return path.join(home, '.config', 'powershell', 'Microsoft.PowerShell_profile.ps1')
    }
  }
}

export function rcPathForShellResolved(shell: ShellName): string {
  return process.env.GEO_GUARD_RC || rcPathForShell(shell)
}

/**
 * All rc files setup might have written to (for a full uninstall).
 *
 * If GEO_GUARD_RC is set explicitly — we work with ONLY it. The user (or a test)
 * named a specific file, and touching system ~/.zshrc and friends is not allowed
 * in that case: it's both surprising and breaks environment isolation.
 */
export function candidateRcPaths(): string[] {
  if (process.env.GEO_GUARD_RC) {
    return [path.normalize(process.env.GEO_GUARD_RC)]
  }

  const home = os.homedir()
  const paths = [
    path.join(home, '.zshrc'),
    path.join(home, '.bashrc'),
    path.join(home, '.bash_profile'),
    path.join(home, '.config', 'fish', 'config.fish'),
    path.join(home, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
    path.join(home, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'),
    path.join(home, '.config', 'powershell', 'Microsoft.PowerShell_profile.ps1'),
  ].filter((p): p is string => Boolean(p))

  return [...new Set(paths.map(p => path.normalize(p)))]
}

export function aliasSnippet(shell: ShellName, name: string = DEFAULT_ALIAS_NAME): string {
  return `${BEGIN_MARKER}\n${aliasBody(shell, name)}\n${END_MARKER}\n`
}

export function stripMarkedBlock(content: string): string {
  const begin = content.indexOf(BEGIN_MARKER)
  if (begin === -1) return content
  const end = content.indexOf(END_MARKER, begin)
  // No END — the block was broken by hand. Do NOT cut to the end of the file
  // (otherwise we'd wipe foreign content below). Leave as is; uninstallAliasFromFile handles it.
  if (end === -1) return content
  const after = end + END_MARKER.length
  return (content.slice(0, begin) + content.slice(after)).replace(/\n{3,}/g, '\n\n')
}

/**
 * Removes an orphan BEGIN marker line with no matching END (block broken by hand).
 * Needed on install: otherwise a new block is appended below and we get a nested BEGIN,
 * with the user's content ending up inside the marker span. The body is removed separately
 * via stripUnmanagedOurAlias. If a matching END is absent/present — we don't touch it.
 */
function stripOrphanBeginMarker(content: string): string {
  const begin = content.indexOf(BEGIN_MARKER)
  if (begin === -1) return content
  if (content.indexOf(END_MARKER, begin) !== -1) return content
  return content
    .split('\n')
    .filter(line => line.trim() !== BEGIN_MARKER)
    .join('\n')
}

/** The body inside the marker block (trimmed), or null if there's no block. */
function markedBlockBody(content: string): string | null {
  const begin = content.indexOf(BEGIN_MARKER)
  if (begin === -1) return null
  const end = content.indexOf(END_MARKER, begin)
  if (end === -1) return null
  return content.slice(begin + BEGIN_MARKER.length, end).trim()
}

/** true — if the block body is exactly what we generated (not edited by hand). */
export function isOurAliasBody(body: string): boolean {
  return OUR_BODY_PATTERNS.some(re => re.test(body))
}

/** Strips our previous unmanaged lines for a specific name. */
function stripUnmanagedOurAlias(content: string, name: string): string {
  const ours = legacyOurLines(name)
  return content
    .split('\n')
    .filter(line => !ours.has(line.trim()))
    .join('\n')
}

/** Regex detecting an alias/function with the given name for a shell. */
function aliasDefRegex(shell: ShellName, name: string): RegExp {
  const n = escapeRe(name)
  // Function name terminator: space / { / ( / end of line.
  // NOT \b — there '-' and '.' count as a boundary, and 'claude' would falsely match 'function claude-code'.
  const fnEnd = '(?=\\s|\\{|\\(|$)'
  if (shell === 'powershell') {
    // The name is the first positional argument (or -Name), NOT the value.
    // `Set-Alias gc claude` must not be treated as a collision on the name `claude`.
    return new RegExp(
      `^\\s*(function\\s+${n}${fnEnd}|(Set-Alias|New-Alias|sal|nal)\\b\\s+(-Name\\s+)?["']?${n}["']?(\\s|$))`,
      'i',
    )
  }
  if (shell === 'fish') {
    return new RegExp(`^\\s*(alias\\s+(-{1,2}[^\\s]+\\s+)*${n}[\\s=]|function\\s+${n}${fnEnd})`)
  }
  // zsh/bash: alias claude=…, alias -g claude=…, function claude {…}, claude() {…}
  return new RegExp(`^\\s*(alias\\s+(-g\\s+)?${n}=|function\\s+${n}${fnEnd}|${n}\\s*\\(\\s*\\))`)
}

/** Finds a FOREIGN alias named `name` (outside our markers and unmanaged lines). */
export function findConflictingAlias(
  content: string,
  shell: ShellName,
  name: string,
): string | null {
  const outside = stripUnmanagedOurAlias(stripMarkedBlock(content), name)
  const re = aliasDefRegex(shell, name)
  for (const line of outside.split('\n')) {
    if (re.test(line)) return line.trim()
  }
  return null
}

/** Whether a foreign alias named `name` exists in the current shell's rc. */
export function aliasConflictFor(
  shell: ShellName,
  name: string,
): { file: string; existing: string } | null {
  const file = rcPathForShellResolved(shell)
  if (!fs.existsSync(file)) return null
  const existing = findConflictingAlias(fs.readFileSync(file, 'utf8'), shell, name)
  return existing ? { file, existing } : null
}

export type InstallAliasResult = {
  shell: ShellName
  file: string
  name: string
  snippet: string
}

/**
 * Writes the alias to the rc. Name defaults to `claude`.
 * If a foreign alias with this name is found and force is not set — throws AliasConflictError.
 */
export function installAlias(
  shell: ShellName = detectShell(),
  options: Readonly<{ name?: string; force?: boolean }> = {},
): InstallAliasResult {
  const name = options.name ?? DEFAULT_ALIAS_NAME
  const file = rcPathForShellResolved(shell)
  fs.mkdirSync(path.dirname(file), { recursive: true })

  const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  let content = stripMarkedBlock(original)
  content = stripOrphanBeginMarker(content)
  content = stripUnmanagedOurAlias(content, name)

  if (!options.force) {
    const conflict = findConflictingAlias(content, shell, name)
    if (conflict) throw new AliasConflictError(name, conflict, file)
  }

  if (content.length && !content.endsWith('\n')) content += '\n'
  content += `\n${aliasSnippet(shell, name)}`
  fs.writeFileSync(file, content)

  return { shell, file, name, snippet: aliasSnippet(shell, name).trim() }
}

export type UninstallAliasFileResult = {
  file: string
  /** true — our block/lines were removed */
  changed: boolean
  /** true — block found, but edited by hand → left as is */
  modified: boolean
}

export function uninstallAliasFromFile(file: string): UninstallAliasFileResult {
  if (!fs.existsSync(file)) {
    return { file, changed: false, modified: false }
  }
  const before = fs.readFileSync(file, 'utf8')

  const begin = before.indexOf(BEGIN_MARKER)
  if (begin !== -1 && before.indexOf(END_MARKER, begin) === -1) {
    // BEGIN present, END absent — block broken by hand. Don't touch the file at all.
    return { file, changed: false, modified: true }
  }

  const body = markedBlockBody(before)
  if (body !== null && !isOurAliasBody(body)) {
    // Block edited by hand (not our body) — don't touch, it may hold something important.
    return { file, changed: false, modified: true }
  }

  let after = stripMarkedBlock(before)
  after = stripUnmanagedOurAlias(after, DEFAULT_ALIAS_NAME)
  if (after === before) {
    return { file, changed: false, modified: false }
  }
  fs.writeFileSync(file, after)
  return { file, changed: true, modified: false }
}

export function uninstallAlias(shell: ShellName = detectShell()): UninstallAliasFileResult & {
  shell: ShellName
} {
  const file = rcPathForShellResolved(shell)
  return { shell, ...uninstallAliasFromFile(file) }
}

/** Strips only our blocks/lines across all known rc files. */
export function uninstallAliasesEverywhere(): UninstallAliasFileResult[] {
  return candidateRcPaths().map(uninstallAliasFromFile)
}
