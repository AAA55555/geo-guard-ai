'use strict'

const { test, describe, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

const {
  parseAllowed,
  parseTimeoutSeconds,
  writeConfig,
  loadConfig,
  removeProfile,
  loadStrictestConfig,
  profilesConfigured,
  hasProfileSection,
  isProfileName,
  PROFILE_NAMES,
  DEFAULT_CONFIG,
  BEGIN_MARKER,
  END_MARKER,
} = require('../dist/config')
const { isAllowed } = require('../dist/geo')
const {
  stripMarkedBlock,
  findConflictingAlias,
  isPristineAliasBody,
  isGeoGuardAliasBody,
  parseAliasBody,
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
    assert.equal(hasProfileSection('cursor'), false)
  })

  test('profile overrides only its own tool, shared level untouched', () => {
    reset()
    writeConfig({ allowed: ['NL', 'DE'], timeoutMs: 5000 })
    writeConfig({ allowed: ['PL'] }, { profile: 'cursor' })

    assert.deepEqual(loadConfig().allowed, ['NL', 'DE'])
    assert.deepEqual(loadConfig('claude').allowed, ['NL', 'DE'])
    assert.deepEqual(loadConfig('cursor').allowed, ['PL'])
    assert.equal(profilesConfigured(), true)
    assert.equal(hasProfileSection('cursor'), true)
    assert.equal(hasProfileSection('claude'), false)

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

describe('isPristineAliasBody', () => {
  test('matches generated bodies for any name', () => {
    assert.equal(isPristineAliasBody('alias claude="geo-guard claude"'), true)
    assert.equal(isPristineAliasBody('alias cc="geo-guard claude"'), true)
    assert.equal(isPristineAliasBody('function claude { geo-guard claude @args }'), true)
  })

  test('rejects hand-edited body', () => {
    assert.equal(isPristineAliasBody('alias claude="rm -rf /"'), false)
    assert.equal(isPristineAliasBody('alias claude="geo-guard claude"\nexport FOO=1'), false)
    // наш alias, но с флагами пользователя — уже не pristine
    assert.equal(
      isPristineAliasBody('alias claude="geo-guard claude --dangerously-skip-permissions"'),
      false,
    )
  })
})

describe('isGeoGuardAliasBody / parseAliasBody', () => {
  test('recognizes our alias with user flags', () => {
    assert.equal(
      isGeoGuardAliasBody('alias claude="geo-guard claude --dangerously-skip-permissions"'),
      true,
    )
    assert.equal(isGeoGuardAliasBody("alias cc='geo-guard claude --verbose'"), true)
    assert.equal(
      isGeoGuardAliasBody('function claude { geo-guard claude --dangerously-skip-permissions @args }'),
      true,
    )
    // pristine тоже наш
    assert.equal(isGeoGuardAliasBody('alias claude="geo-guard claude"'), true)
  })

  test('rejects foreign bodies', () => {
    assert.equal(isGeoGuardAliasBody('alias claude="rm -rf /"'), false)
    assert.equal(isGeoGuardAliasBody('alias claude="something important"'), false)
    // чужие строки, приклеенные к нашей, не должны проходить как «наше тело»
    assert.equal(
      isGeoGuardAliasBody('alias claude="geo-guard claude"\nexport SECRET=1'),
      false,
    )
    assert.equal(
      isGeoGuardAliasBody('function claude { geo-guard claude @args }\nexport SECRET=1'),
      false,
    )
  })

  test('parses name, command and extra args', () => {
    assert.deepEqual(parseAliasBody('alias claude="geo-guard claude"'), {
      name: 'claude',
      command: 'claude',
      extraArgs: '',
    })
    assert.deepEqual(
      parseAliasBody('alias cc="geo-guard claude --dangerously-skip-permissions"'),
      { name: 'cc', command: 'claude', extraArgs: '--dangerously-skip-permissions' },
    )
    // @args — часть нашего шаблона, не пользовательский флаг
    assert.deepEqual(parseAliasBody('function claude { geo-guard claude @args }'), {
      name: 'claude',
      command: 'claude',
      extraArgs: '',
    })
    assert.deepEqual(
      parseAliasBody('function claude { geo-guard claude --verbose @args }'),
      { name: 'claude', command: 'claude', extraArgs: '--verbose' },
    )
    assert.equal(parseAliasBody('alias claude="rm -rf /"'), null)
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

    installAlias('zsh', { name: 'claude', skipConflictCheck: true })
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

describe('install preserves a customized alias block', () => {
  let tmpDir
  let rcFile
  let prevRc

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-keep-'))
    rcFile = path.join(tmpDir, '.zshrc')
    prevRc = process.env.GEO_GUARD_RC
    process.env.GEO_GUARD_RC = rcFile
  })

  after(() => {
    if (prevRc === undefined) delete process.env.GEO_GUARD_RC
    else process.env.GEO_GUARD_RC = prevRc
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('keeps our alias with user flags byte-for-byte', () => {
    const custom = `export FOO=1\n\n${BEGIN_MARKER}\nalias claude="geo-guard claude --dangerously-skip-permissions"\n${END_MARKER}\n`
    fs.writeFileSync(rcFile, custom)

    const res = installAlias('zsh', { name: 'claude', skipConflictCheck: true })

    assert.equal(res.preserved, 'custom')
    assert.equal(res.name, 'claude')
    assert.match(res.existingBody, /--dangerously-skip-permissions/)
    assert.equal(fs.readFileSync(rcFile, 'utf8'), custom) // файл не тронут вообще
  })

  test('reports the name from the file, not the requested one', () => {
    const custom = `${BEGIN_MARKER}\nalias claude="geo-guard claude --dangerously-skip-permissions"\n${END_MARKER}\n`
    fs.writeFileSync(rcFile, custom)

    const res = installAlias('zsh', { name: 'cc', skipConflictCheck: true })

    assert.equal(res.preserved, 'custom')
    assert.equal(res.name, 'claude')
    assert.equal(fs.readFileSync(rcFile, 'utf8'), custom)
  })

  test('keeps foreign content between our markers', () => {
    const foreign = `${BEGIN_MARKER}\nalias claude="something important"\n${END_MARKER}\n`
    fs.writeFileSync(rcFile, foreign)

    const res = installAlias('zsh', { name: 'claude', skipConflictCheck: true })

    assert.equal(res.preserved, 'foreign')
    assert.equal(fs.readFileSync(rcFile, 'utf8'), foreign)
  })

  test('overwriteCustom rewrites it on explicit request', () => {
    const custom = `${BEGIN_MARKER}\nalias claude="geo-guard claude --dangerously-skip-permissions"\n${END_MARKER}\n`
    fs.writeFileSync(rcFile, custom)

    const res = installAlias('zsh', {
      name: 'claude',
      skipConflictCheck: true,
      overwriteCustom: true,
    })

    assert.equal(res.preserved, null)
    const after = fs.readFileSync(rcFile, 'utf8')
    assert.doesNotMatch(after, /--dangerously-skip-permissions/)
    assert.match(after, /alias claude="geo-guard claude"/)
  })

  test('a pristine block is still regenerated', () => {
    fs.writeFileSync(rcFile, `${BEGIN_MARKER}\nalias claude="geo-guard claude"\n${END_MARKER}\n`)

    const res = installAlias('zsh', { name: 'claude', skipConflictCheck: true })

    assert.equal(res.preserved, null)
    const after = fs.readFileSync(rcFile, 'utf8')
    const begins = after.match(/geo-guard-ai begin/g) ?? []
    assert.equal(begins.length, 1)
  })

  test('uninstall removes our customized block, keeps neighbours', () => {
    fs.writeFileSync(
      rcFile,
      `alias ll="ls -la"\n${BEGIN_MARKER}\nalias claude="geo-guard claude --dangerously-skip-permissions"\n${END_MARKER}\nexport FOO=1\n`,
    )

    const un = uninstallAliasFromFile(rcFile)

    assert.equal(un.changed, true)
    assert.equal(un.modified, false)
    const after = fs.readFileSync(rcFile, 'utf8')
    assert.doesNotMatch(after, /geo-guard/)
    assert.match(after, /alias ll="ls -la"/)
    assert.match(after, /export FOO=1/)
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

describe('resolveRealBin', () => {
  const { resolveRealBin } = require('../dist/resolve-bin')
  let tmpDir
  let prevPath

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-bin-'))
    prevPath = process.env.PATH
    const fakeClaude = path.join(tmpDir, 'claude')
    fs.writeFileSync(fakeClaude, '#!/bin/sh\necho ok\n')
    fs.chmodSync(fakeClaude, 0o755)
    process.env.PATH = `${tmpDir}${path.delimiter}${prevPath || ''}`
  })
  after(() => {
    process.env.PATH = prevPath
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('finds command on PATH', () => {
    const resolved = resolveRealBin('claude')
    assert.equal(resolved, fs.realpathSync(path.join(tmpDir, 'claude')))
  })

  test('GEO_GUARD_REAL_BIN wins', () => {
    const explicit = path.join(tmpDir, 'claude')
    const resolved = resolveRealBin('other', { realBinEnv: explicit })
    assert.equal(resolved, fs.realpathSync(explicit))
  })

  test('skips selfEntry named geo-guard', () => {
    const self = path.join(tmpDir, 'geo-guard')
    fs.writeFileSync(self, '#!/bin/sh\n')
    fs.chmodSync(self, 0o755)
    const resolved = resolveRealBin('claude', { selfEntry: self })
    assert.equal(path.basename(resolved), 'claude')
  })
})

describe('claude-hook install/uninstall', () => {
  const { installClaudeHook, uninstallClaudeHook, isOurHook, settingsPath } = require('../dist/claude-hook')
  let tmpHome
  let prevHome
  let prevUserProfile

  before(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-home-'))
    prevHome = process.env.HOME
    prevUserProfile = process.env.USERPROFILE
    process.env.HOME = tmpHome
    process.env.USERPROFILE = tmpHome
  })
  after(() => {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = prevUserProfile
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  test('install writes our hook; uninstall removes only ours', () => {
    const settingsFile = settingsPath()
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true })
    fs.writeFileSync(
      settingsFile,
      JSON.stringify(
        {
          hooks: {
            UserPromptSubmit: [
              { hooks: [{ type: 'command', command: 'echo foreign-hook' }] },
            ],
          },
        },
        null,
        2,
      ),
    )

    const installed = installClaudeHook()
    assert.equal(installed.command, 'geo-guard check')
    const afterInstall = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
    const commands = afterInstall.hooks.UserPromptSubmit.flatMap(m =>
      (m.hooks || []).map(h => h.command),
    )
    assert.ok(commands.includes('geo-guard check'))
    assert.ok(commands.includes('echo foreign-hook'))
    assert.ok(isOurHook({ command: 'geo-guard check' }))

    const un = uninstallClaudeHook()
    assert.equal(un.changed, true)
    const afterUninstall = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
    const left = afterUninstall.hooks.UserPromptSubmit.flatMap(m =>
      (m.hooks || []).map(h => h.command),
    )
    assert.deepEqual(left, ['echo foreign-hook'])
  })

  test('reinstall keeps the timeout and matcher the user edited', () => {
    const settingsFile = settingsPath()
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true })
    fs.writeFileSync(
      settingsFile,
      JSON.stringify(
        {
          hooks: {
            UserPromptSubmit: [
              {
                matcher: 'my-matcher',
                hooks: [
                  { type: 'command', command: 'geo-guard check', timeout: 30, statusMessage: 'mine' },
                ],
              },
            ],
          },
        },
        null,
        2,
      ),
    )

    const installed = installClaudeHook()
    assert.equal(installed.kept, true)

    const after = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
    const matchers = after.hooks.UserPromptSubmit
    assert.equal(matchers.length, 1)
    assert.equal(matchers[0].matcher, 'my-matcher')
    assert.equal(matchers[0].hooks.length, 1)
    assert.equal(matchers[0].hooks[0].timeout, 30)
    assert.equal(matchers[0].hooks[0].statusMessage, 'mine')
    assert.equal(matchers[0].hooks[0].command, 'geo-guard check')

    uninstallClaudeHook()
  })

  test('reinstall over a pristine entry reports nothing kept and does not duplicate', () => {
    const settingsFile = settingsPath()
    if (fs.existsSync(settingsFile)) fs.unlinkSync(settingsFile)

    assert.equal(installClaudeHook().kept, false)
    assert.equal(installClaudeHook().kept, false)

    const after = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
    const ours = after.hooks.UserPromptSubmit.flatMap(m =>
      (m.hooks || []).filter(h => h.command === 'geo-guard check'),
    )
    assert.equal(ours.length, 1)
    assert.equal(ours[0].timeout, 10)

    uninstallClaudeHook()
  })

  test('legacy geo-check entry is upgraded in place', () => {
    const settingsFile = settingsPath()
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true })
    fs.writeFileSync(
      settingsFile,
      JSON.stringify(
        { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'geo-check' }] }] } },
        null,
        2,
      ),
    )

    installClaudeHook()

    const after = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
    const ours = after.hooks.UserPromptSubmit.flatMap(m => m.hooks || [])
    assert.equal(ours.length, 1)
    assert.equal(ours[0].command, 'geo-guard check')

    uninstallClaudeHook()
  })
})

