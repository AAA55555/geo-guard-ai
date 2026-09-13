'use strict'

const { test, describe, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  SHIM_TARGETS,
  CLAUDE_TARGET,
  CURSOR_AGENT_TARGET,
  shimDir,
  shimPathFor,
  shimBody,
  readShim,
  installShim,
  uninstallShim,
  uninstallShimsEverywhere,
  shimInstalled,
} = require('../dist/shim')
const { resolveRealBin } = require('../dist/resolve-bin')
const { SHIM_MARKER_TAG } = require('../dist/config')

const isWindows = process.platform === 'win32'

/** Тесты гоняем в своём каталоге — в реальный ~/.geo-guard/bin не пишем. */
function withShimDir(name) {
  const state = {}
  before(() => {
    state.tmp = fs.mkdtempSync(path.join(os.tmpdir(), `geo-guard-${name}-`))
    state.dir = path.join(state.tmp, 'bin')
    state.prev = process.env.GEO_GUARD_SHIM_DIR
    process.env.GEO_GUARD_SHIM_DIR = state.dir
  })
  after(() => {
    if (state.prev === undefined) delete process.env.GEO_GUARD_SHIM_DIR
    else process.env.GEO_GUARD_SHIM_DIR = state.prev
    fs.rmSync(state.tmp, { recursive: true, force: true })
  })
  beforeEach(() => {
    fs.rmSync(state.dir, { recursive: true, force: true })
  })
  return state
}

describe('SHIM_TARGETS', () => {
  test('claude и cursor-agent разделены и имеют свои файлы', () => {
    assert.equal(SHIM_TARGETS.length, 2)
    assert.deepEqual(
      SHIM_TARGETS.map(t => t.id),
      ['claude', 'cursor-agent'],
    )
    assert.notEqual(shimPathFor(CLAUDE_TARGET), shimPathFor(CURSOR_AGENT_TARGET))
  })
})

