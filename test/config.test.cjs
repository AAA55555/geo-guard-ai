'use strict'

const { test, describe, before, after, beforeEach, afterEach } = require('node:test')
const { spawnSync } = require('node:child_process')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  parseAllowed,
  parseTimeoutSeconds,
  writeConfig,
  loadConfig,
  removeProfile,
  loadStrictestConfig,
  profilesConfigured,
  isProfileName,
  PROFILE_NAMES
} = require('../dist/config')

describe('parseAllowed', () => {
  test('parses CSV and arrays', () => {
    assert.deepEqual(parseAllowed('es, pt'), ['ES', 'PT'])
    assert.deepEqual(parseAllowed(['es', 'PT']), ['ES', 'PT'])
  })

  test('keeps only ISO alpha-2, dedupes', () => {
    assert.deepEqual(parseAllowed('ES,SPAIN,ESP,pt,ES'), ['ES', 'PT'])
    assert.deepEqual(parseAllowed(['spain', 'XX', 'PT']), ['XX', 'PT'])
  })

  test('invalidCountryTokens lists non-ISO entries', () => {
    const { invalidCountryTokens } = require('../dist/config')
    assert.deepEqual(invalidCountryTokens('ES,SPAIN,ESP'), ['SPAIN', 'ESP'])
    assert.deepEqual(invalidCountryTokens('es, pt'), [])
  })
})

describe('parseTimeoutSeconds', () => {
  test('treats env value as seconds', () => {
    assert.equal(parseTimeoutSeconds('5'), 5000)
    assert.equal(parseTimeoutSeconds('50'), 50_000)
    assert.equal(parseTimeoutSeconds('100'), 100_000)
  })
})

describe('writeConfig merge', () => {
  let tmpDir
  let prevFile
  let prevDir

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-test-'))
    prevFile = process.env.GEO_GUARD_CONFIG_FILE
    prevDir = process.env.GEO_GUARD_CONFIG_DIR
    process.env.GEO_GUARD_CONFIG_DIR = tmpDir
    process.env.GEO_GUARD_CONFIG_FILE = path.join(tmpDir, 'config.json')
  })

  after(() => {
    if (prevFile === undefined) delete process.env.GEO_GUARD_CONFIG_FILE
    else process.env.GEO_GUARD_CONFIG_FILE = prevFile
    if (prevDir === undefined) delete process.env.GEO_GUARD_CONFIG_DIR
    else process.env.GEO_GUARD_CONFIG_DIR = prevDir
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('preserves timeoutMs and providers when only allowed changes', () => {
    writeConfig({
      allowed: ['ES'],
      timeoutMs: 9000,
      providers: ['https://example.test/country'],
    })

    const { config } = writeConfig({ allowed: ['ES', 'PT'] })
    assert.deepEqual(config.allowed, ['ES', 'PT'])
    assert.equal(config.timeoutMs, 9000)
    assert.deepEqual(config.providers, ['https://example.test/country'])
  })

  test('loadConfig respects GEO_GUARD_TIMEOUT as seconds', () => {
    writeConfig({ allowed: ['ES'] })
    process.env.GEO_GUARD_TIMEOUT = '7'
    try {
      const config = loadConfig()
      assert.equal(config.timeoutMs, 7000)
    } finally {
      delete process.env.GEO_GUARD_TIMEOUT
    }
  })

  test('loadConfig respects empty providers [] as "no providers"', () => {
    writeConfig({ allowed: ['ES'], providers: [] })
    const config = loadConfig()
    assert.deepEqual(config.providers, [])
  })

  test('GEO_GUARD_PROVIDERS overrides file, blank env => []', () => {
    writeConfig({ allowed: ['ES'], providers: ['https://example.test/country'] })
    process.env.GEO_GUARD_PROVIDERS = '   '
    try {
      assert.deepEqual(loadConfig().providers, [])
    } finally {
      delete process.env.GEO_GUARD_PROVIDERS
    }
  })

  test('empty GEO_GUARD_ALLOWED="" => [] (fail-closed, not fallback to file)', () => {
    writeConfig({ allowed: ['ES'] })
    process.env.GEO_GUARD_ALLOWED = ''
    try {
      assert.deepEqual(loadConfig().allowed, [])
    } finally {
      delete process.env.GEO_GUARD_ALLOWED
    }
  })

  test('unset GEO_GUARD_ALLOWED uses file value', () => {
    writeConfig({ allowed: ['PT'] })
    delete process.env.GEO_GUARD_ALLOWED
    assert.deepEqual(loadConfig().allowed, ['PT'])
  })
})

