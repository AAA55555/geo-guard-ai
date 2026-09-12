'use strict'

const { test, describe, before, after, beforeEach, afterEach } = require('node:test')
const { spawnSync } = require('node:child_process')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')


describe('setup rejects invalid country codes', () => {
  const { parseArgs } = require('../dist/setup')
  const cli = path.join(__dirname, '..', 'dist', 'cli.js')

  test('parseArgs reads --countries', () => {
    assert.deepEqual(parseArgs(['--yes', '--countries', 'ES,PT', '--no-hook', '--no-alias']).countries, 'ES,PT')
  })

  test('setup --countries SPAIN exits non-zero', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-setup-'))
    try {
      const r = spawnSync(process.execPath, [cli, 'setup', '--yes', '--countries', 'SPAIN', '--no-hook', '--no-alias'], {
        env: {
          ...process.env,
          GEO_GUARD_CONFIG_DIR: tmp,
          GEO_GUARD_CONFIG_FILE: path.join(tmp, 'config.json'),
          GEO_GUARD_RC: path.join(tmp, '.zshrc'),
          GEO_GUARD_LANG: 'en',
          // Pinned empty: setup and status look for cursor-agent on PATH to decide
          // whether that alias is wanted, and a test must not depend on whether the
          // machine running it happens to have Cursor installed.
          PATH: '',
        },
        encoding: 'utf8',
      })
      assert.notEqual(r.status, 0)
      assert.match(r.stderr + r.stdout, /Invalid country code/i)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('setup keeps an existing country list', () => {
  const cli = path.join(__dirname, '..', 'dist', 'cli.js')
  let tmpDir
  let home

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-setupkeep-'))
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-setupkeep-home-'))
  })
  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    fs.rmSync(home, { recursive: true, force: true })
  })

  const cfgFile = () => path.join(tmpDir, 'config.json')

  function setup(args) {
    return spawnSync(process.execPath, [cli, 'setup', ...args], {
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        GEO_GUARD_RC: path.join(home, '.zshrc'),
        GEO_GUARD_SHELL: 'zsh',
        GEO_GUARD_CONFIG_DIR: tmpDir,
        GEO_GUARD_CONFIG_FILE: cfgFile(),
        GEO_GUARD_LANG: 'en',
        PATH: '',
      },
      encoding: 'utf8',
    })
  }

  test('a profile-only run does not reset the shared list', () => {
    fs.writeFileSync(cfgFile(), JSON.stringify({ allowed: ['NL', 'DE'], timeoutMs: 9000 }))

    const r = setup(['--yes', '--no-hook', '--no-cursor', '--no-alias', '--cursor-countries', 'PL'])
    assert.equal(r.status, 0)

    const cfg = JSON.parse(fs.readFileSync(cfgFile(), 'utf8'))
    assert.deepEqual(cfg.allowed, ['NL', 'DE']) // раньше молча становилось ['NL']
    assert.equal(cfg.timeoutMs, 9000)
    assert.deepEqual(cfg.profiles.cursor.allowed, ['PL'])
  })

  test('an option without a value is rejected, not silently swallowed', () => {
    const r = setup(['--yes', '--no-hook', '--no-cursor', '--no-alias', '--countries'])
    assert.notEqual(r.status, 0)
    assert.match(r.stderr + r.stdout, /needs a value/i)
  })

  test('an invalid profile list aborts before the shared list is written', () => {
    fs.writeFileSync(cfgFile(), JSON.stringify({ allowed: ['NL', 'DE'] }))
    const before = fs.readFileSync(cfgFile(), 'utf8')

    const r = setup([
      '--yes', '--no-hook', '--no-cursor', '--no-alias',
      '--countries', 'ES', '--cursor-countries', 'SPAIN',
    ])
    assert.notEqual(r.status, 0)
    assert.equal(fs.readFileSync(cfgFile(), 'utf8'), before)
  })
})

