'use strict'

const { test, describe, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { BEGIN_MARKER, END_MARKER } = require('../dist/config')
const {
  stripMarkedBlock,
  isPristineAliasBody,
  isGeoGuardAliasBody,
  parseAliasBody,
  readAliasBlock,
  uninstallAliasFromFile,
  candidateRcPaths
} = require('../dist/shell-alias')

/**
 * What is left of the alias module: geo-guard does not install aliases any more
 * (the launch gate is a PATH shim), so what has to keep working is recognizing
 * a block we shipped earlier — to read the user's flags out of it and to take
 * it back out — without ever touching a line we did not write.
 */

describe('stripMarkedBlock', () => {
  test('removes marked alias block', () => {
    const input = `before\n${BEGIN_MARKER}\nalias claude="geo-guard claude"\n${END_MARKER}\nafter\n`
    const out = stripMarkedBlock(input)
    assert.match(out, /before/)
    assert.match(out, /after/)
    assert.doesNotMatch(out, /geo-guard claude/)
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

describe('readAliasBlock classifies what setup has to decide about', () => {
  const { CURSOR_AGENT_TARGET, CLAUDE_TARGET } = require('../dist/shell-alias')
  const { CURSOR_BEGIN_MARKER, CURSOR_END_MARKER } = require('../dist/config')

  const block = (begin, body, end) => `${begin}\n${body}\n${end}\n`

  test('pristine, custom and foreign are told apart', () => {
    assert.equal(
      readAliasBlock(block(BEGIN_MARKER, 'alias claude="geo-guard claude"', END_MARKER)).kind,
      'pristine',
    )
    // `custom` is the one that matters most: its flags are what setup carries
    // over into the shim.
    const custom = readAliasBlock(
      block(BEGIN_MARKER, 'alias claude="geo-guard claude --dangerously-skip-permissions"', END_MARKER),
    )
    assert.equal(custom.kind, 'custom')
    assert.equal(parseAliasBody(custom.body).extraArgs, '--dangerously-skip-permissions')

    assert.equal(readAliasBlock(block(BEGIN_MARKER, 'export SECRET=1', END_MARKER)).kind, 'foreign')
  })

  test('a block with no END marker is judged by its first line, and marked broken', () => {
    const broken = readAliasBlock(
      `${BEGIN_MARKER}\nalias claude="geo-guard claude --mine"\nexport WORK=1\n`,
    )

    assert.equal(broken.kind, 'custom')
    assert.equal(broken.broken, true)
  })

  test('each target reads only its own block', () => {
    const both =
      block(BEGIN_MARKER, 'alias claude="geo-guard claude"', END_MARKER) +
      block(CURSOR_BEGIN_MARKER, 'alias cursor-agent="geo-guard cursor-agent"', CURSOR_END_MARKER)

    assert.equal(readAliasBlock(both, CLAUDE_TARGET).kind, 'pristine')
    assert.equal(readAliasBlock(both, CURSOR_AGENT_TARGET).kind, 'pristine')
    // The command inside is part of "this is exactly what we generate".
    const wrong = block(CURSOR_BEGIN_MARKER, 'alias cursor-agent="geo-guard claude"', CURSOR_END_MARKER)
    assert.equal(readAliasBlock(wrong, CURSOR_AGENT_TARGET).kind, 'custom')
  })
})

describe('uninstallAliasFromFile', () => {
  let tmpDir
  let rcFile

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-rc-'))
    rcFile = path.join(tmpDir, '.zshrc')
  })
  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('removes only our block and keeps every other line', () => {
    fs.writeFileSync(
      rcFile,
      `alias c="claude"\n\n${BEGIN_MARKER}\nalias claude="geo-guard claude"\n${END_MARKER}\nalias ll="ls -la"\n`,
    )

    const result = uninstallAliasFromFile(rcFile)

    assert.equal(result.changed, true)
    const after = fs.readFileSync(rcFile, 'utf8')
    assert.match(after, /alias c="claude"/)
    assert.match(after, /alias ll="ls -la"/)
    assert.doesNotMatch(after, /geo-guard-ai begin/)
    assert.doesNotMatch(after, /geo-guard claude/)
  })

  test('removes our block with the user’s own flags in it', () => {
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

  test('keeps a hand-edited block', () => {
    const edited = `${BEGIN_MARKER}\nalias claude="something important"\n${END_MARKER}\n`
    fs.writeFileSync(rcFile, edited)

    const un = uninstallAliasFromFile(rcFile)

    assert.equal(un.changed, false)
    assert.equal(un.modified, true)
    assert.equal(fs.readFileSync(rcFile, 'utf8'), edited)
  })

  test('does NOT eat file content when the END marker is missing', () => {
    const broken = `${BEGIN_MARKER}\nalias claude="geo-guard claude"\nexport IMPORTANT_TOKEN=secret\nsource ~/.work.sh\n`
    fs.writeFileSync(rcFile, broken)

    const un = uninstallAliasFromFile(rcFile)

    assert.equal(un.changed, false)
    assert.equal(un.modified, true)
    assert.equal(fs.readFileSync(rcFile, 'utf8'), broken)
  })

  test('takes the clean block even when the other one was edited by hand', () => {
    const { CURSOR_BEGIN_MARKER, CURSOR_END_MARKER } = require('../dist/config')
    fs.writeFileSync(
      rcFile,
      `${BEGIN_MARKER}\nexport SECRET=1\n${END_MARKER}\n${CURSOR_BEGIN_MARKER}\nalias cursor-agent="geo-guard cursor-agent"\n${CURSOR_END_MARKER}\n`,
    )

    const res = uninstallAliasFromFile(rcFile)

    assert.equal(res.changed, true)
    assert.equal(res.modified, true, 'the foreign block must be reported as left behind')
    const rc = fs.readFileSync(rcFile, 'utf8')
    assert.match(rc, /export SECRET=1/)
    assert.doesNotMatch(rc, /cursor-agent/)
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
