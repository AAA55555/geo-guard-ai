import path from 'node:path'

import { runConfig } from './config-cmd'
import { runSetup } from './setup'
import { runUninstall } from './uninstall'
import { runCheck, runWrap } from './run'
import { packageVersion } from './pkg'
import { msg } from './i18n'

const SUBCOMMANDS = new Set([
  'setup',
  'uninstall',
  'config',
  'check',
  'help',
  '--help',
  '-h',
  'version',
  '--version',
  '-v',
])

/** Commands we do have, for the "no such command" message. */
const COMMAND_NAMES = ['setup', 'config', 'check', 'uninstall']

/**
 * Verbs a CLI plausibly has but geo-guard doesn't. Without this, `geo-guard
 * reset` is read as "run the program called reset" — and on most systems there
 * is one (`/usr/bin/reset` clears the terminal). Wrapping any command is a
 * feature, so this doesn't refuse those: it asks for `geo-guard -- reset`,
 * which says "yes, the program" out loud.
 */
const COMMAND_LOOKALIKES = new Set([
  'reset',
  'status',
  'list',
  'show',
  'info',
  'init',
  'install',
  'update',
  'upgrade',
  'remove',
  'delete',
  'enable',
  'disable',
  'start',
  'stop',
  'doctor',
])

function printHelp(): void {
  console.log(msg().help())
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const head = argv[0]

  if (!head || SUBCOMMANDS.has(head)) {
    switch (head) {
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        printHelp()
        return
      case 'version':
      case '--version':
      case '-v':
        console.log(packageVersion())
        return
      case 'setup':
        await runSetup(argv.slice(1))
        return
      case 'uninstall':
        await runUninstall(argv.slice(1))
        return
      case 'config':
        await runConfig(argv.slice(1))
        return
      case 'check':
        await runCheck(argv.slice(1))
        return
      default:
        printHelp()
        process.exit(1)
    }
  }

  // `geo-guard -- <program> [args…]`: everything after the separator is the
  // program to wrap, whatever it is called.
  let command = head
  let args = argv.slice(1)
  let explicit = false
  if (head === '--') {
    command = argv[1] ?? ''
    args = argv.slice(2)
    explicit = true
    if (!command) {
      console.error(`✖ ${msg().wrapNoCommand()}`)
      process.exit(1)
    }
  }

  if (!explicit) {
    // A leading dash is never a program name: treat it as a mistyped option
    // rather than going off to look for a binary called '--porfile'.
    if (command.startsWith('-')) {
      console.error(`✖ ${msg().unknownOption(command)}`)
      process.exit(1)
    }
    if (COMMAND_LOOKALIKES.has(command.toLowerCase())) {
      console.error(`✖ ${msg().notACommand(command, COMMAND_NAMES.join(', '))}`)
      process.exit(1)
    }
  }

  // selfEntry = published bin shim (not dist/cli.js), so resolve skips geo-guard correctly
  const selfEntry = path.join(__dirname, '..', 'bin', 'geo-guard.js')
  await runWrap(command, args, { selfEntry })
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`✖ ${message}`)
  process.exit(1)
})

