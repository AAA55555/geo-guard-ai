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

/**
 * Shells, rc files, and what is left of the alias gate.
 *
 * geo-guard no longer *installs* aliases — the launch gate is a PATH shim (see
 * `shim.ts`), which an alias could never match: an alias is invisible to
 * `\claude`, to `command claude`, to a Makefile, to a script, and to every
 * shell whose rc we did not write. What stays here is the ability to recognize
 * an alias block we shipped earlier and take it back out, so an upgrade does
 * not leave a second, weaker gate behind — plus the shell/rc-path knowledge the
 * PATH module builds on.
 */

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

/** Our previous (unmanaged) variants — cleaned up on setup/uninstall. */
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
 * Bodies we generated ourselves, byte-for-byte (for any alias name).
 * Only such a block is ours to remove — anything else is the user's.
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
 * Still ours to remove — and the flags in it are what setup carries over to the
 * shim, so the user does not lose them in the move.
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

/**
 * The files a login bash reads, in the order bash itself tries them: it runs
 * the FIRST one that exists and ignores the rest. Anything we append has to go
 * into that same file, and creating an earlier one shadows the rest.
 */
export const BASH_LOGIN_FILE_NAMES: readonly string[] = Object.freeze([
  '.bash_profile',
  '.bash_login',
  '.profile',
])

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
    // Every login file bash might have picked, not just the one it would pick
    // today: which of them holds our block depends on what existed at install
    // time, and a block we cannot find is a block we can never remove.
    ...BASH_LOGIN_FILE_NAMES.map(name => path.join(home, name)),
    path.join(home, '.config', 'fish', 'config.fish'),
    path.join(home, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
    path.join(home, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'),
    path.join(home, '.config', 'powershell', 'Microsoft.PowerShell_profile.ps1'),
  ].filter((p): p is string => Boolean(p))

  return [...new Set(paths.map(p => path.normalize(p)))]
}

/**
 * Removes one marker block, whatever it holds. Shared with the PATH module:
 * both write marker blocks into the same rc files, and two implementations of
 * "cut between BEGIN and END" would be two chances to eat a line we didn't write.
 */
export function stripBlockBetween(content: string, begin: string, end: string): string {
  const from = content.indexOf(begin)
  if (from === -1) return content
  const to = content.indexOf(end, from)
  // No END — the block was broken by hand. Do NOT cut to the end of the file
  // (otherwise we'd wipe foreign content below). Leave as is; uninstallAliasFromFile handles it.
  if (to === -1) return content
  const after = to + end.length
  const stripped = (content.slice(0, from) + content.slice(after)).replace(/\n{3,}/g, '\n\n')
  // We append our block after a blank separator line, so removing it leaves that
  // line behind at the end of the file. Trailing blank lines carry no meaning,
  // and a file that comes back byte-for-byte as it was is worth the two lines
  // it takes to say so.
  return stripped.replace(/\n{2,}$/, '\n')
}

/** The body inside a marker block (trimmed), or null when there is no block. */
export function blockBodyBetween(content: string, begin: string, end: string): string | null {
  const from = content.indexOf(begin)
  if (from === -1) return null
  const to = content.indexOf(end, from)
  if (to === -1) return null
  return content.slice(from + begin.length, to).trim()
}

export function stripMarkedBlock(content: string, target: AliasTarget = CLAUDE_TARGET): string {
  return stripBlockBetween(content, target.begin, target.end)
}

/** The body inside the marker block (trimmed), or null if there's no block. */
export function markedBlockBody(
  content: string,
  target: AliasTarget = CLAUDE_TARGET,
): string | null {
  return blockBodyBetween(content, target.begin, target.end)
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
 * Wider than isPristineAliasBody on purpose: both are ours to remove.
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
 * Refuses the install when an rc file cannot be written. setup writes the shell
 * files last, so without this a read-only rc leaves the config and both hooks in
 * place and only the final step failing — a half-install the user has to undo
 * by hand.
 *
 * Takes the file rather than a shell: the PATH entry and the alias blocks we
 * clean up do not always live in the same rc (bash keeps the entry in ~/.bashrc
 * and the alias could be in ~/.bash_profile), and probing the wrong file would
 * be a check that proves nothing.
 *
 * Only a clear permission error counts. On Windows accessSync cannot see ACL
 * denials, and a probe failing for some other reason must not block an install
 * that would have worked.
 */
export function assertRcWritable(file: string): void {
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

/** Strips only our blocks/lines across all known rc files. */
export function uninstallAliasesEverywhere(): UninstallAliasFileResult[] {
  return candidateRcPaths().map(uninstallAliasFromFile)
}
