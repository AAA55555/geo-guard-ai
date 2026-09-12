'use strict'

const { test, describe, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { BEGIN_MARKER, END_MARKER } = require('../dist/config')
const {
  stripMarkedBlock,
  findConflictingAlias,
  isPristineAliasBody,
  isGeoGuardAliasBody,
  parseAliasBody,
  installAlias,
  uninstallAliasFromFile,
  candidateRcPaths
} = require('../dist/shell-alias')

describe('stripMarkedBlock', () => {
  test('removes marked alias block', () => {
    const input = `before\n${BEGIN_MARKER}\nalias claude="geo-guard claude"\n${END_MARKER}\nafter\n`
    const out = stripMarkedBlock(input)
    assert.match(out, /before/)
    assert.match(out, /after/)
    assert.doesNotMatch(out, /geo-guard claude/)
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

describe('--force-alias does not extend to foreign content', () => {
  let tmpDir
  let rcFile
  let prevRc

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-force-'))
    rcFile = path.join(tmpDir, '.zshrc')
    prevRc = process.env.GEO_GUARD_RC
    process.env.GEO_GUARD_RC = rcFile
  })
  after(() => {
    if (prevRc === undefined) delete process.env.GEO_GUARD_RC
    else process.env.GEO_GUARD_RC = prevRc
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('overwrites our own edited alias', () => {
    fs.writeFileSync(
      rcFile,
      `${BEGIN_MARKER}\nalias claude="geo-guard claude --mine"\n${END_MARKER}\n`,
    )

    const res = installAlias('zsh', {
      name: 'claude',
      skipConflictCheck: true,
      overwriteCustom: true,
    })

    assert.equal(res.preserved, null)
    assert.match(fs.readFileSync(rcFile, 'utf8'), /alias claude="geo-guard claude"/)
  })

  test('still refuses to delete content that is not ours', () => {
    // There is no backup of an rc file, and "overwrite the alias I edited" is
    // not consent to delete whatever else lives between those markers.
    const foreign = `${BEGIN_MARKER}\nexport MY_IMPORTANT=1\n${END_MARKER}\n`
    fs.writeFileSync(rcFile, foreign)

    const res = installAlias('zsh', {
      name: 'claude',
      skipConflictCheck: true,
      overwriteCustom: true,
    })

    assert.equal(res.preserved, 'foreign')
    assert.equal(fs.readFileSync(rcFile, 'utf8'), foreign)
  })
})