describe('profiles', () => {
  let tmpDir
  let prevFile
  let prevDir

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-profiles-'))
    prevFile = process.env.GEO_GUARD_CONFIG_FILE
    prevDir = process.env.GEO_GUARD_CONFIG_DIR
    process.env.GEO_GUARD_CONFIG_DIR = tmpDir
    process.env.GEO_GUARD_CONFIG_FILE = path.join(tmpDir, 'config.json')
  })

  after(() => {
    if (prevFile === undefined) delete process.env.GEO_GUARD_CONFIG_FILE
    else process.env.GEO_GUARD_CONFIG_FILE = prevFile
    if (prevDir === undefined) delete process.env.GEO_GUARD_CONFIG_DIR
    else process.env.GEO_GUARD_CONFIG_DIR = prevDir
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const readFile = () => JSON.parse(fs.readFileSync(process.env.GEO_GUARD_CONFIG_FILE, 'utf8'))
  /** Каждый тест стартует с чистого конфига: профили иначе протекают между тестами. */
  const reset = () => {
    const file = process.env.GEO_GUARD_CONFIG_FILE
    if (fs.existsSync(file)) fs.unlinkSync(file)
  }

  test('a config without profiles behaves exactly as before', () => {
    reset()
    writeConfig({ allowed: ['NL'], timeoutMs: 5000, providers: ['https://a.test'] })
    assert.equal(profilesConfigured(), false)
    assert.deepEqual(loadConfig().allowed, ['NL'])
    // просят профиль, а его нет — молча берётся общий уровень
    assert.deepEqual(loadConfig('cursor').allowed, ['NL'])
    assert.deepEqual(loadConfig('claude').allowed, ['NL'])
  })

  test('profile overrides only its own tool, shared level untouched', () => {
    reset()
    writeConfig({ allowed: ['NL', 'DE'], timeoutMs: 5000 })
    writeConfig({ allowed: ['PL'] }, { profile: 'cursor' })

    assert.deepEqual(loadConfig().allowed, ['NL', 'DE'])
    assert.deepEqual(loadConfig('claude').allowed, ['NL', 'DE'])
    assert.deepEqual(loadConfig('cursor').allowed, ['PL'])
    assert.equal(profilesConfigured(), true)

    const raw = readFile()
    assert.deepEqual(raw.allowed, ['NL', 'DE'])
    assert.deepEqual(raw.profiles.cursor.allowed, ['PL'])
  })

  test('partial profile inherits the rest from the shared level', () => {
    reset()
    writeConfig({ allowed: ['NL'], timeoutMs: 8000, providers: ['https://shared.test'] })
    writeConfig({ allowed: ['PL'] }, { profile: 'cursor' })

    const cursor = loadConfig('cursor')
    assert.deepEqual(cursor.allowed, ['PL'])
    assert.equal(cursor.timeoutMs, 8000)
    assert.deepEqual(cursor.providers, ['https://shared.test'])
  })

  test('a profile can override timeout and providers too', () => {
    reset()
    writeConfig({ allowed: ['NL'], timeoutMs: 8000, providers: ['https://shared.test'] })
    writeConfig(
      { allowed: ['PL'], timeoutMs: 2000, providers: ['https://cursor.test'] },
      { profile: 'cursor' },
    )

    const cursor = loadConfig('cursor')
    assert.equal(cursor.timeoutMs, 2000)
    assert.deepEqual(cursor.providers, ['https://cursor.test'])
    // общий уровень не поехал
    assert.equal(loadConfig().timeoutMs, 8000)
    assert.deepEqual(loadConfig().providers, ['https://shared.test'])
  })

  test('writing one profile keeps the other and the shared level', () => {
    reset()
    writeConfig({ allowed: ['NL'] })
    writeConfig({ allowed: ['PL'] }, { profile: 'cursor' })
    writeConfig({ allowed: ['ES'] }, { profile: 'claude' })
    // повторная запись общего уровня не сносит профили
    writeConfig({ allowed: ['FR'] })

    assert.deepEqual(loadConfig().allowed, ['FR'])
    assert.deepEqual(loadConfig('cursor').allowed, ['PL'])
    assert.deepEqual(loadConfig('claude').allowed, ['ES'])
  })

  test('profile env beats shared env beats profile file beats shared file', () => {
    reset()
    writeConfig({ allowed: ['NL'] })
    writeConfig({ allowed: ['PL'] }, { profile: 'cursor' })

    // только файл
    assert.deepEqual(loadConfig('cursor').allowed, ['PL'])

    process.env.GEO_GUARD_ALLOWED = 'DE'
    try {
      // общий env перебивает профиль из файла
      assert.deepEqual(loadConfig('cursor').allowed, ['DE'])
      process.env.GEO_GUARD_ALLOWED_CURSOR = 'ES'
      try {
        // профильный env перебивает общий env
        assert.deepEqual(loadConfig('cursor').allowed, ['ES'])
        // и не задевает другой профиль
        assert.deepEqual(loadConfig('claude').allowed, ['DE'])
      } finally {
        delete process.env.GEO_GUARD_ALLOWED_CURSOR
      }
    } finally {
      delete process.env.GEO_GUARD_ALLOWED
    }
  })

  test('empty GEO_GUARD_ALLOWED_CURSOR="" blocks cursor only (fail-closed)', () => {
    reset()
    writeConfig({ allowed: ['NL'] })
    process.env.GEO_GUARD_ALLOWED_CURSOR = ''
    try {
      assert.deepEqual(loadConfig('cursor').allowed, [])
      assert.deepEqual(loadConfig('claude').allowed, ['NL'])
      assert.equal(profilesConfigured(), true)
    } finally {
      delete process.env.GEO_GUARD_ALLOWED_CURSOR
    }
  })

  test('profile-only env counts as configured without a file section', () => {
    reset()
    writeConfig({ allowed: ['NL'] })
    assert.equal(profilesConfigured(), false)
    process.env.GEO_GUARD_TIMEOUT_CURSOR = '3'
    try {
      assert.equal(profilesConfigured(), true)
      assert.equal(loadConfig('cursor').timeoutMs, 3000)
      assert.equal(loadConfig('claude').timeoutMs, 5000)
    } finally {
      delete process.env.GEO_GUARD_TIMEOUT_CURSOR
    }
  })

  test('removeProfile drops the section and the profiles key when last', () => {
    reset()
    writeConfig({ allowed: ['NL'] })
    writeConfig({ allowed: ['PL'] }, { profile: 'cursor' })
    writeConfig({ allowed: ['ES'] }, { profile: 'claude' })

    assert.equal(removeProfile('cursor').removed, true)
    assert.equal(readFile().profiles.cursor, undefined)
    assert.deepEqual(readFile().profiles.claude.allowed, ['ES'])

    assert.equal(removeProfile('claude').removed, true)
    assert.equal(readFile().profiles, undefined)
    assert.deepEqual(loadConfig('cursor').allowed, ['NL'])

    assert.equal(removeProfile('cursor').removed, false)
  })

  test('isProfileName guards the public names', () => {
    reset()
    assert.deepEqual([...PROFILE_NAMES], ['claude', 'cursor'])
    assert.equal(isProfileName('cursor'), true)
    assert.equal(isProfileName('vscode'), false)
    assert.equal(isProfileName(''), false)
    assert.equal(isProfileName(undefined), false)
  })
})

