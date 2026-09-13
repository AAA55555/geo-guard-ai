'use strict'

const { test, describe, beforeEach, afterEach } = require('node:test')
const { spawnSync } = require('node:child_process')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const cli = path.join(__dirname, '..', 'dist', 'cli.js')
const mockFetch = path.join(__dirname, 'fixtures', 'mock-fetch.cjs')

let home
/** Holds the "real" claude, outside $HOME so the home snapshots stay clean. */
let realBinDir

const shimDir = () => path.join(home, 'shim-bin')

/**
 * The shim directory first, the real binary behind it — the PATH a working
 * install actually has. status judges the gate by this, not by files on disk,
 * so a test that pinned PATH empty would report every install as broken.
 */
const livePath = () => `${shimDir()}${path.delimiter}${realBinDir}`

function env(extra) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    GEO_GUARD_RC: path.join(home, '.zshrc'),
    GEO_GUARD_SHELL: 'zsh',
    GEO_GUARD_CONFIG_DIR: path.join(home, 'cfg'),
    GEO_GUARD_CONFIG_FILE: path.join(home, 'cfg', 'config.json'),
    GEO_GUARD_SHIM_DIR: shimDir(),
    GEO_GUARD_LANG: 'en',
    // Only claude here: whether the cursor-agent gate is wanted is decided by
    // PATH, and a test must not depend on the machine having Cursor installed.
    PATH: livePath(),
    // No network from the test suite: every provider answers RU.
    NODE_OPTIONS: `--require ${mockFetch}`,
    ...extra,
  }
}

function run(args, extraEnv) {
  return spawnSync(process.execPath, [cli, ...args], {
    env: env(extraEnv),
    encoding: 'utf8',
  })
}

function status(extraEnv) {
  return run(['status'], extraEnv)
}

function install() {
  const r = run(['setup', '--yes', '--countries', 'RU,NL', '--hook', '--cursor', '--shim'])
  assert.equal(r.status, 0, r.stderr)
}

const settingsFile = () => path.join(home, '.claude', 'settings.json')
const cursorFile = () => path.join(home, '.cursor', 'hooks.json')
const rcFile = () => path.join(home, '.zshrc')
const configFile = () => path.join(home, 'cfg', 'config.json')

/** Every file under the fake home, with its size, mtime and content. */
function snapshot(dir) {
  const out = {}
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      const stat = fs.statSync(full)
      out[full] = `${stat.size}:${stat.mtimeMs}:${fs.readFileSync(full, 'utf8')}`
    }
  }
  walk(dir)
  return out
}

