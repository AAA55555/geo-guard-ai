/**
 * The bits of flag parsing `setup` and `config` both need. Neither command
 * warrants a parser library, but two hand-written copies of "does this option
 * have a value" drifted apart once already.
 */

import { msg } from './i18n'

/**
 * Reads the value that follows `--flag`, given the index of the flag itself.
 * Returns the value and the index it consumed.
 *
 * Only a `--`-prefixed token counts as "the next option, so no value here": a
 * single dash can legitimately start a value, and rejecting `-NL` outright
 * turns a wrong country code into a confusing "option needs a value".
 */
export function valueAt(argv: readonly string[], index: number, name: string): {
  value: string
  next: number
} {
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(msg().optionNeedsValue(name))
  }
  return { value, next: index + 1 }
}

/** The value of a `--flag=value` token. Empty is allowed — the caller validates. */
export function inlineValue(arg: string, flag: string): string {
  return arg.slice(`${flag}=`.length)
}
