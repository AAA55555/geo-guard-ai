'use strict'
// Preloaded via NODE_OPTIONS=--require in tests that spawn the real CLI as a
// subprocess: stubs out global fetch so runCheck's stdout contract can be
// tested end-to-end (real process, real process.exit) without hitting the
// network at all.
globalThis.fetch = async () => ({ ok: true, text: async () => 'RU' })
