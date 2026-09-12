import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import type { Interface } from 'node:readline/promises'

import { msg } from './i18n'

export type PromptApi = Readonly<{
  ask: (question: string, options?: Readonly<{ defaultValue?: string }>) => Promise<string>
  askYesNo: (question: string, options?: Readonly<{ defaultYes?: boolean }>) => Promise<boolean>
}>

/**
 * Lines as they arrive, queued.
 *
 * `rl.question` only listens while a question is outstanding, which is fine at
 * a terminal and wrong for a pipe: `printf 'a\nb\nc\n' | geo-guard setup` hands
 * readline every line at once, and the ones landing between questions are
 * dropped. Setup then waited on a question nobody could answer, node ran out of
 * work, and the process exited 0 having installed nothing — a script wrapping
 * it "succeeded" in silence.
 *
 * Buffering lets answers arrive ahead of their questions, and turns running out
 * of input into something we can report rather than something that looks like
 * success.
 */
function createLineReader(rl: Interface): () => Promise<string | null> {
  const buffered: string[] = []
  const waiting: Array<(line: string | null) => void> = []
  let ended = false

  rl.on('line', line => {
    const waiter = waiting.shift()
    if (waiter) {
      waiter(line)
      return
    }
    buffered.push(line)
  })

  rl.once('close', () => {
    ended = true
    while (waiting.length > 0) {
      waiting.shift()?.(null)
    }
  })

  return () => {
    if (buffered.length > 0) return Promise.resolve(buffered.shift() ?? null)
    if (ended) return Promise.resolve(null)
    return new Promise<string | null>(resolve => waiting.push(resolve))
  }
}

function createPromptApi(nextLine: () => Promise<string | null>): PromptApi {
  const ask: PromptApi['ask'] = async (question, options = {}) => {
    const { defaultValue } = options
    const hint = defaultValue !== undefined && defaultValue !== '' ? ` [${defaultValue}]` : ''
    output.write(`${question}${hint}: `)

    const line = await nextLine()
    if (line === null) {
      // Out of input with questions left. Loudly: the alternative is a silent
      // no-op that reads like a successful install.
      output.write('\n')
      throw new Error(msg().promptInputEnded())
    }

    const answer = line.trim()
    if (!answer && defaultValue !== undefined) return String(defaultValue)
    return answer
  }

  const askYesNo: PromptApi['askYesNo'] = async (question, options = {}) => {
    const defaultYes = options.defaultYes ?? true
    const suffix = defaultYes ? 'Y/n' : 'y/N'
    const answer = await ask(`${question} (${suffix})`, { defaultValue: '' })
    if (!answer) return defaultYes
    // Accept "yes" in every supported language (en/ru), regardless of the active locale.
    return /^(y|yes|д|да)$/i.test(answer)
  }

  return { ask, askYesNo }
}

/** A single readline for the whole interactive session (several questions in a row). */
export async function withPromptSession<T>(fn: (prompt: PromptApi) => Promise<T>): Promise<T> {
  const rl = readline.createInterface({ input, output })
  const nextLine = createLineReader(rl)
  try {
    return await fn(createPromptApi(nextLine))
  } finally {
    rl.close()
  }
}
