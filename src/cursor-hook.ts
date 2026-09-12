import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { msg } from './i18n'
import { hookCommand, isOurHook, isPlainObject } from './hook-shared'

type CursorHook = {
  type?: string
  command?: string
  timeout?: number
  failClosed?: boolean
  [key: string]: unknown
}

/** What we install when there is nothing to preserve. */
function defaultHook(): CursorHook {
  return {
    command: hookCommand(),
    timeout: 10,
    failClosed: true,
  }
}

type CursorHooksFile = {
  version?: number
  hooks?: {
    beforeSubmitPrompt?: CursorHook[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

/**
 * Refuses to work on a hooks.json whose hook section is not the shape Cursor
 * writes — same reasoning as the Claude Code side: a clear error beats a
 * TypeError thrown after setup has already written half its changes.
 */
export function assertCursorHooksInstallable(): void {
  const { file, data } = readHooksFile()

  // See the Claude Code side: an array or a primitive at the root would let the
  // install "succeed" while writing nothing at all.
  if (!isPlainObject(data)) {
    throw new Error(msg().invalidHookRoot(file))
  }
  if (data.hooks === undefined) return

  if (!isPlainObject(data.hooks)) {
    throw new Error(msg().invalidHookShape(file, 'hooks'))
  }
  const list = data.hooks.beforeSubmitPrompt
  if (list !== undefined && !Array.isArray(list)) {
    throw new Error(msg().invalidHookShape(file, 'hooks.beforeSubmitPrompt'))
  }
}

export function cursorHooksPath(): string {
  return path.join(os.homedir(), '.cursor', 'hooks.json')
}

function readHooksFile(): { file: string; data: CursorHooksFile } {
  const file = cursorHooksPath()
  if (!fs.existsSync(file)) return { file, data: {} }
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return { file, data: {} }
  try {
    return { file, data: JSON.parse(raw) as CursorHooksFile }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(msg().invalidJson(file, message))
  }
}

/** Atomic write: temp file in the same dir, then rename over the target. */
function writeHooksFile(file: string, data: CursorHooksFile): void {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const bak = `${file}.bak`
  // One-time backup: don't overwrite an existing .bak (may belong to another tool).
  if (fs.existsSync(file) && !fs.existsSync(bak)) {
    fs.copyFileSync(file, bak)
  }
  const tmp = path.join(dir, `.hooks.json.${process.pid}.${Date.now()}.tmp`)
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

function stripOurHooks(data: CursorHooksFile): CursorHooksFile {
  const list = data.hooks?.beforeSubmitPrompt
  if (!Array.isArray(list)) return data

  const hooks = data.hooks
  if (!hooks) return data

  const next = list.filter(hook => !(isPlainObject(hook) && isOurHook(hook)))
  // Nothing of ours in there — then it is not ours to rewrite or tidy up.
  if (next.length === list.length) return data

  hooks.beforeSubmitPrompt = next
  if (next.length === 0) {
    delete hooks.beforeSubmitPrompt
  }
  if (Object.keys(hooks).length === 0) {
    delete data.hooks
  }
  return data
}

export function installCursorHook(): { file: string; command: string; kept: boolean } {
  assertCursorHooksInstallable()
  const { file, data } = readHooksFile()

  // Update our entry in place — the user may have raised the timeout or turned
  // failClosed off; only the command is ours to rewrite. Duplicates are dropped.
  const list = data.hooks?.beforeSubmitPrompt
  let found = false
  let kept = false
  if (Array.isArray(list) && data.hooks) {
    const next: CursorHook[] = []
    for (const hook of list) {
      if (!isPlainObject(hook) || !isOurHook(hook)) {
        next.push(hook)
        continue
      }
      if (found) continue
      found = true
      const updated: CursorHook = { ...defaultHook(), ...hook, command: hookCommand() }
      kept = JSON.stringify(updated) !== JSON.stringify(defaultHook())
      next.push(updated)
    }
    // Same discipline as the Claude Code side: a list holding nothing of ours
    // is left as the object it already was, not rebuilt into an equal one.
    if (found) data.hooks.beforeSubmitPrompt = next
  }

  data.version ??= 1
  data.hooks ??= {}
  data.hooks.beforeSubmitPrompt ??= []
  if (!found) {
    data.hooks.beforeSubmitPrompt.push(defaultHook())
  }

  writeHooksFile(file, data)
  return { file, command: hookCommand(), kept }
}

export function uninstallCursorHook(): { file: string; changed: boolean } {
  const file = cursorHooksPath()
  // No file — create nothing (otherwise uninstall litters an empty hooks.json).
  if (!fs.existsSync(file)) return { file, changed: false }

  const { data } = readHooksFile()
  if (!isPlainObject(data)) return { file, changed: false }

  const before = JSON.stringify(data)
  stripOurHooks(data)
  const after = JSON.stringify(data)
  // Write (and make a .bak) only if we actually removed something — don't reformat a foreign file.
  if (before === after) return { file, changed: false }

  writeHooksFile(file, data)
  return { file, changed: true }
}
