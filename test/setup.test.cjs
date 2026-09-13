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
    assert.deepEqual(parseArgs(['--yes', '--countries', 'ES,PT', '--no-hook', '--no-shim']).countries, 'ES,PT')
  })

  test('setup --countries SPAIN exits non-zero', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-setup-'))
    try {
      const r = spawnSync(process.execPath, [cli, 'setup', '--yes', '--countries', 'SPAIN', '--no-hook', '--no-shim'], {
        env: {
          ...process.env,
          GEO_GUARD_CONFIG_DIR: tmp,
          GEO_GUARD_CONFIG_FILE: path.join(tmp, 'config.json'),
          GEO_GUARD_RC: path.join(tmp, '.zshrc'),
          GEO_GUARD_SHIM_DIR: path.join(tmp, 'shim-bin'),
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
        GEO_GUARD_SHIM_DIR: path.join(home, 'shim-bin'),
        GEO_GUARD_LANG: 'en',
        PATH: '',
      },
      encoding: 'utf8',
    })
  }

  test('a profile-only run does not reset the shared list', () => {
    fs.writeFileSync(cfgFile(), JSON.stringify({ allowed: ['NL', 'DE'], timeoutMs: 9000 }))

    const r = setup(['--yes', '--no-hook', '--no-cursor', '--no-shim', '--cursor-countries', 'PL'])
    assert.equal(r.status, 0)

    const cfg = JSON.parse(fs.readFileSync(cfgFile(), 'utf8'))
    assert.deepEqual(cfg.allowed, ['NL', 'DE']) // раньше молча становилось ['NL']
    assert.equal(cfg.timeoutMs, 9000)
    assert.deepEqual(cfg.profiles.cursor.allowed, ['PL'])
  })

  test('an option without a value is rejected, not silently swallowed', () => {
    const r = setup(['--yes', '--no-hook', '--no-cursor', '--no-shim', '--countries'])
    assert.notEqual(r.status, 0)
    assert.match(r.stderr + r.stdout, /needs a value/i)
  })

  test('an invalid profile list aborts before the shared list is written', () => {
    fs.writeFileSync(cfgFile(), JSON.stringify({ allowed: ['NL', 'DE'] }))
    const before = fs.readFileSync(cfgFile(), 'utf8')

    const r = setup([
      '--yes', '--no-hook', '--no-cursor', '--no-shim',
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
        GEO_GUARD_SHIM_DIR: path.join(home, 'shim-bin'),
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
    const rc = fs.readFileSync(path.join(home, '.zshrc'), 'utf8')
    assert.match(rc, /geo-guard-ai path begin/)
    assert.match(rc, /shim-bin/)
    assert.equal(fs.existsSync(path.join(home, 'shim-bin', 'claude')), true)
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

describe('setup installs the launch gate', () => {
  const cli = path.join(__dirname, '..', 'dist', 'cli.js')
  let home
  let cfgDir

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-gate-'))
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-gate-cfg-'))
  })
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(cfgDir, { recursive: true, force: true })
  })

  const rc = () => path.join(home, '.zshrc')
  const rcText = () => (fs.existsSync(rc()) ? fs.readFileSync(rc(), 'utf8') : '')
  const shimDir = () => path.join(home, 'shim-bin')
  const shim = name => path.join(shimDir(), name)
  const shimText = name => (fs.existsSync(shim(name)) ? fs.readFileSync(shim(name), 'utf8') : '')

  function setup(extra = []) {
    return spawnSync(
      process.execPath,
      [cli, 'setup', '--yes', '--countries', 'RU', '--no-hook', '--no-cursor', ...extra],
      {
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          GEO_GUARD_RC: rc(),
          GEO_GUARD_SHELL: 'zsh',
          GEO_GUARD_CONFIG_DIR: cfgDir,
          GEO_GUARD_CONFIG_FILE: path.join(cfgDir, 'config.json'),
          GEO_GUARD_SHIM_DIR: shimDir(),
          GEO_GUARD_LANG: 'en',
          PATH: '',
        },
        encoding: 'utf8',
      },
    )
  }

  test('a shim executable and a PATH block, not an alias', () => {
    const r = setup()

    assert.equal(r.status, 0, r.stderr)
    assert.match(shimText('claude'), /geo-guard-ai shim v1: claude/)
    assert.match(shimText('claude'), /exec "\$GG" claude "\$@"/)
    assert.match(rcText(), /geo-guard-ai path begin/)
    assert.doesNotMatch(rcText(), /alias claude=/)
  })

  test('--no-shim installs neither the shim nor the PATH block', () => {
    assert.equal(setup(['--no-shim']).status, 0)

    assert.equal(fs.existsSync(shim('claude')), false)
    assert.equal(rcText().includes('geo-guard'), false)
  })

  test('a second run with nothing to change leaves the rc byte-for-byte', () => {
    setup()
    const before = rcText()

    setup()

    assert.equal(rcText(), before)
  })

  test('the retired alias flags name their replacement instead of failing blankly', () => {
    for (const [flag, replacement] of [
      ['--no-alias', '--no-shim'],
      ['--alias', '--shim'],
      ['--cursor-alias', '--cursor-shim'],
      ['--force-alias', '--force-shim'],
    ]) {
      const r = setup([flag])
      assert.notEqual(r.status, 0, flag)
      assert.match(r.stderr, new RegExp(`${flag} is gone`), flag)
      assert.match(r.stderr, new RegExp(`Use ${replacement} instead`), flag)
    }
  })

  test('--alias-name is refused: the gate has no name of its own', () => {
    const r = setup(['--alias-name', 'cc'])
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /--alias-name is gone/)
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
          GEO_GUARD_SHIM_DIR: shimDir(),
          GEO_GUARD_LANG: 'en',
          PATH: '',
        },
        encoding: 'utf8',
      },
    )

    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /Reload your profile: \. /)
    assert.doesNotMatch(r.stdout, /source /)
  })
})

