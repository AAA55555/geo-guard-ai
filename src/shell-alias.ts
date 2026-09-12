import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  BEGIN_MARKER,
  END_MARKER,
  CURSOR_BEGIN_MARKER,
  CURSOR_END_MARKER,
} from './config'
import { msg } from './i18n'

export type ShellName = 'zsh' | 'bash' | 'fish' | 'powershell'

export const DEFAULT_ALIAS_NAME = 'claude'

const SUPPORTED_SHELLS: ShellName[] = ['zsh', 'bash', 'fish', 'powershell']

/**
 * A command we can put behind an alias, and the marker block that alias lives
 * in. Each target owns its own block, so one can be pristine while the other
 * carries the user's flags, and removing one never disturbs the other.
 */
export type AliasTargetId = 'claude' | 'cursor-agent'

export type AliasTarget = Readonly<{
  id: AliasTargetId
  /** The geo-guard subcommand the alias wraps. */
  command: string
  /** Alias name used unless the caller asks for another. */
  defaultName: string
  begin: string
  end: string
}>

export const CLAUDE_TARGET: AliasTarget = Object.freeze({
  id: 'claude',
  command: 'claude',
  defaultName: DEFAULT_ALIAS_NAME,
  begin: BEGIN_MARKER,
  end: END_MARKER,
})

/**
 * Cursor's terminal client. The hook in ~/.cursor/hooks.json already blocks
 * prompts inside it, but only once one is submitted — and cursor-agent renders
 * a blocked submission as a status line its next redraw wipes. Wrapping the
 * launch says it once, up front, in a way that stays on screen.
 */
export const CURSOR_AGENT_TARGET: AliasTarget = Object.freeze({
  id: 'cursor-agent',
  command: 'cursor-agent',
  defaultName: 'cursor-agent',
  begin: CURSOR_BEGIN_MARKER,
  end: CURSOR_END_MARKER,
})

export const ALIAS_TARGETS: readonly AliasTarget[] = Object.freeze([
  CLAUDE_TARGET,
  CURSOR_AGENT_TARGET,
])

/** Alias body for a specific shell, name and wrapped command. */
function aliasBody(shell: ShellName, name: string, command: string): string {
  if (shell === 'powershell') return `function ${name} { geo-guard ${command} @args }`
  return `alias ${name}="geo-guard ${command}"`
}

/** Our previous (unmanaged) variants — cleaned up on reinstall/uninstall. */
function legacyOurLines(name: string, command: string): Set<string> {
  const lines = new Set([
    `alias ${name}="geo-guard ${command}"`,
    `alias ${name}='geo-guard ${command}'`,
  ])
  if (command === 'claude') {
    // Shipped before the package was renamed; only ever wrapped claude.
    lines.add(`alias ${name}="claude-geo"`)
    lines.add(`alias ${name}='claude-geo'`)
  }
  return lines
}

/**
 * Bodies we generate ourselves, byte-for-byte (for any alias name).
 * Only such a block may be regenerated on install — anything else is the user's.
 */
function pristineBodyPatterns(command: string): RegExp[] {
  const c = escapeRe(command)
  return [
    new RegExp(`^alias\\s+[\\w.-]+=(["'])geo-guard ${c}\\1$`),
    new RegExp(`^function\\s+[\\w.-]+\\s*\\{\\s*geo-guard ${c} @args\\s*\\}$`),
  ]
}

/**
 * Our alias *with the user's own flags added* — e.g.
 * `alias claude="geo-guard claude --dangerously-skip-permissions"`.
 * Still ours (uninstall may remove it), but install must not rewrite it.
 *
 * No `.` and no open-ended `[^"']`: without the `m` flag `$` is end-of-input,
 * but a negated class would happily swallow newlines and match a body that has
 * foreign lines glued below our alias.
 */
