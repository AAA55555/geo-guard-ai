#!/usr/bin/env node
'use strict'

try {
  const { msg } = require('../dist/i18n')
  console.log(`\ngeo-guard-ai: ${msg().postinstallHint()}\n`)
} catch {
  console.log('\ngeo-guard-ai: run  geo-guard setup\n')
}