describe('setup replaces an alias install with the shim', () => {
  const cli = path.join(__dirname, '..', 'dist', 'cli.js')
  const BEGIN = '# >>> geo-guard-ai begin >>>'
  const END = '# <<< geo-guard-ai end <<<'
  let home
  let cfgDir

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-migrate-'))
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-migrate-cfg-'))
  })
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(cfgDir, { recursive: true, force: true })
  })

  const rc = () => path.join(home, '.zshrc')
  const rcText = () => fs.readFileSync(rc(), 'utf8')
  const shimText = () => fs.readFileSync(path.join(home, 'shim-bin', 'claude'), 'utf8')

  function setup(extra = []) {
    return spawnSync(
      process.execPath,
      [cli, 'setup', '--yes', '--countries', 'RU', '--no-hook', '--no-cursor', ...extra],
      {
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          GEO_GUARD_RC: rc(),
          GEO_GUARD_SHELL: 'zsh',
          GEO_GUARD_CONFIG_DIR: cfgDir,
          GEO_GUARD_CONFIG_FILE: path.join(cfgDir, 'config.json'),
          GEO_GUARD_SHIM_DIR: path.join(home, 'shim-bin'),
          GEO_GUARD_LANG: 'en',
          PATH: '',
        },
        encoding: 'utf8',
      },
    )
  }

  test('our old alias block goes, the flags in it move into the shim', () => {
    fs.writeFileSync(
      rc(),
      `export FOO=1\n${BEGIN}\nalias claude="geo-guard claude --dangerously-skip-permissions"\n${END}\nalias ll="ls -la"\n`,
    )

    const r = setup()

    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /the old geo-guard alias block is gone/)
    assert.doesNotMatch(rcText(), /alias claude=/)
    assert.match(shimText(), /exec "\$GG" claude --dangerously-skip-permissions "\$@"/)
    // Lines that are not ours are exactly where they were.
    assert.match(rcText(), /export FOO=1/)
    assert.match(rcText(), /alias ll="ls -la"/)
  })

  test('the flags survive the next setup run, once the alias is gone', () => {
    fs.writeFileSync(
      rc(),
      `${BEGIN}\nalias claude="geo-guard claude --dangerously-skip-permissions"\n${END}\n`,
    )
    setup()

    assert.equal(setup().status, 0)

    assert.match(shimText(), /--dangerously-skip-permissions/)
  })

  test('the flags outlive every later setup run, not just the migrating one', () => {
    fs.writeFileSync(
      rc(),
      `${BEGIN}\nalias claude="geo-guard claude --mine"\n${END}\n`,
    )
    setup()
    assert.match(shimText(), /--mine/)

    // Nothing left in the rc to carry them now: the shim itself is the record.
    assert.equal(setup().status, 0)
    assert.equal(setup().status, 0)

    assert.match(shimText(), /claude --mine "\$@"/)
  })

  test('--claude-args sets the flags, an empty value clears them', () => {
    setup(['--claude-args', '--dangerously-skip-permissions'])
    assert.match(shimText(), /claude --dangerously-skip-permissions "\$@"/)

    // Asking for particular flags outranks keeping what is there.
    setup(['--claude-args', '--verbose --foo'])
    assert.match(shimText(), /claude --verbose --foo "\$@"/)

    setup(['--claude-args', ''])
    assert.match(shimText(), /claude "\$@"/)
  })

  test('--claude-args wins over what the alias block carried', () => {
    fs.writeFileSync(
      rc(),
      `${BEGIN}\nalias claude="geo-guard claude --mine"\n${END}\n`,
    )

    assert.equal(setup(['--claude-args', '--theirs']).status, 0)

    assert.match(shimText(), /claude --theirs "\$@"/)
  })

  test('flags with a line break are refused before anything is written', () => {
    const r = setup(['--claude-args', 'ok\nrm -rf /'])

    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /cannot contain control characters/)
    assert.equal(fs.existsSync(path.join(home, 'shim-bin', 'claude')), false)
  })

  test('interactive: Enter on the flags question keeps what is in place', () => {
    setup(['--claude-args', '--dangerously-skip-permissions'])

    // countries, claude hook, gate?, flags (Enter), shells.
    const r = spawnSync(process.execPath, [cli, 'setup'], {
      input: 'RU\ny\ny\n\nzsh\n',
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        GEO_GUARD_RC: rc(),
        GEO_GUARD_SHELL: 'zsh',
        GEO_GUARD_CONFIG_DIR: cfgDir,
        GEO_GUARD_CONFIG_FILE: path.join(cfgDir, 'config.json'),
        GEO_GUARD_SHIM_DIR: path.join(home, 'shim-bin'),
        GEO_GUARD_LANG: 'en',
        PATH: '',
      },
      encoding: 'utf8',
    })

    assert.equal(r.status, 0, r.stderr)
    // The question offers the flags already in place as its default.
    assert.match(r.stdout, /Flags to pass to claude on every launch[^:]*\[--dangerously-skip-permissions\]/)
    assert.match(shimText(), /claude --dangerously-skip-permissions "\$@"/)
  })

  test('no flags anywhere means no flags question at all', () => {
    // Four answers, not five: a question whose answer is always empty is noise.
    const r = spawnSync(process.execPath, [cli, 'setup'], {
      input: 'RU\ny\ny\nzsh\n',
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        GEO_GUARD_RC: rc(),
        GEO_GUARD_SHELL: 'zsh',
        GEO_GUARD_CONFIG_DIR: cfgDir,
        GEO_GUARD_CONFIG_FILE: path.join(cfgDir, 'config.json'),
        GEO_GUARD_SHIM_DIR: path.join(home, 'shim-bin'),
        GEO_GUARD_LANG: 'en',
        PATH: '',
      },
      encoding: 'utf8',
    })

    assert.equal(r.status, 0, r.stderr)
    assert.doesNotMatch(r.stdout, /Flags to pass to claude/)
  })

  test('foreign content between our markers is left where it is', () => {
    const foreign = `${BEGIN}\nexport MY_IMPORTANT=1\n${END}\n`
    fs.writeFileSync(rc(), foreign)

    const r = setup()

    assert.equal(r.status, 0, r.stderr)
    assert.match(rcText(), /export MY_IMPORTANT=1/)
    assert.match(r.stdout, /edited by hand/)
  })
})

