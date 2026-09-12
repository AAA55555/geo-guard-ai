'use strict'
/**
 * Property-style coverage for the one piece of this package that edits files
 * belonging to other tools.
 *
 * The example-based tests next door pin behaviour we thought of. These pin the
 * two rules that must hold for *any* input, and they exist because both were
 * broken during development by changes that every example test still passed:
 * once by replacing an unrecognized `hooks` value with an empty array (which
 * deleted foreign matchers), once by skipping a rewrite when the hook count
 * happened to be unchanged (which stopped upgrading the legacy command).
 */

const { describe, test, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { isOurHook, hookCommand } = require('../dist/hook-shared')

let home
let prevHome
let prevUserProfile

before(() => {
  prevHome = process.env.HOME
  prevUserProfile = process.env.USERPROFILE
})
after(() => {
  if (prevHome === undefined) delete process.env.HOME
  else process.env.HOME = prevHome
  if (prevUserProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = prevUserProfile
})
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-invariant-'))
  process.env.HOME = home
  process.env.USERPROFILE = home
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true })
})

/** Every hook entry in a Claude Code settings object, whatever shape it is in. */
function claudeHooks(settings) {
  const matchers = settings?.hooks?.UserPromptSubmit
  if (!Array.isArray(matchers)) return []
  return matchers.flatMap(m => (m && Array.isArray(m.hooks) ? m.hooks : []))
}

function cursorHooks(data) {
  const list = data?.hooks?.beforeSubmitPrompt
  return Array.isArray(list) ? list : []
}

/** Entries that are not ours — the ones we are never allowed to touch. */
const foreignOf = hooks => hooks.filter(h => !isOurHook(h))

const ourEntry = extra => ({ type: 'command', command: hookCommand(), ...extra })

/**
 * Shapes to run every rule against: valid, odd-but-valid, and outright junk.
 * Roots that are not objects are rejected outright and belong to the
 * example tests, so they are not in here.
 */
const CLAUDE_CASES = [
  {},
  { hooks: {} },
  { hooks: { UserPromptSubmit: [] } },
  { hooks: { UserPromptSubmit: [{}] } },
  { hooks: { UserPromptSubmit: [null, 7, 'junk'] } },
  { hooks: { UserPromptSubmit: [{ matcher: 'Bash' }] } },
  { hooks: { UserPromptSubmit: [{ matcher: '*', hooks: 'oops' }] } },
  { hooks: { UserPromptSubmit: [{ hooks: [] }] } },
  { hooks: { UserPromptSubmit: [{ hooks: [{ command: 'foreign.sh' }] }] } },
  { hooks: { UserPromptSubmit: [{ hooks: [null, { command: 42 }] }] } },
  { hooks: { UserPromptSubmit: [{ hooks: [ourEntry()] }] } },
  { hooks: { UserPromptSubmit: [{ hooks: [ourEntry({ timeout: 30 })] }] } },
  { hooks: { UserPromptSubmit: [{ hooks: [{ command: 'geo-check', timeout: 33 }] }] } },
  {
    hooks: {
      UserPromptSubmit: [
        { matcher: 'keepme' },
        { hooks: [{ command: 'foreign.sh' }, ourEntry()] },
        { hooks: [ourEntry({ timeout: 44 })] },
      ],
    },
  },
  {
    tools: { untouched: 1 },
    hooks: {
      UserPromptSubmit: [{ hooks: [ourEntry()] }],
      PreToolUse: [{ hooks: [{ command: 'other.sh' }] }],
    },
  },
]

const CURSOR_CASES = [
  {},
  { version: 7 },
  { hooks: {} },
  { hooks: { beforeSubmitPrompt: [] } },
  { hooks: { beforeSubmitPrompt: [null, 'junk'] } },
  { hooks: { beforeSubmitPrompt: [{ command: 'foreign.sh' }] } },
  { hooks: { beforeSubmitPrompt: [{ command: hookCommand() }] } },
  { hooks: { beforeSubmitPrompt: [{ command: hookCommand(), timeout: 45, failClosed: false }] } },
  { hooks: { beforeSubmitPrompt: [{ command: 'geo-check' }] } },
  {
    version: 3,
    hooks: {
      beforeSubmitPrompt: [{ command: 'foreign.sh' }, { command: hookCommand() }],
      sessionStart: [{ command: 'hi' }],
    },
  },
]

