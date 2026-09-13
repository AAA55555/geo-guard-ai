import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  PATH_BEGIN_MARKER,
  PATH_END_MARKER,
} from './config'
import { commandExists } from './resolve-bin'
import {
  BASH_LOGIN_FILE_NAMES,
  blockBodyBetween,
  candidateRcPaths,
  detectShell,
  rcPathForShell,
  stripBlockBetween,
  type ShellName,
} from './shell-alias'
import { shimDir } from './shim-paths'

/**
 * Putting the shim directory on PATH, in every shell the user actually has.
 *
 * The alias gate only ever covered the one rc file setup wrote to: bash does
 * not read ~/.zshrc, and nothing outside an interactive prompt reads an alias
 * at all. A PATH entry is read by every shell that starts, which is the point.
 */

/** Which rc file carries the PATH entry for a shell. */
export function pathRcPathForShell(shell: ShellName): string {
  if (process.env.GEO_GUARD_RC) return process.env.GEO_GUARD_RC

  // bash is the one shell where this differs from the alias module: that one
  // falls back to ~/.bash_profile when no ~/.bashrc exists, while here ~/.bashrc
  // always carries the entry for interactive shells and installBashLoginPathEntry
  // puts a second copy in the login file, which reads neither the other's.
  if (shell === 'bash') return path.join(os.homedir(), '.bashrc')
  return rcPathForShell(shell)
}

/** Single-quote escaping for the PowerShell literal. */
function psQuote(value: string): string {
  return value.replace(/'/g, "''")
}

/**
 * The PATH line, idempotent *in the shell itself* and not merely at write time:
 * rc files get sourced more than once (a `source ~/.zshrc`, a nested shell),
 * and a blind prepend would grow PATH a copy at a time.
 */
export function pathBody(shell: ShellName, dir: string = shimDir()): string {
  if (shell === 'fish') {
    // fish_add_path is already a no-op when the entry is there.
    return `fish_add_path -p "${dir}"`
  }
  if (shell === 'powershell') {
    return [
      `$geoGuardBin = '${psQuote(dir)}'`,
      'if (($env:PATH -split [IO.Path]::PathSeparator) -notcontains $geoGuardBin) {',
      '  $env:PATH = $geoGuardBin + [IO.Path]::PathSeparator + $env:PATH',
      '}',
    ].join('\n')
  }
  return [
    'case ":$PATH:" in',
    `  *":${dir}:"*) ;;`,
    `  *) PATH="${dir}:$PATH" ;;`,
    'esac',
    'export PATH',
  ].join('\n')
}

export function pathSnippet(shell: ShellName, dir: string = shimDir()): string {
  return `${PATH_BEGIN_MARKER}\n${pathBody(shell, dir)}\n${PATH_END_MARKER}\n`
}

/** Pulls the directory back out of a block we generated, for any shell. */
function parsePathBody(body: string): string | null {
  const patterns = [
    /^\s*\*\) PATH="(.+):\$PATH" ;;$/m,
    /^fish_add_path -p "(.+)"$/m,
    /^\$geoGuardBin = '(.*)'$/m,
  ]
  for (const re of patterns) {
    const match = re.exec(body)
    if (match) return match[1] ?? ''
  }
  return null
}

/**
 * What our PATH markers currently hold:
 * - `none`     — no block;
 * - `pristine` — a block we generated (for this directory or an older one);
 * - `foreign`  — something else between our markers.
 *
 * A block naming a different directory is still pristine: the shim directory
 * moves when GEO_GUARD_SHIM_DIR does, and refusing to update our own line
 * would leave the gate pointing at a directory that no longer exists.
 */
export type PathBlockKind = 'none' | 'pristine' | 'foreign'

export type PathBlock = Readonly<{
  kind: PathBlockKind
  body: string
  /** The directory the block adds, when we can read it. */
  dir: string | null
  /** BEGIN is there but END is not — the block was broken by hand. */
  broken: boolean
}>