describe('interactive setup driven from a pipe', () => {
  const cli = path.join(__dirname, '..', 'dist', 'cli.js')
  let home
  let cfgDir

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-pipe-'))
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-pipe-cfg-'))
  })
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(cfgDir, { recursive: true, force: true })
  })

  function setup(stdin) {
    return spawnSync(process.execPath, [cli, 'setup'], {
      input: stdin,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        GEO_GUARD_RC: path.join(home, '.zshrc'),
        GEO_GUARD_SHELL: 'zsh',
        GEO_GUARD_CONFIG_DIR: cfgDir,
        GEO_GUARD_CONFIG_FILE: path.join(cfgDir, 'config.json'),
        GEO_GUARD_LANG: 'en',
        PATH: '',
      },
      encoding: 'utf8',
    })
  }

  const configWritten = () => fs.existsSync(path.join(cfgDir, 'config.json'))

  test('answers piped all at once are all used', () => {
    // readline hands every piped line over at once; the ones arriving between
    // questions used to be dropped, and setup then waited forever on a question
    // nobody could answer — exiting 0 with nothing installed.
    const r = setup('ES,PT\ny\ny\nzsh\n')

    assert.equal(r.status, 0, r.stderr)
    assert.equal(configWritten(), true)
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(cfgDir, 'config.json'), 'utf8')).allowed,
      ['ES', 'PT'],
    )
    assert.match(fs.readFileSync(path.join(home, '.zshrc'), 'utf8'), /alias claude=/)
  })

  test('pressing Enter through every question takes the defaults', () => {
    const r = setup('\n\n\n\n')
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(cfgDir, 'config.json'), 'utf8')).allowed,
      ['NL'],
    )
  })

  test('input running out is an error, not a silent success', () => {
    const r = setup('ES,PT\ny\n')

    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /Input ended before every question/)
    assert.equal(configWritten(), false)
  })

  test('no input at all is an error too', () => {
    const r = setup('')
    assert.notEqual(r.status, 0)
    assert.equal(configWritten(), false)
  })
})

describe('setup reports the alias name it actually used', () => {
  const cli = path.join(__dirname, '..', 'dist', 'cli.js')
  let home
  let cfgDir

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-aliasname-'))
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-aliasname-cfg-'))
  })
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(cfgDir, { recursive: true, force: true })
  })

  function setup(extra) {
    return spawnSync(
      process.execPath,
      [cli, 'setup', '--yes', '--countries', 'RU', '--no-hook', '--no-cursor', ...extra],
      {
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          GEO_GUARD_RC: path.join(home, '.zshrc'),
          GEO_GUARD_SHELL: 'zsh',
          GEO_GUARD_CONFIG_DIR: cfgDir,
          GEO_GUARD_CONFIG_FILE: path.join(cfgDir, 'config.json'),
          GEO_GUARD_LANG: 'en',
          PATH: '',
        },
        encoding: 'utf8',
      },
    )
  }

  test('an uncontested name is not announced as a collision', () => {
    // Used to print "'claude' was taken by your own alias" on an empty rc.
    const r = setup(['--alias-name', 'myc'])

    assert.equal(r.status, 0)
    assert.doesNotMatch(r.stdout, /is taken/)
    assert.match(fs.readFileSync(path.join(home, '.zshrc'), 'utf8'), /alias myc=/)
  })

  test('a name that is taken says so, and names both', () => {
    // Used to fall back to 'claude' without a word about it.
    fs.writeFileSync(path.join(home, '.zshrc'), 'alias cc="git commit"\n')

    const r = setup(['--alias-name', 'cc'])

    assert.equal(r.status, 0)
    assert.match(r.stdout, /'cc' is taken by an alias of your own — using 'claude'/)
    const rc = fs.readFileSync(path.join(home, '.zshrc'), 'utf8')
    assert.match(rc, /alias cc="git commit"/)
    assert.match(rc, /alias claude="geo-guard claude"/)
  })

  test('a PowerShell profile is re-read with a dot, not sourced', () => {
    const profile = path.join(home, 'p.ps1')
    const r = spawnSync(
      process.execPath,
      [cli, 'setup', '--yes', '--countries', 'RU', '--no-hook', '--no-cursor'],
      {
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          GEO_GUARD_RC: profile,
          GEO_GUARD_SHELL: 'powershell',
          GEO_GUARD_CONFIG_DIR: cfgDir,
          GEO_GUARD_CONFIG_FILE: path.join(cfgDir, 'config.json'),
          GEO_GUARD_LANG: 'en',
          PATH: '',
        },
        encoding: 'utf8',
      },
    )

    assert.equal(r.status, 0)
    assert.match(r.stdout, /Reload your profile: \. /)
    assert.doesNotMatch(r.stdout, /source /)
  })
})

