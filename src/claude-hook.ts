import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { msg } from './i18n'
import { hookCommand, isOurHook } from './hook-shared'

export { hookCommand, isOurHook }

type ClaudeHook = Readonly<{
  type?: string
  command?: string
  timeout?: number
  statusMessage?: string
}>

type ClaudeHookMatcher = Readonly<{
  hooks?: ClaudeHook[]
  [key: string]: unknown
}>

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

export function installClaudeHook(): { file: string; command: string } {
  const { file, settings } = readSettings()
  stripOurHooks(settings)
  settings.hooks ??= {}
  settings.hooks.UserPromptSubmit ??= []
  settings.hooks.UserPromptSubmit.push({
    hooks: [
      {
        type: 'command',
        command: hookCommand(),
        timeout: 10,
        statusMessage: 'Geo-check…',
      },
    ],
  })
  writeSettings(file, settings)
  return { file, command: hookCommand() }
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
