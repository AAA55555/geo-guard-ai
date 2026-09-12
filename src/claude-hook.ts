import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { msg } from './i18n'
import { hookCommand, isOurHook, isPlainObject } from './hook-shared'

export { hookCommand, isOurHook }

type ClaudeHook = {
  type?: string
  command?: string
  timeout?: number
  statusMessage?: string
  [key: string]: unknown
}

type ClaudeHookMatcher = {
  hooks?: ClaudeHook[]
  [key: string]: unknown
}

/** What we install when there is nothing to preserve. */
function defaultHook(): ClaudeHook {
  return {
    type: 'command',
    command: hookCommand(),
    timeout: 10,
    statusMessage: 'Geo-check…',
  }
}

type ClaudeSettings = {
  hooks?: {
    UserPromptSubmit?: ClaudeHookMatcher[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

/**
 * Refuses to work on a settings.json whose hook section is not the shape Claude
 * Code writes. Without this the `??=` below leaves a string or a number in
 * place and `.push` blows up with a TypeError that says nothing useful — and by
 * then setup has already written the config.
 */
export function assertClaudeHooksInstallable(): void {
  const { file, settings } = readSettings()
  assertShape(file, settings)
}

/** The same check against a settings object the caller has already read. */
function assertShape(file: string, settings: ClaudeSettings): void {
  // The root first: on an array or a primitive every `??=` below silently does
  // nothing useful, JSON.stringify drops what we added, and setup reports a
  // hook it never installed — the machine ends up ungated but looking fine.
  if (!isPlainObject(settings)) {
    throw new Error(msg().invalidHookRoot(file))
  }
  if (settings.hooks === undefined) return

  if (!isPlainObject(settings.hooks)) {
    throw new Error(msg().invalidHookShape(file, 'hooks'))
  }
  const list = settings.hooks.UserPromptSubmit
  if (list !== undefined && !Array.isArray(list)) {
    throw new Error(msg().invalidHookShape(file, 'hooks.UserPromptSubmit'))
  }
}

export function settingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json')
}

function readSettings(): { file: string; settings: ClaudeSettings } {
  const file = settingsPath()
  if (!fs.existsSync(file)) return { file, settings: {} }
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return { file, settings: {} }
  try {
    return { file, settings: JSON.parse(raw) as ClaudeSettings }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(msg().invalidJson(file, message))
  }
}

function writeSettings(file: string, settings: ClaudeSettings): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const bak = `${file}.bak`
  // One-time backup: don't overwrite, so the original is never lost.
  if (fs.existsSync(file) && !fs.existsSync(bak)) {
    fs.copyFileSync(file, bak)
  }
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`)
}

function stripOurHooks(settings: ClaudeSettings): ClaudeSettings {
  const matchers = settings.hooks?.UserPromptSubmit
  if (!Array.isArray(matchers)) return settings

  const hooks = settings.hooks
  if (!hooks) return settings

  // Only entries we recognize AND actually took something out of are rewritten.
  // A matcher shaped in a way we don't understand — or one that simply holds no
  // hook of ours — is left exactly as it was: it is not ours to delete.
  let removed = false
  hooks.UserPromptSubmit = matchers.filter(matcher => {
    if (!isPlainObject(matcher) || !Array.isArray(matcher.hooks)) return true

    const kept = matcher.hooks.filter(hook => !isOurHook(hook))
    if (kept.length === matcher.hooks.length) return true

    removed = true
    matcher.hooks = kept
    // Drop it only if it existed solely to carry our hook.
    return kept.length > 0
  })

  // Tidy up only what we emptied ourselves. An already-empty UserPromptSubmit
  // is someone else's structure — deleting it would be a write to a file we
  // took nothing out of.
  if (removed && hooks.UserPromptSubmit.length === 0) {
    delete hooks.UserPromptSubmit
  }
  if (removed && Object.keys(hooks).length === 0) {
    delete settings.hooks
  }
  return settings
}

/** Our entry as it should end up: the user's fields kept, our command enforced. */
function mergeOurHook(hook: ClaudeHook): ClaudeHook {
  return { ...defaultHook(), ...hook, command: hookCommand() }
}

function isDefaultHook(hook: ClaudeHook): boolean {
  return JSON.stringify(hook) === JSON.stringify(defaultHook())
}

/**
 * The one of our entries carrying settings of the user's own, or simply the
 * first if none do. Looks across every matcher: duplicates from older installs
 * can appear anywhere in the file.
 */
function richestOurHook(matchers: readonly ClaudeHookMatcher[]): ClaudeHook | undefined {
  let first: ClaudeHook | undefined
  for (const matcher of matchers) {
    if (!isPlainObject(matcher) || !Array.isArray(matcher.hooks)) continue
    for (const hook of matcher.hooks) {
      if (!isOurHook(hook)) continue
      first ??= hook
      if (!isDefaultHook(mergeOurHook(hook))) return hook
    }
  }
  return first
}

/**
 * Updates our entry in place (keeping the user's timeout/statusMessage and the
 * matcher it sits in) and drops any duplicates. Returns whether one was found
 * and whether it carried settings of the user's own.
 */
function updateOurHooksInPlace(settings: ClaudeSettings): {
  found: boolean
  kept: boolean
  emptied: ClaudeHookMatcher[]
} {
  const matchers = settings.hooks?.UserPromptSubmit
  if (!Array.isArray(matchers)) return { found: false, kept: false, emptied: [] }

  let found = false
  const emptied: ClaudeHookMatcher[] = []

  // Which of our entries the survivor is built from. Duplicates are collapsed,
  // and the settings the user edited can sit on any of them — taking the first
  // one blindly would drop a timeout they set on the second.
  const template = richestOurHook(matchers)
  const kept = template !== undefined && !isDefaultHook(mergeOurHook(template))

  for (const matcher of matchers) {
    if (!isPlainObject(matcher)) continue
    const hooks = matcher.hooks
    if (!Array.isArray(hooks)) continue

    const next: ClaudeHook[] = []
    // Whether this matcher held a hook of ours. If it didn't, we rewrite
    // nothing here — not even to the same value.
    let touched = false
    for (const hook of hooks) {
      if (!isOurHook(hook)) {
        next.push(hook)
        continue
      }
      touched = true
      // Only one survives — the rest are leftovers from older installs.
      if (found) continue
      found = true
      next.push(mergeOurHook(template ?? hook))
    }
    if (!touched) continue
    matcher.hooks = next
    if (next.length === 0) emptied.push(matcher)
  }

  return { found, kept, emptied }
}

/**
 * Whether our entry is in the file right now. Reads only — `status` must be
 * able to ask this without the install path's habit of creating what is missing.
 */
export function claudeHookInstalled(): boolean {
  const { settings } = readSettings()
  const hooks = settings?.hooks
  if (!isPlainObject(hooks)) return false
  const matchers = hooks.UserPromptSubmit
  if (!Array.isArray(matchers)) return false

  for (const matcher of matchers) {
    if (!isPlainObject(matcher)) continue
    const list = matcher.hooks
    if (!Array.isArray(list)) continue
    if (list.some(hook => isOurHook(hook as ClaudeHook))) return true
  }
  return false
}

export function installClaudeHook(): { file: string; command: string; kept: boolean } {
  const { file, settings } = readSettings()
  assertShape(file, settings)

  const { found, kept, emptied } = updateOurHooksInPlace(settings)
  if (!found) {
    settings.hooks ??= {}
    settings.hooks.UserPromptSubmit ??= []
    settings.hooks.UserPromptSubmit.push({ hooks: [defaultHook()] })
  } else if (emptied.length > 0) {
    // Matchers that held nothing but our duplicates. Only those: a matcher that
    // was already empty, or that we never touched, stays where the user put it.
    const matchers = settings.hooks?.UserPromptSubmit
    if (Array.isArray(matchers) && settings.hooks) {
      settings.hooks.UserPromptSubmit = matchers.filter(m => !emptied.includes(m))
    }
  }

  writeSettings(file, settings)
  return { file, command: hookCommand(), kept }
}

export function uninstallClaudeHook(): { file: string; changed: boolean } {
  const file = settingsPath()
  // No file — create nothing (otherwise uninstall litters an empty settings.json).
  if (!fs.existsSync(file)) return { file, changed: false }

  const { settings } = readSettings()
  // Nothing of ours can live in a file that isn't an object — and we must not
  // try to walk it.
  if (!isPlainObject(settings)) return { file, changed: false }

  const before = JSON.stringify(settings)
  stripOurHooks(settings)
  const after = JSON.stringify(settings)
  // Write (and make a .bak) only if we actually removed something — don't reformat a foreign file.
  if (before === after) return { file, changed: false }

  writeSettings(file, settings)
  return { file, changed: true }
}
