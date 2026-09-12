'use strict'

const { test, describe, before, after } = require('node:test')
const assert = require('node:assert/strict')

const { DEFAULT_CONFIG } = require('../dist/config')
const { isAllowed } = require('../dist/geo')
const { detectLang, msg } = require('../dist/i18n')

describe('isAllowed', () => {
  test('checks membership', () => {
    const config = { ...DEFAULT_CONFIG, allowed: ['ES', 'PT'] }
    assert.equal(isAllowed('ES', config), true)
    assert.equal(isAllowed('RU', config), false)
    assert.equal(isAllowed(null, config), false)
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

describe('help text parity between locales', () => {
  const { SUPPORTED_LANGS } = require('../dist/i18n')

  /**
   * Флаги, упомянутые в тексте помощи. Дефис обязан начинать слово, иначе
   * в улов попадает хвост дефисных слов вроде 'geo-restriction'.
   */
  function mentioned(text) {
    const found = text.matchAll(/(?:^|\s)(--?[A-Za-z][\w-]*)/g)
    return new Set([...found].map(m => m[1]))
  }

  test('both catalogs document the same flags', () => {
    // Два текста help() поддерживаются вручную параллельно: добавив опцию в один,
    // легко забыть второй, и компилятор такого не ловит — тип Messages следит
    // только за наличием ключа, не за содержимым строки.
    const prev = process.env.GEO_GUARD_LANG
    const help = {}
    try {
      for (const lang of SUPPORTED_LANGS) {
        process.env.GEO_GUARD_LANG = lang
        help[lang] = mentioned(msg().help())
      }
    } finally {
      if (prev === undefined) delete process.env.GEO_GUARD_LANG
      else process.env.GEO_GUARD_LANG = prev
    }

    const [first, ...rest] = SUPPORTED_LANGS
    for (const lang of rest) {
      const onlyInFirst = [...help[first]].filter(f => !help[lang].has(f))
      const onlyInOther = [...help[lang]].filter(f => !help[first].has(f))
      assert.deepEqual(onlyInFirst, [], `есть в ${first}, нет в ${lang}`)
      assert.deepEqual(onlyInOther, [], `есть в ${lang}, нет в ${first}`)
    }
  })
})