describe('setup gates cursor-agent separately', () => {
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

  /** A cursor-agent on PATH — the only thing that makes setup want to gate it. */
  function installFakeCursorAgent() {
    const file = path.join(binDir, 'cursor-agent')
    fs.writeFileSync(file, '#!/bin/sh\nexit 0\n')
    fs.chmodSync(file, 0o755)
  }

  const rc = () => path.join(home, '.zshrc')
  const rcText = () => (fs.existsSync(rc()) ? fs.readFileSync(rc(), 'utf8') : '')
  const shimDir = () => path.join(home, 'shim-bin')
  const hasShim = name => fs.existsSync(path.join(shimDir(), name))

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
        GEO_GUARD_SHIM_DIR: shimDir(),
        GEO_GUARD_PROVIDERS: '',
        GEO_GUARD_LANG: 'en',
        PATH: pathValue,
      },
      encoding: 'utf8',
    })
  }

  const setup = (args = []) => run('setup', ['--yes', '--no-hook', '--no-cursor', ...args])

  test('the shim is installed when cursor-agent is on PATH', () => {
    installFakeCursorAgent()

    const r = setup()

    assert.equal(r.status, 0, r.stderr)
    assert.equal(hasShim('cursor-agent'), true)
    assert.equal(hasShim('claude'), true)
  })

  test('no cursor-agent on PATH, no shim — and setup says why', () => {
    const r = setup([], '')

    assert.equal(r.status, 0, r.stderr)
    assert.equal(hasShim('cursor-agent'), false)
    assert.match(r.stdout, /no cursor-agent on PATH/)
  })

  test('--no-cursor-shim declines it even when cursor-agent is there', () => {
    installFakeCursorAgent()

    assert.equal(setup(['--no-cursor-shim']).status, 0)

    assert.equal(hasShim('cursor-agent'), false)
    assert.equal(hasShim('claude'), true)
  })

  test('--no-shim covers both targets', () => {
    installFakeCursorAgent()

    assert.equal(setup(['--no-shim']).status, 0)

    assert.equal(hasShim('cursor-agent'), false)
    assert.equal(hasShim('claude'), false)
    assert.equal(rcText().includes('geo-guard'), false)
  })

  test('removing one gate leaves the other alone', () => {
    installFakeCursorAgent()
    setup()

    fs.rmSync(path.join(shimDir(), 'claude'))
    assert.equal(setup(['--no-shim', '--cursor-shim']).status, 0)

    assert.equal(hasShim('claude'), false)
    assert.equal(hasShim('cursor-agent'), true)
  })

  test('a file of someone else\'s under that name is never overwritten', () => {
    installFakeCursorAgent()
    fs.mkdirSync(shimDir(), { recursive: true })
    fs.writeFileSync(path.join(shimDir(), 'cursor-agent'), '#!/bin/sh\necho mine\n')

    const r = setup()

    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /is not ours/)
    assert.equal(fs.readFileSync(path.join(shimDir(), 'cursor-agent'), 'utf8'), '#!/bin/sh\necho mine\n')
  })

  test('status reports both gates, and uninstall takes them away', () => {
    installFakeCursorAgent()
    setup()

    // The shim directory first on PATH is what makes the gate real.
    const status = run('status', [], `${shimDir()}${path.delimiter}${binDir}`)
    assert.match(status.stdout, /Launch gate \(PATH shims\)/)
    assert.match(status.stdout, /cursor-agent goes through geo-guard/)

    const un = run('uninstall')
    assert.equal(un.status, 0, un.stderr)
    assert.equal(hasShim('cursor-agent'), false)
    assert.equal(hasShim('claude'), false)
    assert.equal(rcText().includes('geo-guard'), false)
  })

  test('status says the gate is not needed when cursor-agent is absent', () => {
    const r = run('status', [], '')

    assert.match(r.stdout, /cursor-agent is not installed here — no shim needed/)
  })
})