describe('setup wires cursor-agent through geo-guard', () => {
  const cli = path.join(__dirname, '..', 'dist', 'cli.js')
  let home
  let cfgDir
  let binDir

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-cagent-'))
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-cagent-cfg-'))
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-cagent-bin-'))
  })
  afterEach(() => {
    for (const dir of [home, cfgDir, binDir]) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  /** A cursor-agent on PATH — the only thing that makes setup want the alias. */
  function installFakeCursorAgent() {
    const file = path.join(binDir, 'cursor-agent')
    fs.writeFileSync(file, '#!/bin/sh\nexit 0\n')
    fs.chmodSync(file, 0o755)
  }

  const rc = () => path.join(home, '.zshrc')
  const rcText = () => (fs.existsSync(rc()) ? fs.readFileSync(rc(), 'utf8') : '')

  function run(command, args = [], pathValue = binDir) {
    return spawnSync(process.execPath, [cli, command, ...args], {
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
        PATH: pathValue,
      },
      encoding: 'utf8',
    })
  }

  const setup = (args = []) => run('setup', ['--yes', '--no-hook', '--no-cursor', ...args])

  test('the alias is installed when cursor-agent is on PATH', () => {
    installFakeCursorAgent()

    const r = setup()

    assert.equal(r.status, 0, r.stderr)
    assert.match(rcText(), /alias cursor-agent="geo-guard cursor-agent"/)
    assert.match(rcText(), /alias claude="geo-guard claude"/)
  })

  test('no cursor-agent on PATH, no alias — and setup says why', () => {
    const r = setup([], '')

    assert.equal(r.status, 0, r.stderr)
    assert.doesNotMatch(rcText(), /cursor-agent/)
    assert.match(r.stdout, /no cursor-agent on PATH/)
  })

  test('--no-cursor-alias declines it even when cursor-agent is there', () => {
    installFakeCursorAgent()

    assert.equal(setup(['--no-cursor-alias']).status, 0)

    assert.doesNotMatch(rcText(), /cursor-agent/)
    assert.match(rcText(), /alias claude=/)
  })

  test('--no-alias covers both aliases', () => {
    installFakeCursorAgent()

    assert.equal(setup(['--no-alias']).status, 0)

    assert.equal(rcText().includes('geo-guard'), false)
  })

  test('a foreign cursor-agent alias is refused, not overwritten', () => {
    installFakeCursorAgent()
    fs.writeFileSync(rc(), 'alias cursor-agent="/opt/cursor-agent --yolo"\n')

    const r = setup()

    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /cursor-agent alias skipped/)
    assert.match(rcText(), /alias cursor-agent="\/opt\/cursor-agent --yolo"/)
  })

  test('flags added by hand survive a second setup run', () => {
    installFakeCursorAgent()
    setup()
    const edited = rcText().replace(
      'alias cursor-agent="geo-guard cursor-agent"',
      'alias cursor-agent="geo-guard cursor-agent --fullscreen"',
    )
    fs.writeFileSync(rc(), edited)

    const r = setup()

    assert.equal(r.status, 0, r.stderr)
    assert.equal(rcText(), edited)
    assert.match(r.stdout, /left untouched/)
  })

  test('a second run with nothing to change leaves the rc byte-for-byte', () => {
    installFakeCursorAgent()
    setup()
    const before = rcText()

    setup()

    assert.equal(rcText(), before)
  })

  test('status reports the alias, and uninstall takes it away', () => {
    installFakeCursorAgent()
    setup()

    const status = run('status')
    assert.match(status.stdout, /cursor-agent alias:/)
    assert.match(status.stdout, /alias 'cursor-agent' → geo-guard cursor-agent/)

    const un = run('uninstall')
    assert.equal(un.status, 0, un.stderr)
    assert.equal(rcText().includes('geo-guard'), false)
  })

  test('status says the alias is not needed when cursor-agent is absent', () => {
    const r = run('status', [], '')

    assert.match(r.stdout, /cursor-agent is not installed here — no alias needed/)
  })
})
