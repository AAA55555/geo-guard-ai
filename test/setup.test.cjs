'use strict'

const { test, describe, before, after } = require('node:test')
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