describe('loadStrictestConfig', () => {
  let tmpDir

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-strict-'))
    process.env.GEO_GUARD_CONFIG_DIR = tmpDir
    process.env.GEO_GUARD_CONFIG_FILE = path.join(tmpDir, 'config.json')
  })
  after(() => {
    delete process.env.GEO_GUARD_CONFIG_DIR
    delete process.env.GEO_GUARD_CONFIG_FILE
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('intersects the shared list with every configured profile', () => {
    writeConfig({ allowed: ['NL', 'DE', 'PL'] })
    writeConfig({ allowed: ['NL', 'DE'] }, { profile: 'claude' })
    writeConfig({ allowed: ['DE', 'PL'] }, { profile: 'cursor' })
    assert.deepEqual(loadStrictestConfig().allowed, ['DE'])
  })

  test('with no profiles it is just the shared list', () => {
    fs.unlinkSync(process.env.GEO_GUARD_CONFIG_FILE)
    writeConfig({ allowed: ['NL', 'DE'] })
    assert.deepEqual(loadStrictestConfig().allowed, ['NL', 'DE'])
  })

  test('disjoint policies mean nothing is allowed', () => {
    fs.unlinkSync(process.env.GEO_GUARD_CONFIG_FILE)
    writeConfig({ allowed: ['NL'] })
    writeConfig({ allowed: ['PL'] }, { profile: 'cursor' })
    assert.deepEqual(loadStrictestConfig().allowed, [])
  })
})

