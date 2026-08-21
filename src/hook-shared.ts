/**
 * Shared between claude-hook.ts and cursor-hook.ts: the exact command string
 * both configs must carry byte-for-byte (Cursor dedups its own hooks against
 * the Claude Code ones it imports by matching this string), and the matcher
 * that recognizes our own hook entries in either file.
 */

export function hookCommand(): string {
  return 'geo-guard check'
}

export function isOurHook(hook: { command?: string } | null | undefined): boolean {
  if (!hook || typeof hook.command !== 'string') return false
  const cmd = hook.command
  // Anchor on the left (line start / space / slash) so we don't hit foreign commands
  // like 'my-geo-check.sh' or 'echo geo-checkpoint'. The first branch is our current
  // command, the second is the legacy geo-check script from older versions.
  return (
    /(^|[/\\\s])geo-guard(\.cmd)?\s+check(\s|$)/.test(cmd) ||
    /(^|[/\\\s])geo-check(\.[A-Za-z0-9]+)?(\s|$)/.test(cmd)
  )
}
