'use strict'

const { test, describe, before, after, beforeEach, afterEach } = require('node:test')
const { spawnSync } = require('node:child_process')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { isOurHook } = require('../dist/claude-hook')

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

describe('malformed hook files', () => {
  const cli = path.join(__dirname, '..', 'dist', 'cli.js')
  let home
  let cfgDir

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-malformed-'))
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-malformed-cfg-'))
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
  })
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(cfgDir, { recursive: true, force: true })
  })

  function setup(extra = []) {
    return spawnSync(
      process.execPath,
      [cli, 'setup', '--yes', '--countries', 'RU', '--no-shim', '--no-cursor', ...extra],
      {
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
        },
        encoding: 'utf8',
      },
    )
  }

  const writeSettings = raw => fs.writeFileSync(path.join(home, '.claude', 'settings.json'), raw)
  const configWritten = () => fs.existsSync(path.join(cfgDir, 'config.json'))

  test('a hook section of the wrong shape is refused before anything is written', () => {
    writeSettings('{"hooks":{"UserPromptSubmit":"oops"}}')

    const r = setup()

    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /not the shape/i)
    assert.doesNotMatch(r.stderr, /TypeError|is not a function/)
    // главное: setup не оставил машину с конфигом, но без хука
    assert.equal(configWritten(), false)
  })

  test('hooks itself not being an object is refused too', () => {
    writeSettings('{"hooks":42}')

    const r = setup()

    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /not the shape/i)
    assert.equal(configWritten(), false)
  })

  test('invalid JSON is still refused before writing', () => {
    writeSettings('{ oops')

    const r = setup()

    assert.notEqual(r.status, 0)
    assert.equal(configWritten(), false)
  })

  test('garbage entries inside a valid array are stepped over, not crashed on', () => {
    writeSettings('{"hooks":{"UserPromptSubmit":[null]}}')

    const r = setup()

    assert.equal(r.status, 0)
    const after = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'))
    // чужой мусор на месте, наша запись добавлена рядом
    assert.equal(after.hooks.UserPromptSubmit[0], null)
    const ours = after.hooks.UserPromptSubmit.filter(
      m => m && (m.hooks || []).some(h => h.command === 'geo-guard check'),
    )
    assert.equal(ours.length, 1)
  })

  test('uninstall survives the same garbage and leaves it alone', () => {
    writeSettings('{"hooks":{"UserPromptSubmit":[null]}}')
    assert.equal(setup().status, 0)

    const r = spawnSync(process.execPath, [cli, 'uninstall', '--keep-config'], {
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        GEO_GUARD_RC: path.join(home, '.zshrc'),
        GEO_GUARD_CONFIG_DIR: cfgDir,
        GEO_GUARD_CONFIG_FILE: path.join(cfgDir, 'config.json'),
        GEO_GUARD_LANG: 'en',
      },
      encoding: 'utf8',
    })

    assert.equal(r.status, 0)
    const after = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'))
    assert.deepEqual(after.hooks.UserPromptSubmit, [null])
  })

  test('a root that is not an object is refused, in both hook files', () => {
    // Раньше проверялся только .hooks: у массива/числа его нет, assert пропускал,
    // а JSON.stringify массива терял добавленное — setup рапортовал об успехе,
    // хука при этом не было вовсе.
    for (const raw of ['[1,2]', '42', '"hi"', 'null']) {
      writeSettings(raw)

      const r = setup()

      assert.notEqual(r.status, 0, `expected failure for ${raw}`)
      assert.match(r.stderr, /does not hold a JSON object/i)
      assert.doesNotMatch(r.stderr, /TypeError|Cannot create property|Cannot read properties/)
      assert.equal(configWritten(), false)
      assert.equal(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'), raw)
    }
  })

  test('a cursor hooks.json with a non-object root is refused as well', () => {
    fs.mkdirSync(path.join(home, '.cursor'), { recursive: true })
    const file = path.join(home, '.cursor', 'hooks.json')
    fs.writeFileSync(file, '[1,2]')

    const r = setup(['--cursor'])

    assert.notEqual(r.status, 0)
    assert.equal(fs.readFileSync(file, 'utf8'), '[1,2]')
    assert.equal(configWritten(), false)
  })

  test('uninstall leaves matchers it does not recognize, and ones holding nothing of ours', () => {
    writeSettings(
      JSON.stringify({
        tools: { keepme: 1 },
        hooks: {
          UserPromptSubmit: [
            { matcher: '*', hooks: 'oops' },
            { matcher: 'keepme' },
            { hooks: [{ type: 'command', command: 'geo-guard check' }] },
          ],
        },
      }),
    )

    const r = spawnSync(process.execPath, [cli, 'uninstall', '--keep-config'], {
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        GEO_GUARD_RC: path.join(home, '.zshrc'),
        GEO_GUARD_CONFIG_DIR: cfgDir,
        GEO_GUARD_CONFIG_FILE: path.join(cfgDir, 'config.json'),
        GEO_GUARD_LANG: 'en',
      },
      encoding: 'utf8',
    })

    assert.equal(r.status, 0)
    const after = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'))
    // наша запись снята, обе чужие на месте, посторонняя секция цела
    assert.deepEqual(after.tools, { keepme: 1 })
    assert.deepEqual(after.hooks.UserPromptSubmit, [
      { matcher: '*', hooks: 'oops' },
      { matcher: 'keepme' },
    ])
  })

  test('install does not drop a foreign matcher that has no hooks key', () => {
    writeSettings(JSON.stringify({ hooks: { UserPromptSubmit: [{ matcher: 'Bash' }] } }))

    assert.equal(setup().status, 0)

    const after = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'))
    assert.ok(after.hooks.UserPromptSubmit.some(m => m.matcher === 'Bash'))
  })

  test('an empty hook list we never put anything into is left alone', () => {
    // Пустой UserPromptSubmit создали не мы — удалять его (и делать .bak)
    // означало бы править файл, из которого мы ничего не вынимали.
    const settingsFile = path.join(home, '.claude', 'settings.json')
    const cursorFile = path.join(home, '.cursor', 'hooks.json')
    fs.mkdirSync(path.join(home, '.cursor'), { recursive: true })
    const claudeRaw = '{"other":1,"hooks":{"UserPromptSubmit":[]}}'
    const cursorRaw = '{"version":1,"hooks":{"beforeSubmitPrompt":[]}}'
    fs.writeFileSync(settingsFile, claudeRaw)
    fs.writeFileSync(cursorFile, cursorRaw)

    const r = spawnSync(process.execPath, [cli, 'uninstall', '--keep-config'], {
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        GEO_GUARD_RC: path.join(home, '.zshrc'),
        GEO_GUARD_CONFIG_DIR: cfgDir,
        GEO_GUARD_CONFIG_FILE: path.join(cfgDir, 'config.json'),
        GEO_GUARD_LANG: 'en',
      },
      encoding: 'utf8',
    })

    assert.equal(r.status, 0)
    assert.equal(fs.readFileSync(settingsFile, 'utf8'), claudeRaw)
    assert.equal(fs.readFileSync(cursorFile, 'utf8'), cursorRaw)
    assert.equal(fs.existsSync(`${settingsFile}.bak`), false)
    assert.equal(fs.existsSync(`${cursorFile}.bak`), false)
  })

  test('a malformed cursor hooks.json is refused before writing too', () => {
    fs.mkdirSync(path.join(home, '.cursor'), { recursive: true })
    fs.writeFileSync(
      path.join(home, '.cursor', 'hooks.json'),
      '{"hooks":{"beforeSubmitPrompt":"oops"}}',
    )

    const r = spawnSync(
      process.execPath,
      [cli, 'setup', '--yes', '--countries', 'RU', '--no-shim', '--cursor'],
      {
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
        },
        encoding: 'utf8',
      },
    )

    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /not the shape/i)
    assert.equal(configWritten(), false)
    // и хук Claude Code тоже не поставлен — упали до первой записи
    assert.equal(fs.existsSync(path.join(home, '.claude', 'settings.json')), false)
  })
})