const TOOLS = [
  {
    name: 'claude',
    file: () => path.join(home, '.claude', 'settings.json'),
    cases: CLAUDE_CASES,
    hooksOf: claudeHooks,
    install: () => require('../dist/claude-hook').installClaudeHook(),
    uninstall: () => require('../dist/claude-hook').uninstallClaudeHook(),
  },
  {
    name: 'cursor',
    file: () => path.join(home, '.cursor', 'hooks.json'),
    cases: CURSOR_CASES,
    hooksOf: cursorHooks,
    install: () => require('../dist/cursor-hook').installCursorHook(),
    uninstall: () => require('../dist/cursor-hook').uninstallCursorHook(),
  },
]

for (const tool of TOOLS) {
  describe(`${tool.name} hook invariants`, () => {
    test('uninstall never removes an entry that is not ours', () => {
      for (const [i, input] of tool.cases.entries()) {
        fs.writeFileSync(tool.file(), JSON.stringify(input))
        const before = foreignOf(tool.hooksOf(input))

        tool.uninstall()

        const after = JSON.parse(fs.readFileSync(tool.file(), 'utf8'))
        assert.deepEqual(
          foreignOf(tool.hooksOf(after)),
          before,
          `case ${i}: foreign entries changed by uninstall`,
        )
        assert.equal(
          tool.hooksOf(after).some(isOurHook),
          false,
          `case ${i}: one of ours survived uninstall`,
        )
      }
    })

    test('uninstall leaves a file holding nothing of ours byte-for-byte', () => {
      for (const [i, input] of tool.cases.entries()) {
        if (tool.hooksOf(input).some(isOurHook)) continue
        const raw = JSON.stringify(input)
        fs.writeFileSync(tool.file(), raw)

        const result = tool.uninstall()

        assert.equal(result.changed, false, `case ${i}: reported a change`)
        assert.equal(fs.readFileSync(tool.file(), 'utf8'), raw, `case ${i}: file rewritten`)
        assert.equal(fs.existsSync(`${tool.file()}.bak`), false, `case ${i}: made a .bak`)
      }
    })

    test('install keeps every foreign entry and leaves exactly one of ours', () => {
      for (const [i, input] of tool.cases.entries()) {
        fs.writeFileSync(tool.file(), JSON.stringify(input))
        const before = foreignOf(tool.hooksOf(input))

        tool.install()

        const after = JSON.parse(fs.readFileSync(tool.file(), 'utf8'))
        assert.deepEqual(
          foreignOf(tool.hooksOf(after)),
          before,
          `case ${i}: foreign entries changed by install`,
        )
        const ours = tool.hooksOf(after).filter(isOurHook)
        assert.equal(ours.length, 1, `case ${i}: expected exactly one entry of ours`)
        // The command is the one thing we always own: Cursor dedupes imported
        // Claude Code hooks against its own by matching it byte for byte.
        assert.equal(ours[0].command, hookCommand(), `case ${i}: command not normalized`)
      }
    })

    test('install keeps the settings the user put on any of our entries', () => {
      for (const [i, input] of tool.cases.entries()) {
        const ourInputs = tool.hooksOf(input).filter(isOurHook)
        const custom = ourInputs.find(h => typeof h.timeout === 'number')
        if (!custom) continue

        fs.writeFileSync(tool.file(), JSON.stringify(input))
        tool.install()

        const after = JSON.parse(fs.readFileSync(tool.file(), 'utf8'))
        const ours = tool.hooksOf(after).filter(isOurHook)
        assert.equal(ours[0].timeout, custom.timeout, `case ${i}: custom timeout lost`)
      }
    })

    test('install then uninstall returns the file to what it held of others', () => {
      for (const [i, input] of tool.cases.entries()) {
        fs.writeFileSync(tool.file(), JSON.stringify(input))
        const before = foreignOf(tool.hooksOf(input))

        tool.install()
        tool.uninstall()

        const after = JSON.parse(fs.readFileSync(tool.file(), 'utf8'))
        assert.deepEqual(foreignOf(tool.hooksOf(after)), before, `case ${i}: round trip lost data`)
        assert.equal(tool.hooksOf(after).some(isOurHook), false, `case ${i}: ours left behind`)
      }
    })

    test('installing twice changes nothing the second time', () => {
      for (const [i, input] of tool.cases.entries()) {
        fs.writeFileSync(tool.file(), JSON.stringify(input))

        tool.install()
        const once = fs.readFileSync(tool.file(), 'utf8')
        tool.install()

        assert.equal(fs.readFileSync(tool.file(), 'utf8'), once, `case ${i}: not idempotent`)
      }
    })
  })
}
