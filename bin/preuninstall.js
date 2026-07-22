#!/usr/bin/env node
'use strict'

async function main() {
  try {
    const { runPreuninstall } = require('../dist/uninstall')
    await runPreuninstall()
  } catch (err) {
    console.error(`geo-guard-ai preuninstall: ${err instanceof Error ? err.message : err}`)
  }
}

void main()