const NO_PATH_BLOCK: PathBlock = Object.freeze({
  kind: 'none',
  body: '',
  dir: null,
  broken: false,
})

export function readPathBlock(content: string): PathBlock {
  const begin = content.indexOf(PATH_BEGIN_MARKER)
  if (begin === -1) return NO_PATH_BLOCK

  const body = blockBodyBetween(content, PATH_BEGIN_MARKER, PATH_END_MARKER)
  if (body === null) {
    // BEGIN without END: we know where it starts, not where it ends. Nothing
    // here may be rewritten — whatever sits below could be the user's.
    return { kind: 'foreign', body: '', dir: null, broken: true }
  }

  const dir = parsePathBody(body)
  if (dir === null) return { kind: 'foreign', body, dir: null, broken: false }
  return { kind: 'pristine', body, dir, broken: false }
}

/** Whether the shim directory is already wired into this shell's rc. */
export function pathEntryPresent(shell: ShellName = detectShell()): boolean {
  const file = pathRcPathForShell(shell)
  let content: string
  try {
    content = fs.readFileSync(file, 'utf8')
  } catch {
    return false
  }
  const block = readPathBlock(content)
  return block.kind === 'pristine' && block.dir === shimDir()
}

export type InstallPathResult = Readonly<{
  shell: ShellName
  file: string
  dir: string
  /** true — we wrote the file. */
  changed: boolean
  /** true — the entry was already exactly right, nothing written. */
  alreadyPresent: boolean
  /** 'foreign' — something we did not write sits between our markers. */
  preserved: 'foreign' | null
}>

export function installPathEntry(
  shell: ShellName = detectShell(),
  options: Readonly<{ dir?: string }> = {},
): InstallPathResult {
  return installPathEntryInFile(pathRcPathForShell(shell), shell, options.dir ?? shimDir())
}

/**
 * The same, into a named file. bash needs two of them: ~/.bashrc for the
 * interactive shells a terminal starts, and its login file for the ones that
 * are not interactive — where a distribution's ~/.bashrc typically returns
 * before reaching anything we appended.
 */
function installPathEntryInFile(file: string, shell: ShellName, dir: string): InstallPathResult {
  fs.mkdirSync(path.dirname(file), { recursive: true })

  let original = ''
  try {
    original = fs.readFileSync(file, 'utf8')
  } catch {
    // No rc file yet — we create it below, with only our block in it.
  }

  const block = readPathBlock(original)
  if (block.kind === 'foreign') {
    return { shell, file, dir, changed: false, alreadyPresent: false, preserved: 'foreign' }
  }

  const body = pathBody(shell, dir)
  if (block.kind === 'pristine' && block.body === body) {
    return { shell, file, dir, changed: false, alreadyPresent: true, preserved: null }
  }

  let content = stripBlockBetween(original, PATH_BEGIN_MARKER, PATH_END_MARKER)
  if (content.length && !content.endsWith('\n')) content += '\n'
  content += `\n${pathSnippet(shell, dir)}`
  fs.writeFileSync(file, content)

  return { shell, file, dir, changed: true, alreadyPresent: false, preserved: null }
}

export type UninstallPathResult = Readonly<{
  file: string
  /** true — our block was removed. */
  changed: boolean
  /** true — a block is there, but it is not ours to remove. */
  modified: boolean
}>

/** Strips our PATH block from one file. */
export function uninstallPathEntry(file: string): UninstallPathResult {
  let before: string
  try {
    before = fs.readFileSync(file, 'utf8')
  } catch {
    return { file, changed: false, modified: false }
  }

  let after = before
  let modified = false

  const block = readPathBlock(after)
  if (block.kind === 'foreign') {
    modified = true
  } else if (block.kind === 'pristine') {
    after = stripBlockBetween(after, PATH_BEGIN_MARKER, PATH_END_MARKER)
  }

  if (after === before) return { file, changed: false, modified }
  fs.writeFileSync(file, after)
  return { file, changed: true, modified }
}

