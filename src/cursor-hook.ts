import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { msg } from './i18n'
import { hookCommand, isOurHook } from './hook-shared'

type CursorHook = Readonly<{
  type?: string
  command?: string
  timeout?: number
  failClosed?: boolean
  [key: string]: unknown
}>

type CursorHooksFile = {
  version?: number
  hooks?: {
    beforeSubmitPrompt?: CursorHook[]
    [key: string]: unknown
  }
  [key: string]: unknown
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

  hooks.beforeSubmitPrompt = list.filter(hook => !isOurHook(hook))
  if (hooks.beforeSubmitPrompt.length === 0) {
    delete hooks.beforeSubmitPrompt
  }
  if (Object.keys(hooks).length === 0) {
    delete data.hooks
  }
  return data
}

export function installCursorHook(): { file: string; command: string } {
  const { file, data } = readHooksFile()
  stripOurHooks(data)
  data.version ??= 1
  data.hooks ??= {}
  data.hooks.beforeSubmitPrompt ??= []
  data.hooks.beforeSubmitPrompt.push({
    command: hookCommand(),
    timeout: 10,
    failClosed: true,
  })
  writeHooksFile(file, data)
  return { file, command: hookCommand() }
}

export function uninstallCursorHook(): { file: string; changed: boolean } {
  const file = cursorHooksPath()
  // No file — create nothing (otherwise uninstall litters an empty hooks.json).
  if (!fs.existsSync(file)) return { file, changed: false }

  const { data } = readHooksFile()
  const before = JSON.stringify(data)
  stripOurHooks(data)
  const after = JSON.stringify(data)
  // Write (and make a .bak) only if we actually removed something — don't reformat a foreign file.
  if (before === after) return { file, changed: false }

  writeHooksFile(file, data)
  return { file, changed: true }
}
