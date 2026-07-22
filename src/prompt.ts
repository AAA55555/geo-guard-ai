import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import type { Interface } from 'node:readline/promises'

export type PromptApi = Readonly<{
  ask: (question: string, options?: Readonly<{ defaultValue?: string }>) => Promise<string>
  askYesNo: (question: string, options?: Readonly<{ defaultYes?: boolean }>) => Promise<boolean>
}>

function createPromptApi(rl: Interface): PromptApi {
  const ask: PromptApi['ask'] = async (question, options = {}) => {
    const { defaultValue } = options
    const hint = defaultValue !== undefined && defaultValue !== '' ? ` [${defaultValue}]` : ''
    const answer = (await rl.question(`${question}${hint}: `)).trim()
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
  try {
    return await fn(createPromptApi(rl))
  } finally {
    rl.close()
  }
}