describe('geo-guard status', () => {
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-status-'))
    fs.mkdirSync(path.join(home, 'cfg'), { recursive: true })
    realBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-status-bin-'))
    const claude = path.join(realBinDir, 'claude')
    fs.writeFileSync(claude, '#!/bin/sh\nexit 0\n')
    fs.chmodSync(claude, 0o755)
  })
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(realBinDir, { recursive: true, force: true })
  })

  test('everything installed → exit 0', () => {
    install()
    const r = status()
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /Everything geo-guard installs is in place/)
    assert.match(r.stdout, /config file found/)
    assert.match(r.stdout, /claude goes through geo-guard/)
    assert.match(r.stdout, /is added to PATH/)
    // Both hook files report their entry.
    assert.equal(r.stdout.match(/our hook entry is in place/g).length, 2)
  })

  test('a run creates and modifies nothing on disk', () => {
    install()
    const before = snapshot(home)
    const r = status()
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.deepEqual(snapshot(home), before)
  })

  test('nothing installed → creates nothing and exits 1', () => {
    const r = status()
    assert.equal(r.status, 1)
    // Only the config dir the test itself made is there.
    assert.deepEqual(snapshot(home), {})
    assert.match(r.stdout, /no config file/)
    assert.match(r.stdout, /no such rc file/)
    // Claude Code's hook is missing; Cursor's is not even wanted here, because
    // this sandbox has no ~/.cursor.
    assert.equal(r.stdout.match(/no such file — the hook is not installed/g).length, 1)
    assert.match(r.stdout, /no hook needed/)
  })

  test('a machine without Cursor is not reported as broken', () => {
    // setup skips the Cursor hook when ~/.cursor is absent, so status demanding
    // it meant a perfectly good install stayed at exit 1 forever — and the
    // advice it printed, re-running setup, changed nothing.
    // Не общий install(): он передаёт --cursor и сам создаёт ~/.cursor.
    assert.equal(run(['setup', '--yes', '--countries', 'RU,NL']).status, 0)
    assert.equal(fs.existsSync(path.join(home, '.cursor')), false)

    const r = status()

    assert.equal(r.status, 0)
    assert.match(r.stdout, /no hook needed/)
  })

  test('once Cursor is there, its missing hook counts again', () => {
    assert.equal(run(['setup', '--yes', '--countries', 'RU,NL']).status, 0)
    fs.mkdirSync(path.join(home, '.cursor'), { recursive: true })

    const r = status()

    assert.equal(r.status, 1)
    assert.match(r.stdout, /no such file — the hook is not installed/)
  })

  test('missing config file → exit 1 naming it', () => {
    install()
    fs.unlinkSync(configFile())
    const r = status()
    assert.equal(r.status, 1)
    assert.match(r.stdout, /no config file — the built-in defaults are in effect/)
    // The rest is still reported.
    assert.match(r.stdout, /our hook entry is in place/)
  })

  test('missing Claude Code hook entry → exit 1 naming it', () => {
    install()
    fs.writeFileSync(settingsFile(), JSON.stringify({ hooks: {} }, null, 2))
    const r = status()
    assert.equal(r.status, 1)
    assert.match(r.stdout, /Claude Code hook: [^\n]*\n {2}✖ our hook entry is missing/)
    // The Cursor one is untouched and still reported as installed.
    assert.match(r.stdout, /Cursor hook: [^\n]*\n {2}✅/)
  })

  test('missing Cursor hook entry → exit 1 naming it', () => {
    install()
    fs.writeFileSync(cursorFile(), JSON.stringify({ version: 1, hooks: {} }, null, 2))
    const r = status()
    assert.equal(r.status, 1)
    assert.match(r.stdout, /Cursor hook: [^\n]*\n {2}✖ our hook entry is missing/)
    assert.match(r.stdout, /Claude Code hook: [^\n]*\n {2}✅/)
  })

  test('missing PATH block → exit 1 naming it', () => {
    install()
    fs.writeFileSync(rcFile(), 'export FOO=1\n')
    const r = status()
    assert.equal(r.status, 1)
    assert.match(r.stdout, /is not added to PATH in this file/)
  })

  test('a shim that PATH never reaches is reported as not in effect', () => {
    // The case the alias gate could never see: setup wrote everything, but this
    // shell started before it did, so the gate is installed and not working.
    install()
    const r = status({ PATH: realBinDir })
    assert.equal(r.status, 1)
    assert.match(r.stdout, /PATH finds another binary first/)
  })

  test('an empty PATH says the shim directory is not on it', () => {
    install()
    const r = status({ PATH: '' })
    assert.equal(r.status, 1)
    assert.match(r.stdout, /is not on this shell's PATH/)
  })

  test('a shim with no real binary behind it is reported, not hidden', () => {
    install()
    const r = status({ PATH: shimDir() })
    assert.equal(r.status, 1)
    assert.match(r.stdout, /the real claude behind the shim cannot be found/)
  })

  test('a missing shim file → exit 1 naming the command', () => {
    install()
    fs.rmSync(path.join(shimDir(), 'claude'))
    const r = status()
    assert.equal(r.status, 1)
    assert.match(r.stdout, /no shim for claude/)
  })

  test('an alias block left over from an earlier version is reported', () => {
    install()
    fs.appendFileSync(
      rcFile(),
      '\n# >>> geo-guard-ai begin >>>\nalias claude="geo-guard claude"\n# <<< geo-guard-ai end <<<\n',
    )
    const r = status()
    assert.equal(r.status, 1)
    assert.match(r.stdout, /an old geo-guard alias block is still in/)
  })

  test('a malformed hook file is reported, not crashed on', () => {
    install()
    fs.writeFileSync(settingsFile(), '{ not json at all')
    const r = status()
    assert.equal(r.status, 1)
    assert.match(r.stdout, /invalid JSON/)
    // A crash would put a stack on stderr and skip everything below.
    assert.equal(r.stderr, '')
    assert.match(r.stdout, /Country:/)
    assert.match(r.stdout, /Something is missing or broken/)
  })

  test('a hook file of the wrong shape is reported as uninstallable', () => {
    install()
    fs.writeFileSync(cursorFile(), JSON.stringify({ hooks: 'nope' }))
    const r = status()
    assert.equal(r.status, 1)
    assert.match(r.stdout, /is not the shape the hook config expects/)
    assert.equal(r.stderr, '')
  })

  test('a malformed config file is reported, not crashed on', () => {
    install()
    fs.writeFileSync(configFile(), '{ broken')
    const r = status()
    assert.equal(r.status, 1)
    assert.equal(r.stderr, '')
    assert.match(r.stdout, /invalid JSON|Invalid config/)
    // The checks after it still run.
    assert.match(r.stdout, /our hook entry is in place/)
  })

  test('a shim carrying the user’s own flags is reported as such', () => {
    install()
    const shim = path.join(shimDir(), 'claude')
    fs.writeFileSync(
      shim,
      fs.readFileSync(shim, 'utf8').replace('claude "$@"', 'claude --foo "$@"'),
    )
    const r = status()
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /claude goes through geo-guard, with flags of your own: --foo/)
  })

  test('a file of someone else’s where our shim belongs → exit 1', () => {
    install()
    fs.writeFileSync(path.join(shimDir(), 'claude'), '#!/bin/sh\necho mine\n')
    const r = status()
    assert.equal(r.status, 1)
    assert.match(r.stdout, /is not ours — the launch gate is not installed/)
  })

  test('foreign content inside our PATH markers → exit 1', () => {
    install()
    const rc = fs.readFileSync(rcFile(), 'utf8')
    const begin = rc.indexOf('# >>> geo-guard-ai path begin >>>')
    const end = rc.indexOf('# <<< geo-guard-ai path end <<<')
    fs.writeFileSync(
      rcFile(),
      `${rc.slice(0, begin)}# >>> geo-guard-ai path begin >>>\nexport SECRET=1\n${rc.slice(end)}`,
    )
    const r = status()
    assert.equal(r.status, 1)
    assert.match(r.stdout, /PATH block holds foreign content/)
  })

  test('a blocked country does not fail the report', () => {
    install()
    // RU from the stub, policy allows only NL: the install is still fine.
    const r = status({ GEO_GUARD_ALLOWED: 'NL' })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /RU — not allowed \(allowed: NL\)/)
  })

  test('an undetectable country is reported, not an error', () => {
    install()
    // No providers → detectCountry returns null without touching the network.
    const r = status({ GEO_GUARD_PROVIDERS: '', NODE_OPTIONS: '' })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /could not determine/)
  })

  test('status is a real command, not a lookalike', () => {
    const r = run(['--help'])
    assert.equal(r.status, 0)
    assert.match(r.stdout, /geo-guard status/)
  })

  test('an unknown argument is rejected', () => {
    const bad = run(['status', '--nope'])
    assert.notEqual(bad.status, 0)
    assert.match(bad.stderr, /Unknown status argument: --nope/)
  })
})