describe('cursor-hook install/uninstall', () => {
  const {
    installCursorHook,
    uninstallCursorHook,
    cursorHooksPath,
  } = require('../dist/cursor-hook')
  const { hookCommand } = require('../dist/hook-shared')
  let tmpHome
  let prevHome
  let prevUserProfile

  before(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-cursor-home-'))
    prevHome = process.env.HOME
    prevUserProfile = process.env.USERPROFILE
    process.env.HOME = tmpHome
    process.env.USERPROFILE = tmpHome
  })
  after(() => {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = prevUserProfile
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  test('install on a missing file creates version:1 and our entry', () => {
    const file = cursorHooksPath()
    assert.equal(fs.existsSync(file), false)
    const installed = installCursorHook()
    assert.equal(installed.command, hookCommand())
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.equal(data.version, 1)
    assert.ok(data.hooks.beforeSubmitPrompt.some(h => h.command === hookCommand()))
    assert.equal(data.hooks.beforeSubmitPrompt.find(h => h.command === hookCommand()).failClosed, true)

    const un = uninstallCursorHook()
    assert.equal(un.changed, true)
  })

  test('merges with foreign content, preserves version, dedupes on repeat install', () => {
    const file = cursorHooksPath()
    const existingBak = `${file}.bak`
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(
      file,
      JSON.stringify(
        { version: 7, hooks: { sessionStart: [{ command: 'echo hi' }] } },
        null,
        2,
      ),
    )
    // Simulate a pre-existing .bak from another tool: must not be overwritten.
    fs.writeFileSync(existingBak, 'not-ours')

    installCursorHook()
    installCursorHook() // idempotency: second call must not duplicate

    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.equal(data.version, 7)
    assert.ok(data.hooks.sessionStart.some(h => h.command === 'echo hi'))
    const ours = data.hooks.beforeSubmitPrompt.filter(h => h.command === hookCommand())
    assert.equal(ours.length, 1)

    assert.equal(fs.readFileSync(existingBak, 'utf8'), 'not-ours')

    const un = uninstallCursorHook()
    assert.equal(un.changed, true)
    const afterUninstall = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.ok(afterUninstall.hooks.sessionStart.some(h => h.command === 'echo hi'))
    assert.equal(afterUninstall.hooks.beforeSubmitPrompt, undefined)

    fs.unlinkSync(existingBak)
  })

  test('reinstall keeps the failClosed / timeout the user edited', () => {
    const file = cursorHooksPath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          version: 1,
          hooks: {
            beforeSubmitPrompt: [{ command: hookCommand(), timeout: 45, failClosed: false }],
          },
        },
        null,
        2,
      ),
    )

    const installed = installCursorHook()
    assert.equal(installed.kept, true)

    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.equal(data.hooks.beforeSubmitPrompt.length, 1)
    assert.equal(data.hooks.beforeSubmitPrompt[0].timeout, 45)
    assert.equal(data.hooks.beforeSubmitPrompt[0].failClosed, false)
    assert.equal(data.hooks.beforeSubmitPrompt[0].command, hookCommand())

    uninstallCursorHook()
  })

  test('uninstall on a missing file is a no-op, creates nothing', () => {
    const file = cursorHooksPath()
    if (fs.existsSync(file)) fs.unlinkSync(file)
    const un = uninstallCursorHook()
    assert.equal(un.changed, false)
    assert.equal(fs.existsSync(file), false)
  })
})