export type BashLoginPathResult = Readonly<{
  file: string
  /** true — we wrote the block. */
  changed: boolean
  /** true — our block was already exactly there. */
  alreadyPresent: boolean
}>

/**
 * The login file bash would actually read: the first one that exists, and
 * ~/.bash_profile only when bash would read none.
 *
 * Creating ~/.bash_profile unconditionally is wrong everywhere except a home
 * directory with no login file at all. On Debian, Ubuntu and most other
 * distributions ~/.profile is the one that exists — a ~/.bash_profile we create
 * next to it silently takes its place, and everything the distribution or the
 * user put in ~/.profile stops running.
 */
export function bashLoginFile(): string {
  const home = os.homedir()
  for (const name of BASH_LOGIN_FILE_NAMES) {
    const file = path.join(home, name)
    if (fs.existsSync(file)) return file
  }
  return path.join(home, BASH_LOGIN_FILE_NAMES[0] ?? '.bash_profile')
}

/**
 * The PATH entry for bash goes into the login file as well as ~/.bashrc.
 *
 * Two files, because bash reads different ones depending on how it started and
 * neither covers the other:
 *
 * - a *login* bash (what Terminal and iTerm start on macOS, and what `bash -l`,
 *   cron and `ssh host cmd` produce) reads its login file and never ~/.bashrc;
 * - an *interactive non-login* bash (what a Linux terminal starts) reads
 *   ~/.bashrc and never the login file.
 *
 * Sourcing ~/.bashrc from the login file — the usual macOS workaround — looks
 * like it joins the two, but it does not: Debian's stock ~/.bashrc returns on
 * its second line unless the shell is interactive, so `bash -lc claude` runs
 * past everything appended to it. It also drags the user's whole interactive
 * configuration into every login shell, which is a change to their environment
 * we have no business making on behalf of a PATH entry. One idempotent `case`
 * block in each file is smaller, and actually works.
 */
export function installBashLoginPathEntry(dir: string = shimDir()): BashLoginPathResult | null {
  // GEO_GUARD_RC means "this one file and nothing else" — the whole point of
  // pinning it is that no other file on the machine is touched.
  if (process.env.GEO_GUARD_RC) return null

  const file = bashLoginFile()
  if (file === pathRcPathForShell('bash')) return null

  const result = installPathEntryInFile(file, 'bash', dir)
  return { file, changed: result.changed, alreadyPresent: result.alreadyPresent }
}

/** A shell to install into: a specific one, or every shell the user has. */
export type ShellSpec = ShellName | 'all'

/** Binaries that mean "this shell is installed here". */
const SHELL_BINARIES: Readonly<Record<ShellName, readonly string[]>> = {
  zsh: ['zsh'],
  bash: ['bash'],
  fish: ['fish'],
  powershell: ['pwsh', 'powershell'],
}

const ALL_SHELLS: readonly ShellName[] = ['zsh', 'bash', 'fish', 'powershell']

function shellPresent(shell: ShellName): boolean {
  if (SHELL_BINARIES[shell].some(commandExists)) return true
  return fs.existsSync(pathRcPathForShell(shell))
}

/**
 * The shells to write the PATH entry into.
 *
 * 'all' is the default for the launch gate: the point of moving off the alias
 * is that a user who types `bash` does not lose the gate. The shell we were
 * started from is always included, installed or not — it demonstrably exists.
 */
export function shellsToInstall(spec: ShellSpec): ShellName[] {
  if (spec !== 'all') return [spec]

  const current = detectShell()
  const shells = ALL_SHELLS.filter(shell => shell === current || shellPresent(shell))
  return shells
}

/** Strips our PATH blocks from every rc file setup could have written to. */
export function uninstallPathEntriesEverywhere(
  files: readonly string[] = candidateRcPaths(),
): UninstallPathResult[] {
  return files.map(uninstallPathEntry)
}
