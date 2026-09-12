/**
 * Works out which tool is running `geo-guard check`.
 *
 * The hook command string in ~/.claude/settings.json and ~/.cursor/hooks.json
 * must stay byte-for-byte identical: Cursor imports Claude Code's hooks and
 * deduplicates them against its own by exact command match, which is what keeps
 * the check running once per prompt instead of twice. So the profile cannot be
 * baked into the command as a flag — it has to be derived at run time.
 *
 * The hook host itself tells us, in the JSON it pipes to stdin: Claude Code
 * sends `hook_event_name: "UserPromptSubmit"`, Cursor `"beforeSubmitPrompt"`.
 * That is the actual host, regardless of which config file the entry came from.
 */

import type { ProfileName } from './config'

export type HookPayload = Readonly<{
  hook_event_name?: unknown
  [key: string]: unknown
}>

/**
 * - `none`: nothing was piped in — a terminal, or stdin closed with no bytes.
 *   That's a person running `geo-guard check` by hand, not a hook host.
 * - `payload`: we read and parsed something.
 * - `unreadable`: bytes arrived from *some* host, but we could not make sense
 *   of them. Distinct from `none` on purpose: the caller must not treat an
 *   unidentified host as "no host".
 */
export type HookPayloadResult =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'payload'; payload: HookPayload }>
  | Readonly<{ kind: 'unreadable' }>

/**
 * The payload carries the user's whole prompt, which can be megabytes. We only
 * need one field near the front, so we stop buffering past this — but we keep
 * what we already have instead of throwing the read away (see extractEvent).
 */
const MAX_PAYLOAD_BYTES = 1024 * 1024

/**
 * Budget for the read. The host writes the payload immediately on spawn, so
 * this is only ever hit when something is wrong; the hook timeout is 10s, so a
 * second of slack costs nothing and removes the race on a loaded machine.
 */
const DEFAULT_TIMEOUT_MS = 1000

/** Hosts we recognize, by the event they announce. */
const EVENT_PROFILES: Readonly<Record<string, ProfileName>> = {
  userpromptsubmit: 'claude',
  beforesubmitprompt: 'cursor',
}

export function profileFromEvent(event: unknown): ProfileName | null {
  if (typeof event !== 'string') return null
  return EVENT_PROFILES[event.trim().toLowerCase()] ?? null
}

/**
 * `hook_event_name` out of a JSON prefix that was cut short (a prompt bigger
 * than the cap). The field sits near the front in both hosts' payloads, so it
 * is normally present even in the part we kept.
 */
const EVENT_FIELD_RE = /"hook_event_name"\s*:\s*"([^"\\]{1,64})"/

function extractEvent(raw: string): HookPayloadResult {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { kind: 'payload', payload: parsed as HookPayload }
    }
  } catch {
    // Not valid JSON — possibly just truncated. Fall through to the scan.
  }

  const match = EVENT_FIELD_RE.exec(raw)
  if (match?.[1] !== undefined) {
    return { kind: 'payload', payload: { hook_event_name: match[1] } }
  }

  return raw.trim() === '' ? { kind: 'none' } : { kind: 'unreadable' }
}

/**
 * Reads the hook payload from stdin. Never throws and never waits long:
 * blocking here eats into the host's own hook timeout, and with Cursor's
 * failClosed a slow read would turn into a blocked prompt.
 */
export function readHookPayload(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<HookPayloadResult> {
  const stdin = process.stdin
  // A terminal has no payload waiting — reading would hang until the timeout.
  if (stdin.isTTY) return Promise.resolve({ kind: 'none' })

  return new Promise<HookPayloadResult>(resolve => {
    const chunks: Buffer[] = []
    let size = 0
    let done = false
    let timer: NodeJS.Timeout | undefined

    const finish = (): void => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      stdin.removeListener('data', onData)
      stdin.removeListener('end', onEnd)
      stdin.removeListener('error', onError)
      stdin.pause()
      // Whatever arrived is worth reading, even on timeout: a host that keeps
      // stdin open, or a prompt past the cap, still told us who it is.
      resolve(extractEvent(Buffer.concat(chunks).toString('utf8')))
    }

    const onData = (chunk: Buffer): void => {
      if (size >= MAX_PAYLOAD_BYTES) return
      size += chunk.length
      chunks.push(chunk)
    }
    const onEnd = (): void => finish()
    const onError = (): void => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      stdin.removeListener('data', onData)
      stdin.removeListener('end', onEnd)
      stdin.removeListener('error', onError)
      stdin.pause()
      resolve({ kind: 'unreadable' })
    }

    timer = setTimeout(finish, timeoutMs)
    // Don't hold the event loop open just for this read.
    timer.unref?.()

    stdin.on('data', onData)
    stdin.on('end', onEnd)
    stdin.on('error', onError)
    stdin.resume()
  })
}
