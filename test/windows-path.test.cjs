'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')

const {
  pathValueContains,
  addToPathValue,
  removeFromPathValue,
  processPathContains,
} = require('../dist/windows-path')

// Чистая часть win32-ветки: как именно правится значение пользовательского PATH.
// Гоняется на любой платформе — реестр и PowerShell тут не участвуют, поэтому
// проверить можно и на macOS. Живая запись покрыта scripts/windows-smoke.ps1.

const SHIM = 'C:\\Users\\anton\\.geo-guard\\bin'

describe('pathValueContains', () => {
  test('регистр и хвостовой слэш не создают «другой» записи', () => {
    assert.equal(pathValueContains('c:\\users\\anton\\.geo-guard\\bin\\', SHIM), true)
    assert.equal(pathValueContains(`C:\\Windows;${SHIM};C:\\Other`, SHIM), true)
    assert.equal(pathValueContains(` ${SHIM} ;C:\\Windows`, SHIM), true)
  })

  test('чужой каталог с тем же префиксом — не наш', () => {
    assert.equal(pathValueContains('C:\\Users\\anton\\.geo-guard\\bin2', SHIM), false)
    assert.equal(pathValueContains('', SHIM), false)
  })

  test('%VAR% не раскрывается: сравниваем ровно то, что записано', () => {
    // Раскрыть значило бы решить за чужой процесс, во что оно раскроется.
    assert.equal(pathValueContains('%USERPROFILE%\\.geo-guard\\bin', SHIM), false)
  })
})

describe('addToPathValue', () => {
  test('добавляет в начало — гейт после настоящего бинаря уже не гейт', () => {
    assert.equal(addToPathValue('C:\\Windows', SHIM), `${SHIM};C:\\Windows`)
  })

  test('идемпотентность: уже есть → null, писать нечего', () => {
    assert.equal(addToPathValue(`C:\\Windows;${SHIM}`, SHIM), null)
    assert.equal(addToPathValue(`c:\\users\\anton\\.geo-guard\\bin\\`, SHIM), null)
  })

  test('пустой PATH → только наш каталог, без лишней точки с запятой', () => {
    assert.equal(addToPathValue('', SHIM), SHIM)
    assert.equal(addToPathValue('   ', SHIM), SHIM)
  })

  test('чужие записи сохраняются дословно, вместе с %VAR%', () => {
    const raw = '%USERPROFILE%\\bin;C:\\Program Files\\Git\\cmd'
    assert.equal(addToPathValue(raw, SHIM), `${SHIM};${raw}`)
  })
})

describe('removeFromPathValue', () => {
  test('убирает только нашу запись', () => {
    assert.equal(removeFromPathValue(`C:\\Windows;${SHIM};C:\\Other`, SHIM), 'C:\\Windows;C:\\Other')
  })

  test('нашей записи нет → null, значение не переписывается', () => {
    assert.equal(removeFromPathValue('C:\\Windows;C:\\Other', SHIM), null)
    assert.equal(removeFromPathValue('', SHIM), null)
  })

  test('регистр и хвостовой слэш тоже снимаются', () => {
    assert.equal(removeFromPathValue(`c:\\USERS\\anton\\.geo-guard\\bin\\;C:\\Windows`, SHIM), 'C:\\Windows')
  })

  test('%VAR% соседей остаётся дословно', () => {
    const raw = `%USERPROFILE%\\bin;${SHIM};%APPDATA%\\npm`
    assert.equal(removeFromPathValue(raw, SHIM), '%USERPROFILE%\\bin;%APPDATA%\\npm')
  })
})

describe('processPathContains', () => {
  test('читает PATH текущего процесса', () => {
    const prev = process.env.PATH
    try {
      process.env.PATH = `C:\\Windows;${SHIM}`
      assert.equal(processPathContains(SHIM), true)
      process.env.PATH = 'C:\\Windows'
      assert.equal(processPathContains(SHIM), false)
    } finally {
      if (prev === undefined) delete process.env.PATH
      else process.env.PATH = prev
    }
  })
})
