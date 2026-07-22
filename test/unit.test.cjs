'use strict'

const { test, describe, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const {
  parseAllowed,
  parseTimeoutSeconds,
  writeConfig,
  loadConfig,
  DEFAULT_CONFIG,
  BEGIN_MARKER,
  END_MARKER,
} = require('../dist/config')
const { isAllowed } = require('../dist/geo')
const {
  stripMarkedBlock,
  findConflictingAlias,
  isOurAliasBody,
  installAlias,
  uninstallAliasFromFile,
  candidateRcPaths,
} = require('../dist/shell-alias')
const { isOurHook } = require('../dist/claude-hook')

describe('parseAllowed', () => {
  test('parses CSV and arrays', () => {
    assert.deepEqual(parseAllowed('es, pt'), ['ES', 'PT'])
    assert.deepEqual(parseAllowed(['es', 'PT']), ['ES', 'PT'])
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

describe('isAllowed', () => {
  test('checks membership', () => {
    const config = { ...DEFAULT_CONFIG, allowed: ['ES', 'PT'] }
    assert.equal(isAllowed('ES', config), true)
    assert.equal(isAllowed('RU', config), false)
    assert.equal(isAllowed(null, config), false)
  })
})

describe('stripMarkedBlock', () => {
  test('removes marked alias block', () => {
    const input = `before\n${BEGIN_MARKER}\nalias claude="geo-guard claude"\n${END_MARKER}\nafter\n`
    const out = stripMarkedBlock(input)
    assert.match(out, /before/)
    assert.match(out, /after/)
    assert.doesNotMatch(out, /geo-guard claude/)
  })
})

describe('isOurHook', () => {
  test('detects geo-guard check and legacy geo-check', () => {
    assert.equal(isOurHook({ command: 'geo-guard check' }), true)
    assert.equal(isOurHook({ command: 'geo-guard.cmd check' }), true)
    assert.equal(isOurHook({ command: '/old/path/geo-check.sh' }), true)
    assert.equal(isOurHook({ command: 'echo hi' }), false)
  })

  test('does NOT match foreign commands containing the substring', () => {
    assert.equal(isOurHook({ command: 'my-geo-check.sh' }), false)
    assert.equal(isOurHook({ command: 'echo geo-checkpoint' }), false)
    assert.equal(isOurHook({ command: 'run geo-guard-checker' }), false)
  })
})

describe('findConflictingAlias', () => {
  test("detects user's own claude alias", () => {
    const rc = 'alias claude="/usr/local/bin/claude --foo"\n'
    assert.equal(findConflictingAlias(rc, 'zsh', 'claude'), 'alias claude="/usr/local/bin/claude --foo"')
  })

  test('ignores our own managed block and legacy line', () => {
    const rc = `${BEGIN_MARKER}\nalias claude="geo-guard claude"\n${END_MARKER}\n`
    assert.equal(findConflictingAlias(rc, 'zsh', 'claude'), null)
    assert.equal(findConflictingAlias('alias claude="geo-guard claude"\n', 'zsh', 'claude'), null)
  })

  test('no conflict when name is free', () => {
    assert.equal(findConflictingAlias('alias gs="git status"\n', 'zsh', 'cc'), null)
  })

  test('zsh detects function and paren forms, ignores similarly-named', () => {
    assert.ok(findConflictingAlias('claude() { /opt/claude "$@" }\n', 'zsh', 'claude'))
    assert.ok(findConflictingAlias('function claude {\n}\n', 'zsh', 'claude'))
    assert.equal(findConflictingAlias('alias claudex="x"\n', 'zsh', 'claude'), null)
    assert.equal(findConflictingAlias('# alias claude="x"\n', 'zsh', 'claude'), null)
  })

  test('function NAME-suffix is NOT a false conflict (dash/dot not a boundary)', () => {
    for (const shell of ['zsh', 'bash', 'fish', 'powershell']) {
      assert.equal(findConflictingAlias('function claude-code {\n}\n', shell, 'claude'), null, shell)
      assert.equal(findConflictingAlias('function claude.bak {\n}\n', shell, 'claude'), null, shell)
      // но точное имя — коллизия
      assert.ok(findConflictingAlias('function claude {\n}\n', shell, 'claude'), shell)
    }
  })

  test('powershell matches alias NAME, not NAME in value', () => {
    assert.ok(findConflictingAlias('Set-Alias claude geo-guard\n', 'powershell', 'claude'))
    assert.ok(findConflictingAlias('function claude { }\n', 'powershell', 'claude'))
    // claude как ЗНАЧЕНИЕ, имя — gc: это НЕ коллизия имени claude
    assert.equal(findConflictingAlias('Set-Alias gc claude\n', 'powershell', 'claude'), null)
    assert.equal(findConflictingAlias('Set-Alias foo claude-cli\n', 'powershell', 'claude'), null)
  })
})

describe('isOurAliasBody', () => {
  test('matches generated bodies for any name', () => {
    assert.equal(isOurAliasBody('alias claude="geo-guard claude"'), true)
    assert.equal(isOurAliasBody('alias cc="geo-guard claude"'), true)
    assert.equal(isOurAliasBody('function claude { geo-guard claude @args }'), true)
  })

  test('rejects hand-edited body', () => {
    assert.equal(isOurAliasBody('alias claude="rm -rf /"'), false)
    assert.equal(isOurAliasBody('alias claude="geo-guard claude"\nexport FOO=1'), false)
  })
})

describe('install/uninstall alias via GEO_GUARD_RC', () => {
  let tmpDir
  let rcFile
  let prevRc

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-rc-'))
    rcFile = path.join(tmpDir, '.zshrc')
    prevRc = process.env.GEO_GUARD_RC
    process.env.GEO_GUARD_RC = rcFile
  })

  after(() => {
    if (prevRc === undefined) delete process.env.GEO_GUARD_RC
    else process.env.GEO_GUARD_RC = prevRc
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('install throws on foreign alias, respects custom name, uninstall is clean', () => {
    fs.writeFileSync(rcFile, 'alias claude="/opt/claude"\n')

    assert.throws(() => installAlias('zsh', { name: 'claude' }), /AliasConflictError|Уже существует/)

    const res = installAlias('zsh', { name: 'cc' })
    assert.equal(res.name, 'cc')
    const afterInstall = fs.readFileSync(rcFile, 'utf8')
    assert.match(afterInstall, /alias claude="\/opt\/claude"/) // чужой не тронут
    assert.match(afterInstall, /alias cc="geo-guard claude"/)

    const un = uninstallAliasFromFile(rcFile)
    assert.equal(un.changed, true)
    const afterUninstall = fs.readFileSync(rcFile, 'utf8')
    assert.doesNotMatch(afterUninstall, /geo-guard claude/)
    assert.match(afterUninstall, /alias claude="\/opt\/claude"/) // чужой всё ещё цел
  })

  test('uninstall keeps hand-edited block', () => {
    const edited = `${BEGIN_MARKER}\nalias claude="something important"\n${END_MARKER}\n`
    fs.writeFileSync(rcFile, edited)

    const un = uninstallAliasFromFile(rcFile)
    assert.equal(un.changed, false)
    assert.equal(un.modified, true)
    assert.equal(fs.readFileSync(rcFile, 'utf8'), edited) // не тронут
  })

  test('uninstall does NOT eat file content when END marker is missing', () => {
    const broken = `${BEGIN_MARKER}\nalias claude="geo-guard claude"\nexport IMPORTANT_TOKEN=secret\nsource ~/.work.sh\n`
    fs.writeFileSync(rcFile, broken)

    const un = uninstallAliasFromFile(rcFile)
    assert.equal(un.changed, false)
    assert.equal(un.modified, true)
    assert.equal(fs.readFileSync(rcFile, 'utf8'), broken) // ничего не потеряно
  })

  test('install over a broken (BEGIN-without-END) block does not nest markers', () => {
    const broken = `${BEGIN_MARKER}\nalias claude="geo-guard claude"\nexport IMPORTANT=1\n`
    fs.writeFileSync(rcFile, broken)

    installAlias('zsh', { name: 'claude', force: true })
    const after = fs.readFileSync(rcFile, 'utf8')

    // ровно один BEGIN и один END, пользовательская строка цела, наш блок на месте
    assert.equal(after.match(new RegExp(BEGIN_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')).length, 1)
    assert.equal(after.match(new RegExp(END_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')).length, 1)
    assert.match(after, /export IMPORTANT=1/)
    assert.match(after, /alias claude="geo-guard claude"/)

    // и последующий uninstall теперь чисто снимает блок, сохранив export
    const un = uninstallAliasFromFile(rcFile)
    assert.equal(un.changed, true)
    const cleaned = fs.readFileSync(rcFile, 'utf8')
    assert.doesNotMatch(cleaned, /geo-guard-ai begin/)
    assert.match(cleaned, /export IMPORTANT=1/)
  })
})

describe('uninstallAliasFromFile', () => {
  test('removes only our block and keeps other aliases', () => {
    const { uninstallAliasFromFile } = require('../dist/shell-alias')
    const file = path.join(os.tmpdir(), `geo-guard-rc-${process.pid}.zshrc`)
    fs.writeFileSync(
      file,
      `alias c="claude"\n\n${BEGIN_MARKER}\nalias claude="geo-guard claude"\n${END_MARKER}\nalias ll="ls -la"\n`,
    )
    const result = uninstallAliasFromFile(file)
    assert.equal(result.changed, true)
    const after = fs.readFileSync(file, 'utf8')
    assert.match(after, /alias c="claude"/)
    assert.match(after, /alias ll="ls -la"/)
    assert.doesNotMatch(after, /geo-guard-ai begin/)
    assert.doesNotMatch(after, /geo-guard claude/)
    fs.unlinkSync(file)
  })
})

describe('candidateRcPaths isolation', () => {
  let prevRc

  before(() => {
    prevRc = process.env.GEO_GUARD_RC
  })
  after(() => {
    if (prevRc === undefined) delete process.env.GEO_GUARD_RC
    else process.env.GEO_GUARD_RC = prevRc
  })

  test('GEO_GUARD_RC set => ONLY that file, never system rc files', () => {
    const rc = path.join(os.tmpdir(), 'geo-guard-isolated.zshrc')
    process.env.GEO_GUARD_RC = rc

    const paths = candidateRcPaths()
    assert.deepEqual(paths, [path.normalize(rc)])

    // ключевая гарантия: реальные пользовательские rc не попадают в обход
    const home = os.homedir()
    for (const systemRc of ['.zshrc', '.bashrc', '.bash_profile']) {
      assert.ok(
        !paths.includes(path.join(home, systemRc)),
        `${systemRc} не должен попадать в candidateRcPaths при заданном GEO_GUARD_RC`,
      )
    }
  })

  test('GEO_GUARD_RC unset => scans system rc files', () => {
    delete process.env.GEO_GUARD_RC
    const paths = candidateRcPaths()
    assert.ok(paths.includes(path.join(os.homedir(), '.zshrc')))
    assert.ok(paths.length > 1)
  })
})

describe('runCheck exit codes (child process, no network)', () => {
  const cli = path.join(__dirname, '..', 'dist', 'cli.js')
  let tmpDir

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-check-'))
  })
  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

  const runCheck = env =>
    spawnSync(process.execPath, [cli, 'check'], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
    })

  test('broken config.json => exit 2 (fail-closed, not 1)', () => {
    const bad = path.join(tmpDir, 'bad.json')
    fs.writeFileSync(bad, '{ not valid json')
    const r = runCheck({ GEO_GUARD_CONFIG_FILE: bad })
    assert.equal(r.status, 2)
  })

  test('empty providers => exit 2 (no network, blocked)', () => {
    const cfg = path.join(tmpDir, 'empty.json')
    fs.writeFileSync(cfg, JSON.stringify({ allowed: ['ES'], providers: [] }))
    const r = runCheck({ GEO_GUARD_CONFIG_FILE: cfg })
    assert.equal(r.status, 2)
  })

  test('empty GEO_GUARD_PROVIDERS => exit 2', () => {
    const cfg = path.join(tmpDir, 'c.json')
    fs.writeFileSync(cfg, JSON.stringify({ allowed: ['ES'] }))
    const r = runCheck({ GEO_GUARD_CONFIG_FILE: cfg, GEO_GUARD_PROVIDERS: '' })
    assert.equal(r.status, 2)
  })
})

const { detectLang, msg } = require('../dist/i18n')

describe('i18n locale detection', () => {
  const LOCALE_VARS = ['GEO_GUARD_LANG', 'LC_ALL', 'LC_MESSAGES', 'LANG', 'LANGUAGE']
  let saved

  before(() => {
    saved = {}
    for (const k of LOCALE_VARS) saved[k] = process.env[k]
  })
  after(() => {
    for (const k of LOCALE_VARS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  const setLocale = env => {
    for (const k of LOCALE_VARS) delete process.env[k]
    Object.assign(process.env, env)
  }

  test('ru locale => ru', () => {
    setLocale({ LANG: 'ru_RU.UTF-8' })
    assert.equal(detectLang(), 'ru')
    assert.match(msg().help(), /гео-ограничение/)
  })

  test('en locale => en', () => {
    setLocale({ LANG: 'en_US.UTF-8' })
    assert.equal(detectLang(), 'en')
    assert.match(msg().help(), /geo-restriction/)
  })

  test('unsupported locale => en fallback', () => {
    setLocale({ LANG: 'de_DE.UTF-8' })
    assert.equal(detectLang(), 'en')
  })

  test('GEO_GUARD_LANG overrides LANG', () => {
    setLocale({ LANG: 'en_US.UTF-8', GEO_GUARD_LANG: 'ru' })
    assert.equal(detectLang(), 'ru')
  })

  test('LC_ALL wins over LANG', () => {
    setLocale({ LC_ALL: 'ru_RU.UTF-8', LANG: 'en_US.UTF-8' })
    assert.equal(detectLang(), 'ru')
  })

  test('both catalogs expose the same keys', () => {
    setLocale({ GEO_GUARD_LANG: 'en' })
    const en = Object.keys(msg())
    setLocale({ GEO_GUARD_LANG: 'ru' })
    const ru = Object.keys(msg())
    assert.deepEqual(new Set(en), new Set(ru))
  })
})
