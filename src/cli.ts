import path from 'node:path'

import { runSetup } from './setup'
import { runUninstall } from './uninstall'
import { runCheck, runWrap } from './run'
import { packageVersion } from './pkg'
import { msg } from './i18n'

const SUBCOMMANDS = new Set([
  'setup',
  'uninstall',
  'check',
  'help',
  '--help',
  '-h',
  'version',
  '--version',
  '-v',
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
      case 'check':
        await runCheck()
        return
      default:
        printHelp()
        process.exit(1)
    }
  }

  // selfEntry = published bin shim (not dist/cli.js), so resolve skips geo-guard correctly
  const selfEntry = path.join(__dirname, '..', 'bin', 'geo-guard.js')
  await runWrap(head, argv.slice(1), { selfEntry })
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`✖ ${message}`)
  process.exit(1)
})