describe('geo-guard status: the path line is printed once', () => {
  const cli = path.join(__dirname, '..', 'dist', 'cli.js')
  let home
  let cfgDir

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-statuspath-'))
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-statuspath-cfg-'))
  })
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(cfgDir, { recursive: true, force: true })
  })

  test('a broken config reports the path once, not twice', () => {
    // showConfig() печатает путь до того, как прочитает файл, поэтому ветка
    // с ошибкой не должна печатать его повторно.
    fs.writeFileSync(path.join(cfgDir, 'config.json'), 'not json')

    const r = spawnSync(process.execPath, [cli, 'status'], {
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        GEO_GUARD_RC: path.join(home, '.zshrc'),
        GEO_GUARD_SHELL: 'zsh',
        GEO_GUARD_CONFIG_DIR: cfgDir,
        GEO_GUARD_CONFIG_FILE: path.join(cfgDir, 'config.json'),
        GEO_GUARD_PROVIDERS: '',
        GEO_GUARD_LANG: 'en',
        PATH: '',
      },
      encoding: 'utf8',
    })

    const pathLines = (r.stdout.match(/^Config:/gm) ?? []).length
    assert.equal(pathLines, 1, `путь напечатан ${pathLines} раз(а)`)
    assert.match(r.stdout, /Invalid config|not valid JSON/i)
    assert.equal(r.status, 1)
  })
})