describe('setup --shells writes the PATH entry into every shell asked for', () => {
  const cli = path.join(__dirname, '..', 'dist', 'cli.js')
  let home
  let cfgDir

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-shells-'))
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-shells-cfg-'))
  })
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(cfgDir, { recursive: true, force: true })
  })

  const read = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')
  const zshrc = () => path.join(home, '.zshrc')
  const bashrc = () => path.join(home, '.bashrc')

  // No GEO_GUARD_RC here on purpose: that variable pins every shell to one file,
  // which is exactly what these tests need to see spread across several.
  function setup(extra = []) {
    return spawnSync(
      process.execPath,
      [cli, 'setup', '--yes', '--countries', 'RU', '--no-hook', '--no-cursor', ...extra],
      {
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          GEO_GUARD_SHELL: 'zsh',
          GEO_GUARD_CONFIG_DIR: cfgDir,
          GEO_GUARD_CONFIG_FILE: path.join(cfgDir, 'config.json'),
          GEO_GUARD_SHIM_DIR: path.join(home, 'shim-bin'),
          GEO_GUARD_RC: '',
          GEO_GUARD_LANG: 'en',
          PATH: '',
        },
        encoding: 'utf8',
      },
    )
  }

  test('by default only the shell you are in', () => {
    assert.equal(setup().status, 0)

    assert.match(read(zshrc()), /geo-guard-ai path begin/)
    assert.equal(read(bashrc()).includes('geo-guard'), false)
  })

  test('--shells zsh,bash writes both', () => {
    assert.equal(setup(['--shells', 'zsh,bash']).status, 0)

    assert.match(read(zshrc()), /geo-guard-ai path begin/)
    assert.match(read(bashrc()), /geo-guard-ai path begin/)
  })

  test("bash also gets the entry in its login file, which never reads ~/.bashrc", () => {
    // A login bash reads its login file and never ~/.bashrc, and an interactive
    // one reads ~/.bashrc and never the login file. Sourcing one from the other
    // does not join them: a distribution's ~/.bashrc returns early unless the
    // shell is interactive. So each file carries the entry itself.
    assert.equal(setup(['--shells', 'bash']).status, 0)

    assert.match(read(path.join(home, '.bashrc')), /geo-guard-ai path begin/)
    assert.match(read(path.join(home, '.bash_profile')), /geo-guard-ai path begin/)
  })

  test('--shells all covers the shell we are in, installed or not', () => {
    assert.equal(setup(['--shells', 'all']).status, 0)

    assert.match(read(zshrc()), /geo-guard-ai path begin/)
  })

  test('an unknown shell is refused by name', () => {
    const r = setup(['--shells', 'zsh,tcsh'])

    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /Unsupported shell: tcsh/)
  })
})

