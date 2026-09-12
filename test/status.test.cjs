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

function env(extra) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    GEO_GUARD_RC: path.join(home, '.zshrc'),
    GEO_GUARD_SHELL: 'zsh',
    GEO_GUARD_CONFIG_DIR: path.join(home, 'cfg'),
    GEO_GUARD_CONFIG_FILE: path.join(home, 'cfg', 'config.json'),
    GEO_GUARD_LANG: 'en',
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
  const r = run(['setup', '--yes', '--countries', 'RU,NL', '--hook', '--cursor', '--alias'])
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
  })
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
  })

  test('everything installed → exit 0', () => {
    install()
    const r = status()
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /Everything geo-guard installs is in place/)
    assert.match(r.stdout, /config file found/)
    assert.match(r.stdout, /alias 'claude'/)
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
    assert.equal(r.stdout.match(/no such file — the hook is not installed/g).length, 2)
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

  test('missing alias block → exit 1 naming it', () => {
    install()
    fs.writeFileSync(rcFile(), 'export FOO=1\n')
    const r = status()
    assert.equal(r.status, 1)
    assert.match(r.stdout, /no geo-guard alias block in this file/)
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

  test('an alias carrying the user’s own flags is reported as such', () => {
    install()
    const rc = fs.readFileSync(rcFile(), 'utf8')
    fs.writeFileSync(
      rcFile(),
      rc.replace('alias claude="geo-guard claude"', 'alias claude="geo-guard claude --foo"'),
    )
    const r = status()
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /alias with flags of your own: alias claude="geo-guard claude --foo"/)
  })

  test('foreign content inside our markers → exit 1', () => {
    install()
    const rc = fs.readFileSync(rcFile(), 'utf8')
    fs.writeFileSync(rcFile(), rc.replace('alias claude="geo-guard claude"', 'export SECRET=1'))
    const r = status()
    assert.equal(r.status, 1)
    assert.match(r.stdout, /holds foreign content: export SECRET=1/)
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
      },
      encoding: 'utf8',
    })

    const pathLines = (r.stdout.match(/^Config:/gm) ?? []).length
    assert.equal(pathLines, 1, `путь напечатан ${pathLines} раз(а)`)
    assert.match(r.stdout, /Invalid config|not valid JSON/i)
    assert.equal(r.status, 1)
  })
})

describe('geo-guard status: a block with no END marker', () => {
  const cli = path.join(__dirname, '..', 'dist', 'cli.js')
  let home
  let cfgDir

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-brokenblock-'))
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-brokenblock-cfg-'))
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
        GEO_GUARD_PROVIDERS: '',
        GEO_GUARD_LANG: 'en',
      },
      encoding: 'utf8',
    })
  }

  test('is not reported as "no block" — status and setup must read it the same way', () => {
    // Раньше status отвечал «в файле нет geo-guard-блока», а setup на том же
    // файле — «alias с твоими флагами, не трогаем». Из-за этого рецепт
    // `status || setup` из README не сходился никогда.
    fs.writeFileSync(rc(), '# >>> geo-guard-ai begin >>>\nalias claude="geo-guard claude --mine"\n')

    const r = run('status')

    assert.doesNotMatch(r.stdout, /no geo-guard alias block/)
    assert.match(r.stdout, /no END marker/)
    assert.match(r.stdout, /fix the file by hand/)
    assert.equal(r.status, 1)
  })

  test('a block of ours says setup will repair it, and setup does', () => {
    fs.writeFileSync(rc(), '# >>> geo-guard-ai begin >>>\nalias claude="geo-guard claude"\n')

    const before = run('status')
    assert.match(before.stdout, /no END marker/)
    assert.match(before.stdout, /will repair it/)
    assert.equal(before.status, 1)

    assert.equal(run('setup', ['--yes', '--countries', 'RU', '--no-hook', '--no-cursor']).status, 0)

    const after = run('status')
    assert.match(after.stdout, /alias 'claude'/)
  })
})