describe('geo-guard config command', () => {
  const cli = path.join(__dirname, '..', 'dist', 'cli.js')
  let tmpDir

  // Свой каталог на каждый тест: общий делал их зависимыми от порядка запуска.
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-configcmd-'))
  })
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

  const cfgFile = () => path.join(tmpDir, 'config.json')
  const readCfg = () => JSON.parse(fs.readFileSync(cfgFile(), 'utf8'))

  function run(args) {
    return spawnSync(process.execPath, [cli, 'config', ...args], {
      env: {
        ...process.env,
        GEO_GUARD_CONFIG_DIR: tmpDir,
        GEO_GUARD_CONFIG_FILE: cfgFile(),
        GEO_GUARD_LANG: 'en',
      },
      encoding: 'utf8',
    })
  }

  test('sets the shared list, then a profile, then unsets it', () => {
    assert.equal(run(['--countries', 'NL,DE']).status, 0)
    assert.deepEqual(readCfg().allowed, ['NL', 'DE'])
    assert.equal(readCfg().profiles, undefined)

    assert.equal(run(['--countries', 'PL', '--profile', 'cursor']).status, 0)
    assert.deepEqual(readCfg().allowed, ['NL', 'DE'])
    assert.deepEqual(readCfg().profiles.cursor.allowed, ['PL'])

    const shown = run([])
    assert.match(shown.stdout, /shared\s+allowed: NL, DE \(from the file\)/)
    assert.match(shown.stdout, /cursor\s+allowed: PL\s+\(own profile\)/)
    assert.match(shown.stdout, /claude\s+allowed: NL, DE\s+\(inherited\)/)

    assert.equal(run(['--unset', '--profile', 'cursor']).status, 0)
    assert.equal(readCfg().profiles, undefined)
    assert.deepEqual(readCfg().allowed, ['NL', 'DE'])
  })

  test('never touches the rc file or the hook configs', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-confighome-'))
    const rc = path.join(home, '.zshrc')
    fs.writeFileSync(rc, 'alias claude="geo-guard claude --my-flag"\n')
    const before = fs.readFileSync(rc, 'utf8')

    const r = spawnSync(process.execPath, [cli, 'config', '--countries', 'ES'], {
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        GEO_GUARD_RC: rc,
        GEO_GUARD_CONFIG_DIR: tmpDir,
        GEO_GUARD_CONFIG_FILE: cfgFile(),
        GEO_GUARD_LANG: 'en',
      },
      encoding: 'utf8',
    })

    assert.equal(r.status, 0)
    assert.equal(fs.readFileSync(rc, 'utf8'), before)
    assert.equal(fs.existsSync(path.join(home, '.claude', 'settings.json')), false)
    assert.equal(fs.existsSync(path.join(home, '.cursor', 'hooks.json')), false)
    fs.rmSync(home, { recursive: true, force: true })
  })

  test('--reset returns the whole config to the defaults and drops the profiles', () => {
    fs.writeFileSync(
      cfgFile(),
      JSON.stringify({
        allowed: ['ES', 'PT'],
        timeoutMs: 12000,
        providers: ['https://example.test/country'],
        profiles: { cursor: { allowed: ['PL'] }, claude: { allowed: ['DE'] } },
      }),
    )

    const r = run(['--reset'])
    assert.equal(r.status, 0)
    assert.match(r.stdout, /back to defaults/)
    assert.match(r.stdout, /shared\s+allowed: NL \(from the file\)\s+timeout: 5s/)

    const cfg = readCfg()
    assert.deepEqual(cfg.allowed, ['NL'])
    assert.equal(cfg.timeoutMs, 5000)
    assert.deepEqual(cfg.providers, [
      'https://ifconfig.co/country-iso',
      'https://ipinfo.io/country',
    ])
    assert.equal(cfg.profiles, undefined)
  })

  test('--reset --profile drops only that profile, like --unset', () => {
    assert.equal(run(['--countries', 'NL,DE']).status, 0)
    assert.equal(run(['--countries', 'PL', '--profile', 'cursor']).status, 0)
    assert.equal(run(['--countries', 'ES', '--profile', 'claude']).status, 0)

    assert.equal(run(['--reset', '--profile', 'cursor']).status, 0)
    assert.equal(readCfg().profiles.cursor, undefined)
    assert.deepEqual(readCfg().profiles.claude.allowed, ['ES'])
    assert.deepEqual(readCfg().allowed, ['NL', 'DE'])
  })

  test('--reset never touches the rc file or the hook configs', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-resethome-'))
    const rc = path.join(home, '.zshrc')
    fs.writeFileSync(rc, 'alias claude="geo-guard claude --my-flag"\n')
    const before = fs.readFileSync(rc, 'utf8')

    const r = spawnSync(process.execPath, [cli, 'config', '--reset'], {
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        GEO_GUARD_RC: rc,
        GEO_GUARD_CONFIG_DIR: tmpDir,
        GEO_GUARD_CONFIG_FILE: cfgFile(),
        GEO_GUARD_LANG: 'en',
      },
      encoding: 'utf8',
    })

    assert.equal(r.status, 0)
    assert.equal(fs.readFileSync(rc, 'utf8'), before)
    assert.equal(fs.existsSync(path.join(home, '.claude', 'settings.json')), false)
    assert.equal(fs.existsSync(path.join(home, '.cursor', 'hooks.json')), false)
    fs.rmSync(home, { recursive: true, force: true })
  })

  test('rejects bad input without writing anything', () => {
    run(['--countries', 'NL'])
    const before = fs.readFileSync(cfgFile(), 'utf8')

    for (const args of [
      ['--countries', 'SPAIN'],
      ['--profile', 'vscode'],
      ['--unset'],
      ['--unset', '--profile', 'cursor', '--countries', 'PL'],
      ['--reset', '--countries', 'PL'],
      ['--reset', '--profile', 'cursor', '--countries', 'PL'],
      ['--bogus'],
    ]) {
      const r = run(args)
      assert.notEqual(r.status, 0, `expected failure for ${args.join(' ')}`)
    }

    assert.equal(fs.readFileSync(cfgFile(), 'utf8'), before)
  })
})