describe('installShim', () => {
  const state = withShimDir('shim')

  test('создаёт исполняемый файл с маркером и exec на geo-guard', () => {
    const res = installShim(CLAUDE_TARGET, { geoGuardBin: '/opt/geo-guard' })

    assert.equal(res.changed, true)
    assert.equal(res.preserved, null)
    assert.equal(res.file, path.join(state.dir, isWindows ? 'claude.cmd' : 'claude'))

    const content = fs.readFileSync(res.file, 'utf8')
    assert.ok(content.split('\n').slice(0, 5).join('\n').includes(SHIM_MARKER_TAG))
    assert.match(content, /\/opt\/geo-guard/)
    assert.match(content, /claude/)

    if (!isWindows) {
      assert.match(content, /^#!\/bin\/sh/)
      assert.match(content, /exec "\$GG" claude "\$@"/)
      assert.equal(fs.statSync(res.file).mode & 0o777, 0o755)
    }
  })

  test('идемпотентен: второй install не переписывает файл', () => {
    const first = installShim(CLAUDE_TARGET, { geoGuardBin: '/opt/geo-guard' })
    const mtime = fs.statSync(first.file).mtimeMs

    const second = installShim(CLAUDE_TARGET, { geoGuardBin: '/opt/geo-guard' })

    assert.equal(second.changed, false)
    assert.equal(second.preserved, null)
    assert.equal(fs.statSync(first.file).mtimeMs, mtime)
  })

  test('extraArgs попадают в тело и читаются обратно', () => {
    const res = installShim(CLAUDE_TARGET, {
      geoGuardBin: '/opt/geo-guard',
      extraArgs: '--dangerously-skip-permissions',
    })

    assert.equal(res.extraArgs, '--dangerously-skip-permissions')
    const shim = readShim(CLAUDE_TARGET)
    assert.equal(shim.kind, 'custom')
    assert.equal(shim.extraArgs, '--dangerously-skip-permissions')
  })

  test('custom не перезаписывается без overwriteCustom, флаги переживают setup', () => {
    installShim(CLAUDE_TARGET, {
      geoGuardBin: '/opt/geo-guard',
      extraArgs: '--dangerously-skip-permissions',
    })
    const before = fs.readFileSync(shimPathFor(CLAUDE_TARGET), 'utf8')

    const res = installShim(CLAUDE_TARGET, { geoGuardBin: '/opt/geo-guard' })

    assert.equal(res.preserved, 'custom')
    assert.equal(res.changed, false)
    assert.equal(res.extraArgs, '--dangerously-skip-permissions')
    assert.equal(fs.readFileSync(res.file, 'utf8'), before)
  })

  test('overwriteCustom возвращает pristine-вид по явной просьбе', () => {
    installShim(CLAUDE_TARGET, { geoGuardBin: '/opt/geo-guard', extraArgs: '--my-flag' })

    const res = installShim(CLAUDE_TARGET, {
      geoGuardBin: '/opt/geo-guard',
      overwriteCustom: true,
    })

    assert.equal(res.preserved, null)
    assert.equal(res.changed, true)
    assert.equal(readShim(CLAUDE_TARGET).kind, 'pristine')
    assert.doesNotMatch(fs.readFileSync(res.file, 'utf8'), /--my-flag/)
  })

  test('чужой файл с тем же именем не трогается', () => {
    fs.mkdirSync(state.dir, { recursive: true })
    const file = shimPathFor(CLAUDE_TARGET)
    fs.writeFileSync(file, '#!/bin/sh\necho real claude\n')

    const res = installShim(CLAUDE_TARGET, { geoGuardBin: '/opt/geo-guard' })

    assert.equal(res.preserved, 'foreign')
    assert.equal(res.changed, false)
    assert.equal(fs.readFileSync(file, 'utf8'), '#!/bin/sh\necho real claude\n')
  })

  test('каждая цель ставится и живёт отдельно', () => {
    installShim(CLAUDE_TARGET, { geoGuardBin: '/opt/geo-guard' })

    assert.equal(shimInstalled(CLAUDE_TARGET), true)
    assert.equal(shimInstalled(CURSOR_AGENT_TARGET), false)

    installShim(CURSOR_AGENT_TARGET, { geoGuardBin: '/opt/geo-guard' })
    assert.match(
      fs.readFileSync(shimPathFor(CURSOR_AGENT_TARGET), 'utf8'),
      /cursor-agent/,
    )
  })
})

describe('uninstallShim', () => {
  const state = withShimDir('shim-uninstall')

  test('удаляет наш файл и пустой каталог', () => {
    installShim(CLAUDE_TARGET, { geoGuardBin: '/opt/geo-guard' })
    installShim(CURSOR_AGENT_TARGET, { geoGuardBin: '/opt/geo-guard' })

    const results = uninstallShimsEverywhere()

    assert.deepEqual(
      results.map(r => r.removed),
      [true, true],
    )
    assert.equal(fs.existsSync(state.dir), false)
  })

  test('чужой файл не удаляется, непустой каталог остаётся', () => {
    installShim(CLAUDE_TARGET, { geoGuardBin: '/opt/geo-guard' })
    const foreign = shimPathFor(CURSOR_AGENT_TARGET)
    fs.writeFileSync(foreign, '#!/bin/sh\necho mine\n')

    const results = uninstallShimsEverywhere()

    const cursor = results.find(r => r.target.id === 'cursor-agent')
    assert.equal(cursor.removed, false)
    assert.equal(cursor.foreign, true)
    assert.equal(fs.readFileSync(foreign, 'utf8'), '#!/bin/sh\necho mine\n')
    assert.equal(fs.existsSync(state.dir), true)
    assert.equal(fs.existsSync(shimPathFor(CLAUDE_TARGET)), false)
  })

  test('удалять нечего — не ошибка', () => {
    const res = uninstallShim(CLAUDE_TARGET)
    assert.equal(res.removed, false)
    assert.equal(res.foreign, false)
  })
})

describe('readShim', () => {
  withShimDir('shim-read')

  test('файла нет → none', () => {
    assert.equal(readShim(CLAUDE_TARGET).kind, 'none')
  })

  test('наш маркер, но тело правили руками → custom (не перезаписываем молча)', () => {
    fs.mkdirSync(shimDir(), { recursive: true })
    const file = shimPathFor(CLAUDE_TARGET)
    // The run line is `exec …` on POSIX and `call …` on Windows — match either,
    // or on Windows nothing is replaced and the body stays pristine.
    const body = shimBody(CLAUDE_TARGET, '/opt/geo-guard').replace(/^(?:exec|call) .*/m, 'echo hi')
    fs.writeFileSync(file, body)

    const shim = readShim(CLAUDE_TARGET)
    assert.equal(shim.kind, 'custom')

    const res = installShim(CLAUDE_TARGET, { geoGuardBin: '/opt/geo-guard' })
    assert.equal(res.preserved, 'custom')
    assert.equal(fs.readFileSync(file, 'utf8'), body)
  })

  test('упоминание geo-guard в середине файла — не наш маркер', () => {
    fs.mkdirSync(shimDir(), { recursive: true })
    const file = shimPathFor(CLAUDE_TARGET)
    fs.writeFileSync(file, `#!/bin/sh\n#\n#\n#\n#\n#\n# ${SHIM_MARKER_TAG}\n`)

    assert.equal(readShim(CLAUDE_TARGET).kind, 'foreign')
  })
})

describe('защита от рекурсии в resolveRealBin', () => {
  let tmp
  let shimsDir
  let realDir
  let prevPath
  let prevShimDir

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-recursion-'))
    shimsDir = path.join(tmp, 'shims')
    realDir = path.join(tmp, 'real')
    fs.mkdirSync(realDir, { recursive: true })

    prevShimDir = process.env.GEO_GUARD_SHIM_DIR
    process.env.GEO_GUARD_SHIM_DIR = shimsDir

    const realClaude = path.join(realDir, 'claude')
    fs.writeFileSync(realClaude, '#!/bin/sh\necho real\n')
    fs.chmodSync(realClaude, 0o755)

    installShim(CLAUDE_TARGET, { geoGuardBin: '/opt/geo-guard' })

    prevPath = process.env.PATH
    // Ровно то, что делает установка: каталог shim ПЕРЕД настоящим бинарём.
    process.env.PATH = [shimsDir, realDir, prevPath || ''].join(path.delimiter)
  })

  after(() => {
    process.env.PATH = prevPath
    if (prevShimDir === undefined) delete process.env.GEO_GUARD_SHIM_DIR
    else process.env.GEO_GUARD_SHIM_DIR = prevShimDir
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  test('находит настоящий claude, а не наш shim', { skip: isWindows }, () => {
    const resolved = resolveRealBin('claude')
    assert.equal(resolved, fs.realpathSync(path.join(realDir, 'claude')))
  })

  test('shim с нашим маркером ВНЕ shimDir тоже пропускается', { skip: isWindows }, () => {
    const strayDir = path.join(tmp, 'stray')
    fs.mkdirSync(strayDir, { recursive: true })
    const stray = path.join(strayDir, 'claude')
    fs.writeFileSync(stray, shimBody(CLAUDE_TARGET, '/opt/geo-guard'))
    fs.chmodSync(stray, 0o755)

    const prev = process.env.PATH
    process.env.PATH = [strayDir, realDir, prev].join(path.delimiter)
    try {
      assert.equal(resolveRealBin('claude'), fs.realpathSync(path.join(realDir, 'claude')))
    } finally {
      process.env.PATH = prev
    }
  })

  test('явный путь на shim — отказ, а не запуск', { skip: isWindows }, () => {
    assert.throws(() => resolveRealBin(shimPathFor(CLAUDE_TARGET)), /geo-guard/)
  })

  test('GEO_GUARD_REAL_BIN на shim — тоже отказ', { skip: isWindows }, () => {
    assert.throws(
      () => resolveRealBin('claude', { realBinEnv: shimPathFor(CLAUDE_TARGET) }),
      /geo-guard/,
    )
  })
})

describe('счётчик глубины', () => {
  const { currentDepth, depthExceeded, envWithNextDepth, DEPTH_ENV } = require('../dist/shim')
  let prev

  before(() => {
    prev = process.env[DEPTH_ENV]
  })
  after(() => {
    if (prev === undefined) delete process.env[DEPTH_ENV]
    else process.env[DEPTH_ENV] = prev
  })

  test('растёт от запуска к запуску и упирается в предел', () => {
    delete process.env[DEPTH_ENV]
    assert.equal(currentDepth(), 0)
    assert.equal(depthExceeded(), false)
    assert.equal(envWithNextDepth()[DEPTH_ENV], '1')

    process.env[DEPTH_ENV] = '1'
    assert.equal(depthExceeded(), false)
    assert.equal(envWithNextDepth()[DEPTH_ENV], '2')

    process.env[DEPTH_ENV] = '2'
    assert.equal(depthExceeded(), true)
  })

  test('мусор в переменной читается как 0, а не как отказ', () => {
    process.env[DEPTH_ENV] = 'nonsense'
    assert.equal(currentDepth(), 0)
    assert.equal(depthExceeded(), false)
  })
})
