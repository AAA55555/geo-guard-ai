'use strict'

const { test, describe, before, after } = require('node:test')
const { spawn, spawnSync } = require('node:child_process')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')


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

describe('unknown top-level option', () => {
  const cli = path.join(__dirname, '..', 'dist', 'cli.js')

  test('a leading dash is an option, not a binary to run', () => {
    const r = spawnSync(process.execPath, [cli, '--porfile'], {
      env: { ...process.env, GEO_GUARD_LANG: 'en' },
      encoding: 'utf8',
    })
    assert.equal(r.status, 1)
    assert.match(r.stderr, /Unknown option/)
    // не должен уйти искать бинарь с таким именем
    assert.doesNotMatch(r.stderr + r.stdout, /not found in PATH/)
  })
})

describe('profileForCommand', () => {
  const { profileForCommand } = require('../dist/run')

  test('maps the wrapped binary to its tool', () => {
    assert.equal(profileForCommand('claude'), 'claude')
    assert.equal(profileForCommand('cursor'), 'cursor')
    assert.equal(profileForCommand('cursor-agent'), 'cursor')
  })

  test('looks at the binary name, not the path or the extension', () => {
    // Разделитель путей разбирает path.basename, то есть по правилам текущей
    // платформы — виндовый путь с обратными слешами проверять здесь нечем.
    assert.equal(profileForCommand('/usr/local/bin/claude'), 'claude')
    assert.equal(profileForCommand('claude.cmd'), 'claude')
    assert.equal(profileForCommand('claude.exe'), 'claude')
    assert.equal(profileForCommand('claude.bat'), 'claude')
    assert.equal(profileForCommand('claude.ps1'), 'claude')
    assert.equal(profileForCommand('CLAUDE'), 'claude')
    // то же самое должно работать и для второго инструмента, не только claude
    assert.equal(profileForCommand(path.join('/opt/bin', 'cursor-agent')), 'cursor')
    assert.equal(profileForCommand('Cursor-Agent.cmd'), 'cursor')
  })

  test('anything else wraps under the shared policy', () => {
    // Не 'claude-code' и не 'myclaude': имя должно совпадать целиком, иначе
    // чужой бинарь молча поехал бы по политике Claude Code.
    assert.equal(profileForCommand('claude-code'), undefined)
    assert.equal(profileForCommand('myclaude'), undefined)
    assert.equal(profileForCommand('echo'), undefined)
    assert.equal(profileForCommand(''), undefined)
  })

  test('the wrapper actually applies the profile it picks', () => {
    // Сам по себе маппинг ничего не значит, если runWrap его не использует:
    // подмена профиля на уровне обёртки прошла бы молча мимо юнит-тестов выше.
    const cli = path.join(__dirname, '..', 'dist', 'cli.js')
    const mockFetch = path.join(__dirname, 'fixtures', 'mock-fetch.cjs') // страна RU
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-wrap-'))
    try {
      // общий уровень RU разрешает, профиль claude — нет
      fs.writeFileSync(
        path.join(tmp, 'config.json'),
        JSON.stringify({ allowed: ['RU'], profiles: { claude: { allowed: ['NL'] } } }),
      )

      const run = command =>
        spawnSync(process.execPath, [cli, command, '--version'], {
          env: {
            ...process.env,
            NODE_OPTIONS: `--require ${mockFetch}`,
            GEO_GUARD_CONFIG_DIR: tmp,
            GEO_GUARD_CONFIG_FILE: path.join(tmp, 'config.json'),
            GEO_GUARD_PROVIDERS: 'https://example.test/fake',
            // node сам себе подопытный: есть на любой платформе, в отличие
            // от /bin/echo, и на `--version` печатает версию и выходит нулём.
            GEO_GUARD_REAL_BIN: process.execPath,
            GEO_GUARD_LANG: 'en',
            GEO_GUARD_ALLOWED: undefined,
          },
          encoding: 'utf8',
        })

      // `geo-guard claude …` идёт по профилю claude → блок
      const claude = run('claude')
      assert.notEqual(claude.status, 0)
      assert.match(claude.stderr, /'claude' policy/)

      // любая другая команда — по общему списку, который RU разрешает
      const other = run('somethingelse')
      assert.equal(other.status, 0)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
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

describe('quoteForCmd', () => {
  const { quoteForCmd } = require('../dist/run')

  // Нужен только на Windows, но проверяется везде: без него `geo-guard claude`
  // там не запускается вовсе — начиная с 18.20.2 / 20.12.2 spawn отказывается
  // выполнять .cmd без шелла (CVE-2024-27980), а npm ставит глобальные CLI
  // именно как .cmd-шимы.
  test('leaves ordinary arguments alone', () => {
    assert.equal(quoteForCmd('--version'), '--version')
    assert.equal(quoteForCmd('plain'), 'plain')
    assert.equal(quoteForCmd('--dangerously-skip-permissions'), '--dangerously-skip-permissions')
  })

  test('quotes what cmd would otherwise split or swallow', () => {
    assert.equal(quoteForCmd('a b'), '"a b"')
    assert.equal(quoteForCmd('C:\\Program Files\\x\\claude.cmd'), '"C:\\Program Files\\x\\claude.cmd"')
    // cmd ждёт удвоенную кавычку внутри кавычек, а не обратный слеш
    assert.equal(quoteForCmd('say "hi"'), '"say ""hi"""')
    // пустой аргумент обязан дожить до программы, а не исчезнуть
    assert.equal(quoteForCmd(''), '""')
  })
})