describe('config: env override, reset spellings, nested config path', () => {
  const cli = path.join(__dirname, '..', 'dist', 'cli.js')
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-cfg2-'))
  })
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

  function run(args, extraEnv = {}, file = path.join(tmpDir, 'config.json')) {
    return spawnSync(process.execPath, [cli, 'config', ...args], {
      env: {
        ...process.env,
        GEO_GUARD_CONFIG_DIR: tmpDir,
        GEO_GUARD_CONFIG_FILE: file,
        GEO_GUARD_LANG: 'en',
        GEO_GUARD_ALLOWED: undefined,
        GEO_GUARD_ALLOWED_CURSOR: undefined,
        ...extraEnv,
      },
      encoding: 'utf8',
    })
  }

  test('an env override is labelled as such instead of "inherited"', () => {
    run(['--countries', 'NL'])

    const r = run([], { GEO_GUARD_ALLOWED: 'RU', GEO_GUARD_ALLOWED_CURSOR: 'CN' })

    assert.equal(r.status, 0)
    assert.match(r.stdout, /shared\s+allowed: RU \(overridden by GEO_GUARD_ALLOWED\)/)
    assert.match(r.stdout, /cursor\s+allowed: CN\s+\(overridden by GEO_GUARD_ALLOWED_CURSOR\)/)
    assert.doesNotMatch(r.stdout, /RU\s+\(inherited\)/)
    // env не должен попадать в файл
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf8')).allowed, [
      'NL',
    ])
  })

  test('the shared line does not claim to inherit from anywhere', () => {
    run(['--countries', 'NL'])
    assert.match(run([]).stdout, /shared\s+allowed: NL \(from the file\)/)
  })

  test('--reset --unset without a profile is a full reset, --unset alone still errors', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'config.json'),
      JSON.stringify({ allowed: ['ES'], profiles: { cursor: { allowed: ['PL'] } } }),
    )

    const both = run(['--reset', '--unset'])
    assert.equal(both.status, 0)
    const cfg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf8'))
    assert.deepEqual(cfg.allowed, ['NL'])
    assert.equal(cfg.profiles, undefined)

    const alone = run(['--unset'])
    assert.notEqual(alone.status, 0)
    assert.match(alone.stderr, /--unset needs a profile/)
  })

  test('a profile with no allowed of its own is not reported as "own profile"', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'config.json'),
      JSON.stringify({ allowed: ['NL', 'DE'], profiles: { cursor: { timeoutMs: 9000 } } }),
    )

    const r = run([])

    assert.match(r.stdout, /cursor\s+allowed: NL, DE\s+\(inherited\)/)
    assert.doesNotMatch(r.stdout, /cursor.*own profile/)
  })

  test('a JSON null falls through to the default, and the label says so', () => {
    // loadConfig разрешает это через `??`, для которого null прозрачен;
    // метка обязана говорить то же самое, а не «из файла» / «свой профиль».
    fs.writeFileSync(
      path.join(tmpDir, 'config.json'),
      JSON.stringify({ allowed: null, profiles: { cursor: { allowed: null } } }),
    )

    const r = run([])

    assert.match(r.stdout, /shared\s+allowed: NL \(built-in default\)/)
    assert.match(r.stdout, /cursor\s+allowed: NL\s+\(built-in default\)/)
    assert.doesNotMatch(r.stdout, /own profile|from the file/)
  })

  test('with no config file at all the values are labelled as built-in defaults', () => {
    const r = run([], {}, path.join(tmpDir, 'missing.json'))
    assert.match(r.stdout, /shared\s+allowed: NL \(built-in default\)/)
  })

  test('a config path in a directory that does not exist yet is created', () => {
    const nested = path.join(tmpDir, 'nope', 'deeper', 'config.json')

    const r = run(['--countries', 'NL'], {}, nested)

    assert.equal(r.status, 0)
    assert.deepEqual(JSON.parse(fs.readFileSync(nested, 'utf8')).allowed, ['NL'])
  })
})