const ALIAS_BODY_RE = /^alias\s+([\w.-]+)=(["'])geo-guard[ \t]+([\w.-]+)([^"'\n]*)\2$/
const FUNCTION_BODY_RE = /^function\s+([\w.-]+)[ \t]*\{[ \t]*geo-guard[ \t]+([\w.-]+)([^}\n]*)\}$/

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

export function aliasSnippet(
  shell: ShellName,
  name: string = DEFAULT_ALIAS_NAME,
  target: AliasTarget = CLAUDE_TARGET,
): string {
  return `${target.begin}\n${aliasBody(shell, name, target.command)}\n${target.end}\n`
}

export function stripMarkedBlock(content: string, target: AliasTarget = CLAUDE_TARGET): string {
  const begin = content.indexOf(target.begin)
  if (begin === -1) return content
  const end = content.indexOf(target.end, begin)
  // No END — the block was broken by hand. Do NOT cut to the end of the file
  // (otherwise we'd wipe foreign content below). Leave as is; uninstallAliasFromFile handles it.
  if (end === -1) return content
  const after = end + target.end.length
  return (content.slice(0, begin) + content.slice(after)).replace(/\n{3,}/g, '\n\n')
}

/**
 * Removes an orphan BEGIN marker line with no matching END (block broken by hand).
 * Needed on install: otherwise a new block is appended below and we get a nested BEGIN,
 * with the user's content ending up inside the marker span. The body is removed separately
 * via stripUnmanagedOurAlias. If a matching END is absent/present — we don't touch it.
 */
function stripOrphanBeginMarker(content: string, target: AliasTarget): string {
  const begin = content.indexOf(target.begin)
  if (begin === -1) return content
  if (content.indexOf(target.end, begin) !== -1) return content
  return content
    .split('\n')
    .filter(line => line.trim() !== target.begin)
    .join('\n')
}

/** The body inside the marker block (trimmed), or null if there's no block. */
export function markedBlockBody(
  content: string,
  target: AliasTarget = CLAUDE_TARGET,
): string | null {
  const begin = content.indexOf(target.begin)
  if (begin === -1) return null
  const end = content.indexOf(target.end, begin)
  if (end === -1) return null
  return content.slice(begin + target.begin.length, end).trim()
}

/** true — if the block body is exactly what we generated (not edited by hand). */
export function isPristineAliasBody(body: string, target: AliasTarget = CLAUDE_TARGET): boolean {
  return pristineBodyPatterns(target.command).some(re => re.test(body.trim()))
}

export type ParsedAliasBody = Readonly<{
  /** Alias / function name the body defines. */
  name: string
  /** Subcommand we are wrapping (normally `claude`). */
  command: string
  /** Whatever the user appended after it, trimmed ('' for a pristine body). */
  extraArgs: string
}>

/**
 * Parses a geo-guard alias body (pristine or with the user's flags).
 * Returns null for anything that is not ours.
 */
export function parseAliasBody(body: string): ParsedAliasBody | null {
  const trimmed = body.trim()

  const alias = ALIAS_BODY_RE.exec(trimmed)
  if (alias) {
    return { name: alias[1] ?? '', command: alias[3] ?? '', extraArgs: (alias[4] ?? '').trim() }
  }

  const fn = FUNCTION_BODY_RE.exec(trimmed)
  if (fn) {
    // `@args` is part of our generated body, not a user flag.
    const extra = (fn[3] ?? '').replace(/@args/g, '').trim()
    return { name: fn[1] ?? '', command: fn[2] ?? '', extraArgs: extra }
  }

  return null
}

/**
 * true — the body is ours, whether pristine or carrying the user's own flags.
 * Wider than isPristineAliasBody on purpose: uninstall may remove such a block,
 * install may not overwrite it.
 */
export function isGeoGuardAliasBody(body: string): boolean {
  return parseAliasBody(body) !== null
}

/** Strips our previous unmanaged lines for a specific name. */
function stripUnmanagedOurAlias(content: string, name: string, command: string): string {
  const ours = legacyOurLines(name, command)
  return content
    .split('\n')
    .filter(line => !ours.has(line.trim()))
    .join('\n')
}

/** Everything of ours, whatever target it belongs to, removed from a copy. */
function withoutAnythingOfOurs(content: string, name: string): string {
  let out = content
  for (const target of ALIAS_TARGETS) {
    out = stripUnmanagedOurAlias(stripMarkedBlock(out, target), name, target.command)
  }
  return out
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
  // Every block of ours comes out first — an alias we installed is never a
  // collision with the alias we are about to install.
  const outside = withoutAnythingOfOurs(content, name)
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

/**
 * What the marker block in an rc file currently holds. One place decides this,
 * because two of them drifted: `status` used to answer "no block" for a block
 * whose END marker was missing while `setup` answered "yours, left untouched".
 */
export type AliasBlockKind = 'none' | 'pristine' | 'custom' | 'foreign'

export type AliasBlock = Readonly<{
  kind: AliasBlockKind
  /** The body as found, trimmed. Empty when there is no block. */
  body: string
  /** BEGIN is there but END is not, so where the block ends is unknown. */
  broken: boolean
  /** The alias name, when the body parses as ours. */
  name: string | null
}>

const NO_BLOCK: AliasBlock = Object.freeze({
  kind: 'none',
  body: '',
  broken: false,
  name: null,
})

/**
 * The name a body defines. parseAliasBody is stricter on purpose — it refuses
 * anything spread over lines, so foreign lines glued under our alias cannot be
 * read as ours — but a body we already know is pristine can be spread over
 * lines legitimately (the PowerShell function form), and it still has a name.
 */
const DEFINED_NAME_RE = /^(?:alias|function)\s+([\w.-]+)/

function classify(body: string, broken: boolean, target: AliasTarget): AliasBlock {
  if (isPristineAliasBody(body, target)) {
    const name = parseAliasBody(body)?.name ?? DEFINED_NAME_RE.exec(body.trim())?.[1] ?? null
    return { kind: 'pristine', body, broken, name }
  }
  const parsed = parseAliasBody(body)
  if (parsed) return { kind: 'custom', body, broken, name: parsed.name }
  return { kind: 'foreign', body, broken, name: null }
}

export function readAliasBlock(
  content: string,
  target: AliasTarget = CLAUDE_TARGET,
): AliasBlock {
  const begin = content.indexOf(target.begin)
  if (begin === -1) return NO_BLOCK

  const end = content.indexOf(target.end, begin)
  if (end !== -1) {
    return classify(content.slice(begin + target.begin.length, end).trim(), false, target)
  }

  // Broken block: we know where it starts, not where it ends. Judge it by its
  // first line — that is as much as we can honestly attribute to the block.
  const firstLine = content
    .slice(begin + target.begin.length)
    .split('\n')
    .map(line => line.trim())
    .find(line => line !== '')
  if (firstLine === undefined) return { ...NO_BLOCK, broken: true }
  return classify(firstLine, true, target)
}

/**
 * The existing block we must not touch, or null when it's ours to regenerate.
 *
 * A block whose END marker someone deleted is only repairable when its body is
 * one we generated: stripUnmanagedOurAlias knows how to remove exactly that
 * line. Anything else stays put — repairing it would append a second
 * `alias claude=…` below the user's own, which in zsh/bash wins, silently
 * dropping their flags.
 */
function preservedBlock(
  content: string,
  overwriteCustom: boolean,
  target: AliasTarget,
): { kind: PreservedAliasKind; body: string } | null {
  const block = readAliasBlock(content, target)
  if (block.kind === 'none' || block.kind === 'pristine') return null

  // `--force-alias` means "yes, replace the alias I edited" — it does not mean
  // "delete whatever you find between those markers". Content we cannot
  // recognize as ours is never overwritten: there is no backup of an rc file,
  // and the whole of this package refuses to destroy data it did not write.
  if (overwriteCustom && block.kind === 'custom') return null
  return { kind: block.kind, body: block.body }
}

/**
 * Why an existing block was left alone:
 * - `custom`  — our alias plus the user's own flags;
 * - `foreign` — something else entirely between our markers.
 */
export type PreservedAliasKind = 'custom' | 'foreign'

/**
 * Refuses the install when the rc cannot be written. setup writes the alias
 * last, so without this a read-only rc leaves the config and both hooks in
 * place and only the final step failing — a half-install the user has to undo
 * by hand.
 *
 * Only a clear permission error counts. On Windows accessSync cannot see ACL
 * denials, and a probe failing for some other reason must not block an install
 * that would have worked.
 */
export function assertAliasWritable(shell: ShellName = detectShell()): void {
  const file = rcPathForShellResolved(shell)
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const target = fs.existsSync(file) ? file : path.dirname(file)
    fs.accessSync(target, fs.constants.W_OK)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
      throw new Error(msg().rcNotWritable(file))
    }
  }
}