describe('geo-guard status: alias blocks left over from an earlier version', () => {
  const cli = path.join(__dirname, '..', 'dist', 'cli.js')
  let home
  let cfgDir

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-leftover-'))
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-leftover-cfg-'))
  })
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(cfgDir, { recursive: true, force: true })
  })

  const rc = () => path.join(home, '.zshrc')

  function run(command, extra = []) {
    return spawnSync(process.execPath, [cli, command, ...extra], {
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        GEO_GUARD_RC: rc(),
        GEO_GUARD_SHELL: 'zsh',
        GEO_GUARD_CONFIG_DIR: cfgDir,
        GEO_GUARD_CONFIG_FILE: path.join(cfgDir, 'config.json'),
        GEO_GUARD_SHIM_DIR: path.join(home, 'shim-bin'),
        GEO_GUARD_PROVIDERS: '',
        GEO_GUARD_LANG: 'en',
        PATH: '',
      },
      encoding: 'utf8',
    })
  }

  test('a block of ours is reported, and setup does take it out', () => {
    fs.writeFileSync(
      rc(),
      '# >>> geo-guard-ai begin >>>\nalias claude="geo-guard claude"\n# <<< geo-guard-ai end <<<\n',
    )

    const before = run('status')
    assert.match(before.stdout, /an old geo-guard alias block is still in/)
    assert.equal(before.status, 1)

    assert.equal(run('setup', ['--yes', '--countries', 'RU', '--no-hook', '--no-cursor']).status, 0)

    const after = run('status')
    assert.doesNotMatch(after.stdout, /old geo-guard alias block/)
  })

  test('a block with no END marker says "by hand" — setup will not cut it', () => {
    // status and setup have to read such a block the same way. When status said
    // "re-run setup" about something setup refuses to touch, the advice was a
    // loop that never closed.
    fs.writeFileSync(rc(), '# >>> geo-guard-ai begin >>>\nalias claude="geo-guard claude --mine"\n')

    const r = run('status')

    assert.match(r.stdout, /has no END marker/)
    assert.match(r.stdout, /remove it by hand/)
    assert.equal(r.status, 1)

    assert.equal(run('setup', ['--yes', '--countries', 'RU', '--no-hook', '--no-cursor']).status, 0)
    // Untouched, exactly as promised — and the flags still made it into the shim.
    assert.match(fs.readFileSync(rc(), 'utf8'), /alias claude="geo-guard claude --mine"/)
    assert.match(
      fs.readFileSync(path.join(home, 'shim-bin', 'claude'), 'utf8'),
      /claude --mine "\$@"/,
    )
  })
})