describe('uninstall takes the whole gate away, and nothing else', () => {
  const cli = path.join(__dirname, '..', 'dist', 'cli.js')
  let home
  let cfgDir

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-unins-'))
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-unins-cfg-'))
  })
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(cfgDir, { recursive: true, force: true })
  })

  const rc = () => path.join(home, '.zshrc')
  const rcText = () => (fs.existsSync(rc()) ? fs.readFileSync(rc(), 'utf8') : '')
  const shimDir = () => path.join(home, 'shim-bin')

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
        GEO_GUARD_SHIM_DIR: shimDir(),
        GEO_GUARD_PROVIDERS: '',
        GEO_GUARD_LANG: 'en',
        PATH: '',
      },
      encoding: 'utf8',
    })
  }

  const setup = () => run('setup', ['--yes', '--countries', 'RU', '--no-hook', '--no-cursor'])

  test('shim, shim directory and PATH block all go', () => {
    setup()
    fs.writeFileSync(rc(), `alias ll="ls -la"\n${rcText()}`)

    const r = run('uninstall')

    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /launch gate removed/)
    assert.match(r.stdout, /PATH entry removed/)
    assert.equal(fs.existsSync(shimDir()), false)
    assert.equal(rcText().includes('geo-guard'), false)
    assert.match(rcText(), /alias ll="ls -la"/)
  })

  test('an old alias block goes too, so an upgraded machine ends up clean', () => {
    fs.writeFileSync(
      rc(),
      '# >>> geo-guard-ai begin >>>\nalias claude="geo-guard claude"\n# <<< geo-guard-ai end <<<\n',
    )

    const r = run('uninstall')

    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /alias removed from/)
    assert.equal(rcText().includes('geo-guard'), false)
  })

  test('a file in the shim directory that is not ours is left alone', () => {
    setup()
    fs.writeFileSync(path.join(shimDir(), 'notes.txt'), 'mine\n')
    fs.writeFileSync(path.join(shimDir(), 'codex'), '#!/bin/sh\necho mine\n')

    const r = run('uninstall')

    assert.equal(r.status, 0, r.stderr)
    assert.equal(fs.existsSync(path.join(shimDir(), 'claude')), false)
    // The directory stays, because taking it would take the user's files with it.
    assert.equal(fs.readFileSync(path.join(shimDir(), 'notes.txt'), 'utf8'), 'mine\n')
    assert.equal(fs.readFileSync(path.join(shimDir(), 'codex'), 'utf8'), '#!/bin/sh\necho mine\n')
  })

  test('a PATH block someone edited is reported, not cut', () => {
    const edited =
      '# >>> geo-guard-ai path begin >>>\nexport MY_IMPORTANT=1\n# <<< geo-guard-ai path end <<<\n'
    fs.writeFileSync(rc(), edited)

    const r = run('uninstall')

    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /was edited by hand/)
    assert.equal(rcText(), edited)
  })
})