export type InstallAliasResult = {
  shell: ShellName
  file: string
  name: string
  snippet: string
  /** null — the block was written; otherwise the file was not touched at all. */
  preserved: PreservedAliasKind | null
  /** The body we kept, when preserved. */
  existingBody: string | null
}

/**
 * Writes the alias to the rc. Name defaults to `claude`.
 *
 * An existing block is regenerated only if its body is exactly what we generate.
 * A body the user has edited (say, `geo-guard claude --dangerously-skip-permissions`)
 * is kept as is and the file is not touched — unless `overwriteCustom` is set.
 *
 * If a foreign alias with this name is found and `skipConflictCheck` is not set —
 * throws AliasConflictError.
 */
export function installAlias(
  shell: ShellName = detectShell(),
  options: Readonly<{
    name?: string
    skipConflictCheck?: boolean
    overwriteCustom?: boolean
    target?: AliasTarget
  }> = {},
): InstallAliasResult {
  const target = options.target ?? CLAUDE_TARGET
  const name = options.name ?? target.defaultName
  const file = rcPathForShellResolved(shell)
  fs.mkdirSync(path.dirname(file), { recursive: true })

  const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''

  const preserved = preservedBlock(original, options.overwriteCustom ?? false, target)
  if (preserved) {
    const parsed = parseAliasBody(preserved.body)
    return {
      shell,
      file,
      // For our own customized block the name in the file is the truth.
      name: parsed?.name ?? name,
      snippet: '',
      preserved: preserved.kind,
      existingBody: preserved.body,
    }
  }

  const withoutOurs = stripMarkedBlock(original, target)
  let content = stripOrphanBeginMarker(withoutOurs, target)
  content = stripUnmanagedOurAlias(content, name, target.command)

  if (!options.skipConflictCheck) {
    const conflict = findConflictingAlias(content, shell, name)
    if (conflict) throw new AliasConflictError(name, conflict, file)
  }

  // Already exactly right: don't rewrite the file. Regenerating would move this
  // block to the bottom — so with two of them, every `setup` run would swap
  // their order — and stripMarkedBlock collapses blank runs across the whole
  // file, which is not ours to reformat.
  const block = readAliasBlock(original, target)
  const upToDate =
    block.kind === 'pristine' &&
    !block.broken &&
    block.body === aliasBody(shell, name, target.command) &&
    content === withoutOurs
  if (upToDate) {
    return {
      shell,
      file,
      name,
      snippet: aliasSnippet(shell, name, target).trim(),
      preserved: null,
      existingBody: null,
    }
  }

  if (content.length && !content.endsWith('\n')) content += '\n'
  content += `\n${aliasSnippet(shell, name, target)}`
  fs.writeFileSync(file, content)

  return {
    shell,
    file,
    name,
    snippet: aliasSnippet(shell, name, target).trim(),
    preserved: null,
    existingBody: null,
  }
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

  // Each block is judged on its own: a claude block someone edited by hand is no
  // reason to leave the cursor-agent one behind, and vice versa.
  let after = before
  let modified = false
  for (const target of ALIAS_TARGETS) {
    const begin = after.indexOf(target.begin)
    if (begin !== -1 && after.indexOf(target.end, begin) === -1) {
      // BEGIN present, END absent — block broken by hand. Don't touch it at all.
      modified = true
      continue
    }

    const body = markedBlockBody(after, target)
    if (body !== null && !isGeoGuardAliasBody(body)) {
      // Foreign content between our markers — don't touch, it may hold something important.
      // Our own alias carrying the user's extra flags is still ours and does get removed.
      modified = true
      continue
    }

    after = stripMarkedBlock(after, target)
    after = stripUnmanagedOurAlias(after, target.defaultName, target.command)
  }

  if (after === before) {
    return { file, changed: false, modified }
  }
  fs.writeFileSync(file, after)
  return { file, changed: true, modified }
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
