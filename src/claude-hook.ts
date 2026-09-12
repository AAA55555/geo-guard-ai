import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { msg } from './i18n'
import { hookCommand, isOurHook } from './hook-shared'

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

  hooks.UserPromptSubmit = matchers
    .map(matcher => ({
      ...matcher,
      hooks: (matcher.hooks ?? []).filter(hook => !isOurHook(hook)),
    }))
    .filter(matcher => (matcher.hooks?.length ?? 0) > 0)

  if (hooks.UserPromptSubmit.length === 0) {
    delete hooks.UserPromptSubmit
  }
  if (Object.keys(hooks).length === 0) {
    delete settings.hooks
  }
  return settings
}

/**
 * Updates our entry in place (keeping the user's timeout/statusMessage and the
 * matcher it sits in) and drops any duplicates. Returns whether one was found
 * and whether it carried settings of the user's own.
 */
function updateOurHooksInPlace(settings: ClaudeSettings): { found: boolean; kept: boolean } {
  const matchers = settings.hooks?.UserPromptSubmit
  if (!Array.isArray(matchers)) return { found: false, kept: false }

  let found = false
  let kept = false

  for (const matcher of matchers) {
    const hooks = matcher.hooks
    if (!Array.isArray(hooks)) continue

    const next: ClaudeHook[] = []
    for (const hook of hooks) {
      if (!isOurHook(hook)) {
        next.push(hook)
        continue
      }
      // Only the first one survives — the rest are leftovers from older installs.
      if (found) continue
      found = true
      const updated: ClaudeHook = { ...defaultHook(), ...hook, command: hookCommand() }
      kept = JSON.stringify(updated) !== JSON.stringify(defaultHook())
      next.push(updated)
    }
    matcher.hooks = next
  }

  return { found, kept }
}

export function installClaudeHook(): { file: string; command: string; kept: boolean } {
  const { file, settings } = readSettings()

  const { found, kept } = updateOurHooksInPlace(settings)
  if (!found) {
    settings.hooks ??= {}
    settings.hooks.UserPromptSubmit ??= []
    settings.hooks.UserPromptSubmit.push({ hooks: [defaultHook()] })
  } else {
    // Matchers that held nothing but our duplicates are now empty.
    const matchers = settings.hooks?.UserPromptSubmit
    if (Array.isArray(matchers) && settings.hooks) {
      settings.hooks.UserPromptSubmit = matchers.filter(m => (m.hooks?.length ?? 0) > 0)
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
  const before = JSON.stringify(settings)
  stripOurHooks(settings)
  const after = JSON.stringify(settings)
  // Write (and make a .bak) only if we actually removed something — don't reformat a foreign file.
  if (before === after) return { file, changed: false }

  writeSettings(file, settings)
  return { file, changed: true }
}