describe('hook command invariant', () => {
  test('claude-hook and hook-shared use the exact same command string', () => {
    const { hookCommand: fromClaude } = require('../dist/claude-hook')
    const { hookCommand: shared } = require('../dist/hook-shared')
    assert.equal(fromClaude(), shared())
    assert.equal(fromClaude(), 'geo-guard check')
  })

  test('the command carries no profile flag — Cursor dedup depends on it', () => {
    // Cursor импортирует хуки Claude Code и дедуплицирует их по ТОЧНОМУ совпадению
    // строки команды. Если сюда просочится `--profile cursor`, дедуп сломается и в
    // Cursor отработают оба хука, причём импортированный — с чужой политикой.
    // Профиль определяется в рантайме по stdin-payload, см. src/hook-payload.ts.
    const { hookCommand } = require('../dist/hook-shared')
    assert.doesNotMatch(hookCommand(), /--profile/)
  })

  test('both config files get byte-identical commands', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-bytes-'))
    const prevHome = process.env.HOME
    const prevProfile = process.env.USERPROFILE
    process.env.HOME = home
    process.env.USERPROFILE = home
    try {
      const { installClaudeHook, settingsPath } = require('../dist/claude-hook')
      const { installCursorHook, cursorHooksPath } = require('../dist/cursor-hook')
      installClaudeHook()
      installCursorHook()

      const claude = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))
      const cursor = JSON.parse(fs.readFileSync(cursorHooksPath(), 'utf8'))
      const claudeCmd = claude.hooks.UserPromptSubmit[0].hooks[0].command
      const cursorCmd = cursor.hooks.beforeSubmitPrompt[0].command
      assert.equal(claudeCmd, cursorCmd)
    } finally {
      if (prevHome === undefined) delete process.env.HOME
      else process.env.HOME = prevHome
      if (prevProfile === undefined) delete process.env.USERPROFILE
      else process.env.USERPROFILE = prevProfile
      fs.rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('detectCountry', () => {
  const { detectCountry, fetchCountry } = require('../dist/geo')

  test('empty providers => null', async () => {
    assert.equal(await detectCountry({ allowed: ['ES'], timeoutMs: 1000, providers: [] }), null)
  })

  test('fetchCountry rejects non-ISO body', async () => {
    const prevFetch = globalThis.fetch
    globalThis.fetch = async () =>
      ({
        ok: true,
        text: async () => 'SPAIN',
      })
    try {
      assert.equal(await fetchCountry('https://example.test/country', 1000), null)
    } finally {
      globalThis.fetch = prevFetch
    }
  })

  test('detectCountry returns first valid provider answer', async () => {
    const prevFetch = globalThis.fetch
    globalThis.fetch = async url => {
      if (String(url).includes('slow')) {
        await new Promise(r => setTimeout(r, 200))
        return { ok: true, text: async () => 'US' }
      }
      return { ok: true, text: async () => 'es\n' }
    }
    try {
      const country = await detectCountry({
        allowed: ['ES'],
        timeoutMs: 1000,
        providers: ['https://example.test/fast', 'https://example.test/slow'],
      })
      assert.equal(country, 'ES')
    } finally {
      globalThis.fetch = prevFetch
    }
  })
})

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

describe('runCheck stdout contract', () => {
  // Real subprocess, real process.exit — fetch is stubbed via a --require
  // preload fixture so this never touches the network (matches the
  // detectCountry tests' in-process fetch mocking, just out-of-process).
  const cli = path.join(__dirname, '..', 'dist', 'cli.js')
  const mockFetch = path.join(__dirname, 'fixtures', 'mock-fetch.cjs')

  function runCheckSubprocess(allowed) {
    return spawnSync(process.execPath, [cli, 'check'], {
      env: {
        ...process.env,
        NODE_OPTIONS: `--require ${mockFetch}`,
        GEO_GUARD_ALLOWED: allowed,
        GEO_GUARD_PROVIDERS: 'https://example.test/fake',
        GEO_GUARD_LANG: 'en',
      },
      encoding: 'utf8',
    })
  }

  test('on success, non-TTY stdout is exactly {"continue":true}, no trailing newline', () => {
    const r = runCheckSubprocess('RU')
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '{"continue":true}')
  })

  test('on block, stdout is empty and exit code is 2', () => {
    const r = runCheckSubprocess('XX')
    assert.equal(r.status, 2)
    assert.equal(r.stdout, '')
  })
})

describe('hook payload → profile', () => {
  const { profileFromEvent } = require('../dist/hook-payload')

  test('maps the hosts we know, case-insensitively', () => {
    assert.equal(profileFromEvent('UserPromptSubmit'), 'claude')
    assert.equal(profileFromEvent('userpromptsubmit'), 'claude')
    assert.equal(profileFromEvent('beforeSubmitPrompt'), 'cursor')
    assert.equal(profileFromEvent(' beforeSubmitPrompt '), 'cursor')
  })

  test('anything else means "unknown", never a throw', () => {
    assert.equal(profileFromEvent('SessionStart'), null)
    assert.equal(profileFromEvent(''), null)
    assert.equal(profileFromEvent(undefined), null)
    assert.equal(profileFromEvent(null), null)
    assert.equal(profileFromEvent(42), null)
    assert.equal(profileFromEvent({ toString: () => 'UserPromptSubmit' }), null)
  })
})

describe('runCheck profile resolution', () => {
  // Настоящий подпроцесс: stdin-payload читается только в реальном процессе.
  const cli = path.join(__dirname, '..', 'dist', 'cli.js')
  const mockFetch = path.join(__dirname, 'fixtures', 'mock-fetch.cjs') // всегда 'RU'
  let tmpDir

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-checkprofile-'))
  })
  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

  function writeCfg(cfg) {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify(cfg))
  }

  function check(stdin, args = [], extraEnv = {}) {
    return spawnSync(process.execPath, [cli, 'check', ...args], {
      input: stdin,
      env: {
        ...process.env,
        NODE_OPTIONS: `--require ${mockFetch}`,
        GEO_GUARD_CONFIG_DIR: tmpDir,
        GEO_GUARD_CONFIG_FILE: path.join(tmpDir, 'config.json'),
        GEO_GUARD_PROVIDERS: 'https://example.test/fake',
        GEO_GUARD_LANG: 'en',
        GEO_GUARD_ALLOWED: undefined,
        ...extraEnv,
      },
      encoding: 'utf8',
    })
  }

  // Страна всегда RU: shared разрешает только NL, профиль cursor разрешает RU.
  const SPLIT = { allowed: ['NL'], profiles: { cursor: { allowed: ['RU'] } } }

  test('Claude payload uses the claude policy (here: shared) and blocks', () => {
    writeCfg(SPLIT)
    const r = check('{"hook_event_name":"UserPromptSubmit","prompt":"hi"}')
    assert.equal(r.status, 2)
    assert.match(r.stderr, /'claude' policy/)
  })

  test('Cursor payload uses the cursor profile and passes', () => {
    writeCfg(SPLIT)
    const r = check('{"hook_event_name":"beforeSubmitPrompt","prompt":"hi"}')
    assert.equal(r.status, 0)
    // контракт stdout не сломан чтением stdin
    assert.equal(r.stdout, '{"continue":true}')
  })

  test('no payload / garbage payload falls back to the shared policy', () => {
    writeCfg(SPLIT)
    assert.equal(check('').status, 2)
    assert.equal(check('not json at all').status, 2)
    assert.equal(check('[1,2,3]').status, 2)
    // и сообщение без имени профиля — политика общая
    assert.doesNotMatch(check('').stderr, /policy'/)
  })

  test('--profile and GEO_GUARD_PROFILE win over the payload', () => {
    writeCfg(SPLIT)
    assert.equal(check('{"hook_event_name":"UserPromptSubmit"}', ['--profile', 'cursor']).status, 0)
    assert.equal(check('{"hook_event_name":"UserPromptSubmit"}', ['--profile=cursor']).status, 0)
    assert.equal(
      check('{"hook_event_name":"beforeSubmitPrompt"}', [], { GEO_GUARD_PROFILE: 'claude' }).status,
      2,
    )
  })

  test('an unknown profile blocks instead of falling back', () => {
    writeCfg(SPLIT)
    const r = check('', ['--profile', 'vscode'])
    assert.equal(r.status, 2)
    assert.match(r.stderr, /Unknown profile/i)
    assert.equal(check('', [], { GEO_GUARD_PROFILE: 'vscode' }).status, 2)
  })

  test('a config without profiles is unaffected by the payload', () => {
    writeCfg({ allowed: ['RU'] })
    assert.equal(check('{"hook_event_name":"UserPromptSubmit"}').status, 0)
    assert.equal(check('{"hook_event_name":"beforeSubmitPrompt"}').status, 0)
    writeCfg({ allowed: ['NL'] })
    assert.equal(check('{"hook_event_name":"beforeSubmitPrompt"}').status, 2)
  })

  test('profile-specific env alone splits the two tools', () => {
    writeCfg({ allowed: ['NL'] })
    const r = check('{"hook_event_name":"beforeSubmitPrompt"}', [], {
      GEO_GUARD_ALLOWED_CURSOR: 'RU',
    })
    assert.equal(r.status, 0)
    const c = check('{"hook_event_name":"UserPromptSubmit"}', [], {
      GEO_GUARD_ALLOWED_CURSOR: 'RU',
    })
    assert.equal(c.status, 2)
  })
})

describe('geo-guard config command', () => {
  const cli = path.join(__dirname, '..', 'dist', 'cli.js')
  let tmpDir

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-configcmd-'))
  })
  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

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
    assert.match(shown.stdout, /shared\s+allowed: NL, DE/)
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

  test('rejects bad input without writing anything', () => {
    run(['--countries', 'NL'])
    const before = fs.readFileSync(cfgFile(), 'utf8')

    for (const args of [
      ['--countries', 'SPAIN'],
      ['--profile', 'vscode'],
      ['--unset'],
      ['--unset', '--profile', 'cursor', '--countries', 'PL'],
      ['--bogus'],
    ]) {
      const r = run(args)
      assert.notEqual(r.status, 0, `expected failure for ${args.join(' ')}`)
    }

    assert.equal(fs.readFileSync(cfgFile(), 'utf8'), before)
  })
})

describe('readHookPayload resilience', () => {
  // Регрессии на дефекты, найденные тестером: payload выбрасывался по таймауту
  // и при превышении лимита размера.
  const cli = path.join(__dirname, '..', 'dist', 'cli.js')
  const mockFetch = path.join(__dirname, 'fixtures', 'mock-fetch.cjs') // страна всегда RU
  let tmpDir

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-payload-'))
    // claude разрешает RU (пропуск), cursor — DE (блок), общий — NL (блок).
    fs.writeFileSync(
      path.join(tmpDir, 'config.json'),
      JSON.stringify({
        allowed: ['NL'],
        profiles: { claude: { allowed: ['RU'] }, cursor: { allowed: ['DE'] } },
      }),
    )
  })
  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

  /** Запускает check и даёт тесту самому управлять stdin. */
  function check(write) {
    return new Promise(resolve => {
      const child = spawn(process.execPath, [cli, 'check'], {
        env: {
          ...process.env,
          NODE_OPTIONS: `--require ${mockFetch}`,
          GEO_GUARD_CONFIG_DIR: tmpDir,
          GEO_GUARD_CONFIG_FILE: path.join(tmpDir, 'config.json'),
          GEO_GUARD_PROVIDERS: 'https://example.test/fake',
          GEO_GUARD_LANG: 'en',
          GEO_GUARD_ALLOWED: undefined,
          GEO_GUARD_PROFILE: undefined,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let stdout = ''
      child.stdout.on('data', d => (stdout += d))
      write(child.stdin)
      child.on('exit', code => resolve({ code, stdout }))
    })
  }

  test('payload is honored even if the host never closes stdin', async () => {
    const r = await check(stdin => stdin.write('{"hook_event_name":"UserPromptSubmit"}'))
    assert.equal(r.code, 0) // профиль claude разрешает RU
  })

  test('payload split across chunks slower than the old 300ms still counts', async () => {
    const r = await check(stdin => {
      stdin.write('{"hook_event_name":"UserPrompt')
      setTimeout(() => stdin.end('Submit"}'), 400)
    })
    assert.equal(r.code, 0)
  })

  test('a payload past the size cap still yields the profile', async () => {
    const huge = JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      prompt: 'x'.repeat(2 * 1024 * 1024),
    })
    const r = await check(stdin => stdin.end(huge))
    assert.equal(r.code, 0)
  })

  test('an unidentified host falls back to the strictest policy, not the shared one', async () => {
    // NL ∩ RU ∩ DE = ∅ → блок. Раньше молча применялся общий список.
    const r = await check(stdin => stdin.end('{"hook_event_name":"SomeFutureEvent"}'))
    assert.equal(r.code, 2)
    assert.equal(r.stdout, '')
  })

  test('garbage from a host is unidentified too, not "no host"', async () => {
    const r = await check(stdin => stdin.end('not json at all'))
    assert.equal(r.code, 2)
  })

  test('empty stdin means a manual run → shared policy', async () => {
    // Общий список NL, страна RU → блок, но по ОБЩЕЙ политике, без профиля в тексте.
    const r = await check(stdin => stdin.end(''))
    assert.equal(r.code, 2)
  })

  test('an unknown argument blocks instead of being ignored', async () => {
    const r = spawnSync(process.execPath, [cli, 'check', '--porfile', 'cursor'], {
      input: '',
      env: {
        ...process.env,
        NODE_OPTIONS: `--require ${mockFetch}`,
        GEO_GUARD_CONFIG_DIR: tmpDir,
        GEO_GUARD_CONFIG_FILE: path.join(tmpDir, 'config.json'),
        GEO_GUARD_LANG: 'en',
      },
      encoding: 'utf8',
    })
    assert.equal(r.status, 2)
    assert.match(r.stderr, /Unknown check argument/)
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

describe('installAlias with a broken END marker', () => {
  let tmpDir
  let rcFile
  let prevRc

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-broken-'))
    rcFile = path.join(tmpDir, '.zshrc')
    prevRc = process.env.GEO_GUARD_RC
    process.env.GEO_GUARD_RC = rcFile
  })
  after(() => {
    if (prevRc === undefined) delete process.env.GEO_GUARD_RC
    else process.env.GEO_GUARD_RC = prevRc
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('a custom body is preserved even without the END marker', () => {
    // Раньше защита обходилась: в rc оказывались ДВЕ строки alias claude=,
    // и наша дефолтная шла последней — в zsh побеждает она.
    const broken = `${BEGIN_MARKER}\nalias claude="geo-guard claude --my-flag"\nexport WORK=1\n`
    fs.writeFileSync(rcFile, broken)

    const res = installAlias('zsh', { name: 'claude', skipConflictCheck: true })

    assert.equal(res.preserved, 'custom')
    assert.equal(fs.readFileSync(rcFile, 'utf8'), broken)
  })

  test('a pristine body without END is still repaired', () => {
    const broken = `${BEGIN_MARKER}\nalias claude="geo-guard claude"\nexport IMPORTANT=1\n`
    fs.writeFileSync(rcFile, broken)

    const res = installAlias('zsh', { name: 'claude', skipConflictCheck: true })

    assert.equal(res.preserved, null)
    const after = fs.readFileSync(rcFile, 'utf8')
    assert.equal((after.match(/geo-guard-ai begin/g) || []).length, 1)
    assert.equal((after.match(/^alias claude=/gm) || []).length, 1)
    assert.match(after, /export IMPORTANT=1/)
  })

  test('foreign content without END is preserved', () => {
    const broken = `${BEGIN_MARKER}\nexport SECRET=1\n`
    fs.writeFileSync(rcFile, broken)

    const res = installAlias('zsh', { name: 'claude', skipConflictCheck: true })

    assert.equal(res.preserved, 'foreign')
    assert.equal(fs.readFileSync(rcFile, 'utf8'), broken)
  })
})
