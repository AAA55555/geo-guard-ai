/**
 * Tiny i18n layer for all user-facing CLI output.
 *
 * Language is detected from the machine locale (see `detectLang`). English is
 * the default and the fallback for any unsupported locale. To add a language,
 * implement the `Messages` shape for it and register it in `CATALOG` — the
 * compiler then enforces that every key is translated.
 */

export const SUPPORTED_LANGS = ['en', 'ru'] as const
export type Lang = (typeof SUPPORTED_LANGS)[number]
export const DEFAULT_LANG: Lang = 'en'

/**
 * Every user-facing string, as a function so parametrized and plain messages
 * share one uniform shape. Both catalogs must implement all keys.
 */
export type Messages = {
  // --- help ---
  help: () => string

  // --- setup: arg parsing / validation ---
  unknownSetupArg: (arg: string) => string
  retiredAliasFlag: (arg: string, replacement: string) => string
  retiredAliasNameFlag: (arg: string) => string
  invalidShimArgs: (value: string) => string
  promptInputEnded: () => string
  unsupportedShellWithList: (shell: string, list: string) => string
  unsupportedShell: (shell: string) => string
  emptyCountryList: () => string
  invalidCountryCodes: (codes: string) => string
  postinstallHint: () => string
  unknownProfile: (name: string, list: string) => string
  unknownCheckArg: (arg: string) => string
  unknownOption: (arg: string) => string
  optionNeedsValue: (name: string) => string

  // --- config command ---
  unknownConfigArg: (arg: string) => string
  configUnsetNeedsProfile: (list: string) => string
  configUnsetWithCountries: () => string
  configResetWithCountries: () => string
  configResetDone: (file: string) => string
  configProfileUnset: (profile: string) => string
  configProfileNotSet: (profile: string) => string
  configLineShared: (allowed: string, timeoutSeconds: number, source: string) => string
  configLineProfile: (profile: string, allowed: string, source: string) => string
  configSourceProfile: () => string
  configSourceInherited: () => string
  configSourceEnv: (name: string) => string
  configSourceFile: () => string
  configSourceDefaults: () => string
  allowedProfileLine: (profile: string, list: string) => string

  // --- setup: prompts ---
  promptCountries: () => string
  promptInstallHook: () => string
  promptInstallCursorHook: () => string
  promptInstallShim: (command: string) => string
  promptInstallCursorShim: (command: string) => string
  promptShimArgs: (command: string) => string
  promptShells: (list: string) => string
  promptCursorSeparateCountries: () => string
  promptCursorCountries: () => string

  // --- setup: output ---
  configWritten: (file: string) => string
  allowedLine: (list: string) => string
  hookInstalled: (file: string) => string
  hookCommandLine: (command: string) => string
  hookSkipped: () => string
  cursorHookInstalled: (file: string) => string
  cursorHookSkipped: () => string
  hookCustomKept: () => string
  aliasBlockReplaced: (file: string) => string
  reloadRc: (file: string) => string
  reloadRcPowershell: (file: string) => string
  setupDone: () => string
  configPathLine: (path: string) => string

  // --- setup: PATH shims ---
  shimInstalled: (file: string) => string
  shimUpToDate: (file: string) => string
  shimKeptCustom: (file: string) => string
  shimKeptForeign: (file: string) => string
  shimForceHint: () => string
  shimFlagsKept: (flags: string) => string
  shimFlagsSet: (flags: string) => string
  shimSkipped: () => string
  shimSkippedMissing: (command: string) => string
  pathEntryInstalled: (file: string) => string
  pathEntryAlreadyPresent: (file: string) => string
  pathEntryKeptForeign: (file: string) => string
  pathEntryLoginFile: (file: string) => string
  userPathInstalled: (dir: string) => string
  userPathAlreadyPresent: (dir: string) => string
  userPathUnavailable: (dir: string, reason: string) => string
  reloadForPath: (dir: string) => string

  // --- status command ---
  unknownStatusArg: (arg: string) => string
  statusConfigPresent: () => string
  statusConfigMissing: () => string
  statusClaudeHookHeader: (file: string) => string
  statusCursorHookHeader: (file: string) => string
  statusHookInstalled: () => string
  statusHookMissing: () => string
  statusHookFileMissing: () => string
  statusHookNotNeeded: () => string
  statusAliasLeftoverHeader: () => string
  statusAliasLeftover: (file: string) => string
  statusAliasLeftoverBroken: (file: string) => string
  statusShimHeader: (dir: string) => string
  statusShimPristine: (command: string) => string
  statusShimCustom: (command: string, flags: string) => string
  statusShimForeign: (file: string) => string
  statusShimMissing: (command: string) => string
  statusShimNotNeeded: (command: string) => string
  statusShimNotFirst: (found: string) => string
  statusShimNotOnPath: (dir: string) => string
  statusShimNoRealBin: (command: string, message: string) => string
  statusPathHeader: (file: string) => string
  statusPathPresent: (dir: string) => string
  statusPathMissing: (dir: string) => string
  statusPathForeign: () => string
  statusPathFileMissing: () => string
  statusPathAlsoIn: (files: string) => string
  statusUserPathHeader: () => string
  statusUserPathPresent: (dir: string) => string
  statusUserPathMissing: (dir: string) => string
  statusUserPathUnknown: (reason: string) => string
  statusProcessPathPresent: (dir: string) => string
  statusProcessPathMissing: (dir: string) => string
  statusCountryHeader: () => string
  statusCountryAllowed: (country: string, allowed: string) => string
  statusCountryNotAllowed: (country: string, allowed: string) => string
  statusCountryUnknown: () => string
  statusProblem: (message: string) => string
  statusOk: () => string
  statusNotOk: () => string
  statusSetupHint: () => string

  // --- check / wrap (run.ts) ---
  checkNoCountryBlocked: () => string
  checkCountryNotAllowedBlocked: (country: string, allowed: string, profile?: string) => string
  checkErrorBlocked: (message: string) => string
  wrapNoCommand: () => string
  wrapSetupHint: () => string
  wrapError: (message: string) => string
  wrapNoCountryBlocked: () => string
  wrapCountryNotAllowedBlocked: (country: string, allowed: string, profile?: string) => string
  wrapGeoCheckOk: (country: string) => string
  wrapSpawnFailed: (bin: string, message: string) => string
  wrapRecursionGuard: (envVar: string) => string

  // --- uninstall ---
  unknownUninstallArg: (arg: string) => string
  hookRemoved: (file: string) => string
  hookNotFound: () => string
  cursorHookNotFound: () => string
  aliasRemoved: (file: string) => string
  shimRemoved: (file: string) => string
  shimsNotFound: () => string
  shimKeptOnUninstall: (file: string) => string
  pathEntryRemoved: (file: string) => string
  pathEntriesNotFound: () => string
  userPathRemoved: (dir: string) => string
  userPathNotFound: () => string
  userPathRemoveFailed: (dir: string, reason: string) => string
  pathEntryManuallyEdited: (file: string) => string
  aliasBlocksNotFound: () => string
  aliasBlockManuallyEdited: (file: string) => string
  configKept: (path: string) => string
  removed: (item: string) => string
  configNotFound: () => string
  uninstallDone: () => string
  preuninstallError: (message: string) => string

  // --- errors: config / hook / bin resolution ---
  invalidConfig: (file: string, message: string) => string
  invalidJson: (file: string, message: string) => string
  invalidHookShape: (file: string, key: string) => string
  invalidHookRoot: (file: string) => string
  notAnObject: () => string
  rcNotWritable: (file: string) => string
  notACommand: (word: string, list: string) => string
  realBinNotFound: (path: string) => string
  binNotFound: (command: string) => string
  targetIsSelf: (command: string) => string
  binNotFoundInPath: (command: string) => string
}

const en: Messages = {
  help: () => `geo-guard-ai — geo-restriction for AI CLIs

Usage:
  geo-guard setup [options]     interactive setup
  geo-guard uninstall [--keep-config]  remove our traces (hook, launch gate, config)
  geo-guard config [options]    show / change the allowed countries
  geo-guard check               hook check (exit 0/2)
  geo-guard status              what is installed and working (exit 0/1)
  geo-guard version             print the version
  geo-guard <command> [args…]   check geo and run the command
  geo-guard -- <command> […]    same, for a name that looks like a subcommand

setup options:
  -y, --yes                 no questions (defaults)
  -c, --countries ES,PT     allowed countries
  --shells zsh,bash|all     whose rc files get the PATH entry (default: your shell)
  --shell zsh               one shell, same as --shells zsh
  --hook / --no-hook
  --cursor / --no-cursor    install the Cursor hook (~/.cursor/hooks.json)
  --shim / --no-shim        gate 'claude' at launch (PATH shim)
  --cursor-shim / --no-cursor-shim
                            gate 'cursor-agent' at launch
                            (default: on when cursor-agent is on PATH)
  --force-shim              regenerate a shim of ours whose body you edited
  --claude-args "--flag"    flags the gate passes to claude on every launch
  --cursor-args "--flag"    same for cursor-agent (empty value clears them)
  --claude-countries ES,PT  countries for Claude Code only
  --cursor-countries PL     countries for Cursor only

config options:
  (no options)              show the effective config
  -c, --countries ES,PT     set the countries
  -p, --profile claude|cursor   apply to that tool only
  --unset --profile cursor  drop the profile, back to the shared list
  --reset                   back to the defaults, drops every profile
  --reset --profile cursor  same as --unset --profile cursor

uninstall options:
  --keep-config             don't delete config.json
  -q, --quiet               fewer logs (for npm preuninstall)

Examples:
  npm install -g geo-guard-ai
  geo-guard setup
  geo-guard setup --countries ES,PT --yes
  geo-guard config --countries PL --profile cursor
  geo-guard claude --version
`,

  unknownSetupArg: arg => `Unknown setup argument: ${arg}`,
  retiredAliasFlag: (arg, replacement) =>
    `${arg} is gone: the launch gate is a PATH shim now, not a shell alias (an alias never applied to scripts, to \\claude, or to a shell whose rc we had not written). Use ${replacement} instead.`,
  retiredAliasNameFlag: arg =>
    `${arg} is gone: the launch gate is a file named after the command in ~/.geo-guard/bin, so it has no name of its own. Drop the flag, or skip the gate with --no-shim.`,
  invalidShimArgs: value =>
    `Flags for the launch gate cannot contain control characters or line breaks: '${value}'`,
  promptInputEnded: () =>
    'Input ended before every question was answered — nothing was installed. For an unattended run use: geo-guard setup --yes',
  unsupportedShellWithList: (shell, list) => `Unsupported shell: ${shell}. Available: ${list}`,
  unsupportedShell: shell => `Unsupported shell: ${shell}`,
  emptyCountryList: () => 'Country list is empty',
  invalidCountryCodes: codes =>
    `Invalid country code(s): ${codes}. Use ISO 3166-1 alpha-2 (e.g. ES, PT)`,
  postinstallHint: () => 'run  geo-guard setup',
  unknownProfile: (name, list) => `Unknown profile: '${name}'. Available: ${list}`,
  unknownCheckArg: arg => `Unknown check argument: ${arg}`,
  unknownOption: arg => `Unknown option: ${arg}. See geo-guard --help`,
  optionNeedsValue: name => `Option ${name} needs a value`,

  unknownConfigArg: arg => `Unknown config argument: ${arg}`,
  configUnsetNeedsProfile: list => `--unset needs a profile: --profile <${list}>`,
  configUnsetWithCountries: () => '--unset and --countries cannot be combined',
  configResetWithCountries: () => '--reset and --countries cannot be combined',
  configResetDone: file => `✅ config back to defaults: ${file}`,
  configProfileUnset: profile => `✅ profile '${profile}' removed — it inherits the shared list now`,
  configProfileNotSet: profile => `⏭  profile '${profile}' had no settings of its own`,
  configLineShared: (allowed, timeoutSeconds, source) =>
    `  shared   allowed: ${allowed} (${source})   timeout: ${timeoutSeconds}s`,
  configLineProfile: (profile, allowed, source) =>
    `  ${profile.padEnd(8)} allowed: ${allowed}   (${source})`,
  configSourceProfile: () => 'own profile',
  configSourceInherited: () => 'inherited',
  configSourceEnv: name => `overridden by ${name}`,
  configSourceFile: () => 'from the file',
  configSourceDefaults: () => 'built-in default',
  allowedProfileLine: (profile, list) => `   allowed for ${profile}: ${list}`,

  promptCountries: () => 'Allowed countries (ISO, comma-separated)',
  promptInstallHook: () => 'Install the Claude Code hook (UserPromptSubmit)?',
  promptInstallCursorHook: () => 'Install the Cursor hook (beforeSubmitPrompt, ~/.cursor/hooks.json)?',
  promptInstallShim: command => `Gate ${command} at launch (a shim on your PATH)?`,
  promptInstallCursorShim: command =>
    `Gate ${command} at launch too? (blocks the terminal client before it starts)`,
  promptShimArgs: command => `Flags to pass to ${command} on every launch (empty — none)`,
  promptShells: list => `Shells whose rc gets the PATH entry (${list}, or all)`,
  promptCursorSeparateCountries: () => 'Use a different country list for Cursor?',
  promptCursorCountries: () => 'Allowed countries for Cursor (ISO, comma-separated)',

  configWritten: file => `✅ config → ${file}`,
  allowedLine: list => `   allowed: ${list}`,
  hookInstalled: file => `✅ Claude hook → ${file}`,
  hookCommandLine: command => `   command: ${command}`,
  hookSkipped: () => '⏭  Claude hook skipped',
  cursorHookInstalled: file => `✅ Cursor hook → ${file}`,
  cursorHookSkipped: () => '⏭  Cursor hook skipped',
  hookCustomKept: () => '   your own hook settings (timeout etc.) were kept',
  aliasBlockReplaced: file =>
    `✅ the old geo-guard alias block is gone from ${file} — the PATH shim replaces it`,
  reloadRc: file => `Reload your rc: source ${file}`,
  reloadRcPowershell: file => `Reload your profile: . ${file}`,
  setupDone: () => 'Done. Verify: geo-guard status (in a new terminal, once the PATH entry is live).',
  configPathLine: path => `Config: ${path}`,

  shimInstalled: file => `✅ launch gate → ${file}`,
  shimUpToDate: file => `✅ launch gate already in place: ${file}`,
  shimKeptCustom: file => `⏭  ${file} was edited beyond the flags we can read — left untouched`,
  shimKeptForeign: file => `⚠️  ${file} already exists and is not ours — left untouched`,
  shimForceHint: () =>
    '   Regenerate it: geo-guard setup --force-shim (to change the flags instead, use --claude-args / --cursor-args)',
  shimFlagsKept: flags => `   your flags were kept: ${flags}`,
  shimFlagsSet: flags => `   flags passed on every launch: ${flags}`,
  shimSkipped: () => '⏭  launch gate skipped',
  shimSkippedMissing: command => `⏭  launch gate skipped: no ${command} on PATH`,
  pathEntryInstalled: file => `✅ PATH entry → ${file}`,
  pathEntryAlreadyPresent: file => `⏭  PATH entry already in ${file}`,
  pathEntryKeptForeign: file =>
    `⚠️  the geo-guard PATH block in ${file} holds foreign content — left untouched`,
  pathEntryLoginFile: file =>
    `✅ PATH entry → ${file} (a login bash reads that file, never ~/.bashrc)`,
  userPathInstalled: dir => `✅ ${dir} added to your user PATH (all new processes, not only PowerShell)`,
  userPathAlreadyPresent: dir => `⏭  ${dir} is already in your user PATH`,
  userPathUnavailable: (dir, reason) =>
    `⚠️  could not update your user PATH (${reason}) — the gate covers PowerShell only; add ${dir} to it by hand to cover cmd.exe and everything else`,
  reloadForPath: dir =>
    `Open a new terminal for the launch gate to take effect — it works once ${dir} is on your PATH.`,

  unknownStatusArg: arg => `Unknown status argument: ${arg}`,
  statusConfigPresent: () => '  ✅ config file found',
  statusConfigMissing: () => '  ✖ no config file — the built-in defaults are in effect',
  statusClaudeHookHeader: file => `Claude Code hook: ${file}`,
  statusCursorHookHeader: file => `Cursor hook: ${file}`,
  statusHookInstalled: () => '  ✅ our hook entry is in place',
  statusHookMissing: () => '  ✖ our hook entry is missing',
  statusHookFileMissing: () => '  ✖ no such file — the hook is not installed',
  statusHookNotNeeded: () => '  ⏭  the tool is not installed here — no hook needed',
  statusAliasLeftoverHeader: () => 'Shell aliases from an earlier version:',
  statusAliasLeftover: file =>
    `  ✖ an old geo-guard alias block is still in ${file} — 'geo-guard setup' takes it out`,
  statusAliasLeftoverBroken: file =>
    `  ✖ an old geo-guard alias block in ${file} has no END marker, so it is not ours to cut — remove it by hand`,
  statusShimHeader: dir => `Launch gate (PATH shims): ${dir}`,
  statusShimPristine: command => `  ✅ ${command} goes through geo-guard`,
  statusShimCustom: (command, flags) =>
    `  ✅ ${command} goes through geo-guard, with flags of your own: ${flags}`,
  statusShimForeign: file => `  ✖ ${file} is not ours — the launch gate is not installed`,
  statusShimMissing: command => `  ✖ no shim for ${command}`,
  statusShimNotNeeded: command => `  ⏭  ${command} is not installed here — no shim needed`,
  statusShimNotFirst: found =>
    `  ✖ PATH finds another binary first: ${found}. Open a new terminal, or check the PATH block in your rc.`,
  statusShimNotOnPath: dir =>
    `  ✖ ${dir} is not on this shell's PATH — the gate is installed but not in effect. Open a new terminal.`,
  statusShimNoRealBin: (command, message) =>
    `  ✖ the real ${command} behind the shim cannot be found: ${message}`,
  statusPathHeader: file => `PATH entry: ${file}`,
  statusPathPresent: dir => `  ✅ ${dir} is added to PATH`,
  statusPathMissing: dir => `  ✖ ${dir} is not added to PATH in this file`,
  statusPathForeign: () => '  ✖ the geo-guard PATH block holds foreign content',
  statusPathFileMissing: () => '  ✖ no such rc file — the PATH entry is not installed',
  statusPathAlsoIn: files => `  ✅ also in: ${files}`,
  statusUserPathHeader: () => 'User PATH (Windows):',
  statusUserPathPresent: dir => `  ✅ ${dir} is in your user PATH`,
  statusUserPathMissing: dir =>
    `  ✖ ${dir} is not in your user PATH — outside PowerShell the gate is not in effect`,
  statusUserPathUnknown: reason => `  ⚠️  could not read your user PATH: ${reason}`,
  statusProcessPathPresent: dir => `  ✅ ${dir} is on the PATH of this process`,
  statusProcessPathMissing: dir =>
    `  ✖ ${dir} is not on the PATH of this process — open a new terminal`,
  statusCountryHeader: () => 'Country:',
  statusCountryAllowed: (country, allowed) => `  ✅ ${country} — allowed (allowed: ${allowed})`,
  statusCountryNotAllowed: (country, allowed) =>
    `  🚫 ${country} — not allowed (allowed: ${allowed})`,
  statusCountryUnknown: () => '  ⚠️  could not determine (no network?)',
  statusProblem: message => `  ✖ ${message}`,
  statusOk: () => '✅ Everything geo-guard installs is in place.',
  statusNotOk: () => '✖ Something is missing or broken (see the ✖ lines above).',
  statusSetupHint: () => '   Fix it with: geo-guard setup',

  checkNoCountryBlocked: () =>
    '🚫 Geo-check: could not determine country (no network?). Request blocked.',
  checkCountryNotAllowedBlocked: (country, allowed, profile) => {
    const policy = profile ? `the '${profile}' policy` : 'policy'
    return `🚫 Geo-check: country '${country}' is not allowed by ${policy} (allowed: ${allowed}). Request blocked.`
  },
  checkErrorBlocked: message => `🚫 Geo-check: check failed (${message}). Request blocked.`,
  wrapNoCommand: () => '🚫 geo-guard: specify a command. Example: geo-guard claude',
  wrapSetupHint: () => '   Setup: geo-guard setup',
  wrapError: message => `🚫 geo-guard: ${message}`,
  wrapNoCountryBlocked: () =>
    '🚫 Geo-check: could not determine country (no network?). Launch blocked.',
  wrapCountryNotAllowedBlocked: (country, allowed, profile) => {
    const policy = profile ? `the '${profile}' policy` : 'policy'
    return `🚫 Geo-check: country '${country}' is not allowed by ${policy} (allowed: ${allowed}). Launch blocked.`
  },
  wrapGeoCheckOk: country => `✅ Geo-check: ${country}`,
  wrapSpawnFailed: (bin, message) => `🚫 geo-guard: failed to launch ${bin}: ${message}`,
  wrapRecursionGuard: envVar =>
    `🚫 geo-guard: the launch gate called itself (${envVar} reached its limit). The real binary is hidden behind geo-guard's own shim — point at it explicitly: GEO_GUARD_REAL_BIN=/path/to/binary`,

  unknownUninstallArg: arg => `Unknown uninstall argument: ${arg}`,
  hookRemoved: file => `✅ hook removed from ${file}`,
  hookNotFound: () => '⏭  our hook was not found in settings.json',
  cursorHookNotFound: () => '⏭  our hook was not found in ~/.cursor/hooks.json',
  aliasRemoved: file => `✅ alias removed from ${file}`,
  shimRemoved: file => `✅ launch gate removed: ${file}`,
  shimsNotFound: () => '⏭  no geo-guard shims found',
  shimKeptOnUninstall: file => `⚠️  ${file} is not ours — left as is, remove it yourself if you want`,
  pathEntryRemoved: file => `✅ PATH entry removed from ${file}`,
  pathEntriesNotFound: () => '⏭  no geo-guard PATH blocks found in rc files',
  userPathRemoved: dir => `✅ ${dir} removed from your user PATH`,
  userPathNotFound: () => '⏭  nothing of ours in your user PATH',
  userPathRemoveFailed: (dir, reason) =>
    `⚠️  could not update your user PATH (${reason}) — remove ${dir} from it by hand`,
  pathEntryManuallyEdited: file =>
    `⚠️  the geo-guard PATH block in ${file} was edited by hand — left as is, remove it yourself if you want`,
  aliasBlocksNotFound: () => '⏭  no geo-guard alias blocks found in rc files',
  aliasBlockManuallyEdited: file =>
    `⚠️  the geo-guard alias block in ${file} was edited by hand — left as is, remove it yourself if you want`,
  configKept: path => `⏭  config kept (--keep-config): ${path}`,
  removed: item => `✅ removed: ${item}`,
  configNotFound: () => '⏭  config not found',
  uninstallDone: () => "Done. Your own aliases, PATH lines and settings.json.bak were left untouched.",
  preuninstallError: message => `geo-guard-ai preuninstall: ${message}`,

  invalidConfig: (file, message) => `Invalid config ${file}: ${message}`,
  invalidJson: (file, message) => `${file} — invalid JSON: ${message}`,
  invalidHookShape: (file, key) =>
    `${file}: '${key}' is not the shape the hook config expects. Fix or remove it by hand — geo-guard will not rewrite someone else's data.`,
  notAnObject: () => 'the file does not hold a JSON object',
  invalidHookRoot: file =>
    `${file}: the file does not hold a JSON object. Fix or remove it by hand — geo-guard will not rewrite someone else's data.`,
  rcNotWritable: file => `Cannot write ${file}. Fix its permissions, or run setup with --no-shim.`,
  notACommand: (word, list) =>
    `geo-guard has no '${word}' command (commands: ${list}). To run a program called '${word}' through the geo-check, be explicit: geo-guard -- ${word}`,
  realBinNotFound: path => `GEO_GUARD_REAL_BIN not found: ${path}`,
  binNotFound: command => `Binary not found: ${command}`,
  targetIsSelf: command => `Target points at geo-guard itself: ${command}`,
  binNotFoundInPath: command =>
    `Binary '${command}' not found in PATH. Set the path: GEO_GUARD_REAL_BIN=/path/to/${command}`,
}

const ru: Messages = {
  help: () => `geo-guard-ai — гео-ограничение для AI CLI

Использование:
  geo-guard setup [options]     интерактивная настройка
  geo-guard uninstall [--keep-config]  убрать наши следы (hook, гейт на запуск, конфиг)
  geo-guard config [options]    показать / изменить разрешённые страны
  geo-guard check               hook-проверка (exit 0/2)
  geo-guard status              что установлено и работает (exit 0/1)
  geo-guard version             напечатать версию
  geo-guard <command> [args…]   проверить гео и запустить команду
  geo-guard -- <command> […]    то же, если имя похоже на подкоманду

setup options:
  -y, --yes                 без вопросов (дефолты)
  -c, --countries ES,PT     разрешённые страны
  --shells zsh,bash|all     в чьи rc прописать PATH (по умолчанию — твой shell)
  --shell zsh               один shell, то же, что --shells zsh
  --hook / --no-hook
  --cursor / --no-cursor    установить hook Cursor (~/.cursor/hooks.json)
  --shim / --no-shim        гейт на запуск 'claude' (shim в PATH)
  --cursor-shim / --no-cursor-shim
                            гейт на запуск 'cursor-agent'
                            (по умолчанию: включён, если cursor-agent есть в PATH)
  --force-shim              пересобрать наш shim, тело которого правили руками
  --claude-args "--flag"    флаги, с которыми гейт запускает claude
  --cursor-args "--flag"    то же для cursor-agent (пустое значение — снять)
  --claude-countries ES,PT  страны только для Claude Code
  --cursor-countries PL     страны только для Cursor

config options:
  (без опций)               показать эффективный конфиг
  -c, --countries ES,PT     задать страны
  -p, --profile claude|cursor   применить только к этому инструменту
  --unset --profile cursor  убрать профиль, вернуться к общему списку
  --reset                   вернуть дефолты, удалить все профили
  --reset --profile cursor  то же, что --unset --profile cursor

uninstall options:
  --keep-config             не удалять config.json
  -q, --quiet               меньше логов (для npm preuninstall)

Примеры:
  npm install -g geo-guard-ai
  geo-guard setup
  geo-guard setup --countries ES,PT --yes
  geo-guard config --countries PL --profile cursor
  geo-guard claude --version
`,

  unknownSetupArg: arg => `Неизвестный аргумент setup: ${arg}`,
  retiredAliasFlag: (arg, replacement) =>
    `${arg} больше нет: гейт на запуск теперь shim в PATH, а не alias в shell (alias не действовал ни в скриптах, ни на \\claude, ни в шелле, чей rc мы не правили). Вместо него: ${replacement}.`,
  retiredAliasNameFlag: arg =>
    `${arg} больше нет: гейт на запуск — файл с именем самой команды в ~/.geo-guard/bin, своего имени у него нет. Убери флаг или откажись от гейта через --no-shim.`,
  invalidShimArgs: value =>
    `Во флагах для гейта на запуск не может быть управляющих символов и переносов строк: '${value}'`,
  promptInputEnded: () =>
    'Ввод кончился раньше, чем закончились вопросы — ничего не установлено. Для запуска без участия человека: geo-guard setup --yes',
  unsupportedShellWithList: (shell, list) => `Неподдерживаемый shell: ${shell}. Доступны: ${list}`,
  unsupportedShell: shell => `Неподдерживаемый shell: ${shell}`,
  emptyCountryList: () => 'Список стран пуст',
  invalidCountryCodes: codes =>
    `Некорректный код(ы) страны: ${codes}. Нужен ISO 3166-1 alpha-2 (например ES, PT)`,
  postinstallHint: () => 'запусти  geo-guard setup',
  unknownProfile: (name, list) => `Неизвестный профиль: '${name}'. Доступны: ${list}`,
  unknownCheckArg: arg => `Неизвестный аргумент check: ${arg}`,
  unknownOption: arg => `Неизвестная опция: ${arg}. Смотри geo-guard --help`,
  optionNeedsValue: name => `Опция ${name} требует значения`,

  unknownConfigArg: arg => `Неизвестный аргумент config: ${arg}`,
  configUnsetNeedsProfile: list => `--unset требует профиль: --profile <${list}>`,
  configUnsetWithCountries: () => '--unset и --countries нельзя вместе',
  configResetWithCountries: () => '--reset и --countries нельзя вместе',
  configResetDone: file => `✅ конфиг сброшен к дефолтам: ${file}`,
  configProfileUnset: profile => `✅ профиль '${profile}' удалён — теперь наследует общий список`,
  configProfileNotSet: profile => `⏭  у профиля '${profile}' не было своих настроек`,
  configLineShared: (allowed, timeoutSeconds, source) =>
    `  общее    allowed: ${allowed} (${source})   timeout: ${timeoutSeconds}s`,
  configLineProfile: (profile, allowed, source) =>
    `  ${profile.padEnd(8)} allowed: ${allowed}   (${source})`,
  configSourceProfile: () => 'свой профиль',
  configSourceInherited: () => 'наследует',
  configSourceEnv: name => `перебито ${name}`,
  configSourceFile: () => 'из файла',
  configSourceDefaults: () => 'встроенный дефолт',
  allowedProfileLine: (profile, list) => `   allowed для ${profile}: ${list}`,

  promptCountries: () => 'Разрешённые страны (ISO, через запятую)',
  promptInstallHook: () => 'Установить hook Claude Code (UserPromptSubmit)?',
  promptInstallCursorHook: () => 'Установить hook Cursor (beforeSubmitPrompt, ~/.cursor/hooks.json)?',
  promptInstallShim: command => `Поставить гейт на запуск ${command} (shim в PATH)?`,
  promptInstallCursorShim: command =>
    `Поставить гейт и на ${command}? (блокирует терминальный клиент до старта)`,
  promptShimArgs: command => `Флаги, с которыми запускать ${command} (пусто — без флагов)`,
  promptShells: list => `В чьи rc прописать PATH (${list} или all)`,
  promptCursorSeparateCountries: () => 'Для Cursor нужен отдельный список стран?',
  promptCursorCountries: () => 'Разрешённые страны для Cursor (ISO, через запятую)',

  configWritten: file => `✅ конфиг → ${file}`,
  allowedLine: list => `   allowed: ${list}`,
  hookInstalled: file => `✅ Claude hook → ${file}`,
  hookCommandLine: command => `   command: ${command}`,
  hookSkipped: () => '⏭  Claude hook пропущен',
  cursorHookInstalled: file => `✅ Cursor hook → ${file}`,
  cursorHookSkipped: () => '⏭  Cursor hook пропущен',
  hookCustomKept: () => '   твои настройки хука (timeout и т.п.) сохранены',
  aliasBlockReplaced: file =>
    `✅ старый geo-guard alias-блок убран из ${file} — его заменил shim в PATH`,
  reloadRc: file => `Перечитай rc: source ${file}`,
  reloadRcPowershell: file => `Перечитай профиль: . ${file}`,
  setupDone: () => 'Готово. Проверка: geo-guard status (в новом терминале, когда запись в PATH подхватится).',
  configPathLine: path => `Конфиг: ${path}`,

  shimInstalled: file => `✅ гейт на запуск → ${file}`,
  shimUpToDate: file => `✅ гейт на запуск уже на месте: ${file}`,
  shimKeptCustom: file => `⏭  в ${file} правки за пределами флагов, которые мы умеем читать — не трогаем`,
  shimKeptForeign: file => `⚠️  ${file} уже существует и это не наш файл — не трогаем`,
  shimForceHint: () =>
    '   Пересобрать: geo-guard setup --force-shim (поменять флаги — через --claude-args / --cursor-args)',
  shimFlagsKept: flags => `   твои флаги сохранены: ${flags}`,
  shimFlagsSet: flags => `   флаги при каждом запуске: ${flags}`,
  shimSkipped: () => '⏭  гейт на запуск пропущен',
  shimSkippedMissing: command => `⏭  гейт на запуск пропущен: ${command} нет в PATH`,
  pathEntryInstalled: file => `✅ запись в PATH → ${file}`,
  pathEntryAlreadyPresent: file => `⏭  запись в PATH уже есть в ${file}`,
  pathEntryKeptForeign: file =>
    `⚠️  в ${file} внутри наших PATH-маркеров чужое содержимое — не трогаем`,
  pathEntryLoginFile: file =>
    `✅ запись в PATH → ${file} (login-shell bash читает именно его, а не ~/.bashrc)`,
  userPathInstalled: dir =>
    `✅ ${dir} добавлен в пользовательский PATH (все новые процессы, не только PowerShell)`,
  userPathAlreadyPresent: dir => `⏭  ${dir} уже есть в пользовательском PATH`,
  userPathUnavailable: (dir, reason) =>
    `⚠️  не удалось поправить пользовательский PATH (${reason}) — гейт покрывает только PowerShell; добавь ${dir} туда руками, чтобы покрыть cmd.exe и остальное`,
  reloadForPath: dir =>
    `Открой новый терминал, чтобы гейт на запуск заработал — он действует, когда ${dir} есть в PATH.`,

  unknownStatusArg: arg => `Неизвестный аргумент status: ${arg}`,
  statusConfigPresent: () => '  ✅ файл конфига найден',
  statusConfigMissing: () => '  ✖ файла конфига нет — действуют встроенные дефолты',
  statusClaudeHookHeader: file => `Hook Claude Code: ${file}`,
  statusCursorHookHeader: file => `Hook Cursor: ${file}`,
  statusHookInstalled: () => '  ✅ наша запись hook на месте',
  statusHookMissing: () => '  ✖ нашей записи hook нет',
  statusHookFileMissing: () => '  ✖ файла нет — hook не установлен',
  statusHookNotNeeded: () => '  ⏭  инструмента здесь нет — hook не нужен',
  statusAliasLeftoverHeader: () => 'Alias в shell от прошлой версии:',
  statusAliasLeftover: file =>
    `  ✖ в ${file} остался старый geo-guard alias-блок — 'geo-guard setup' его уберёт`,
  statusAliasLeftoverBroken: file =>
    `  ✖ у старого geo-guard alias-блока в ${file} нет END-маркера, вырезать его нам нельзя — убери руками`,
  statusShimHeader: dir => `Гейт на запуск (shim в PATH): ${dir}`,
  statusShimPristine: command => `  ✅ ${command} идёт через geo-guard`,
  statusShimCustom: (command, flags) =>
    `  ✅ ${command} идёт через geo-guard, с твоими флагами: ${flags}`,
  statusShimForeign: file => `  ✖ ${file} — не наш файл, гейт на запуск не установлен`,
  statusShimMissing: command => `  ✖ shim для ${command} нет`,
  statusShimNotNeeded: command => `  ⏭  ${command} здесь не установлен — shim не нужен`,
  statusShimNotFirst: found =>
    `  ✖ в PATH раньше находится другой бинарь: ${found}. Открой новый терминал или проверь PATH-блок в rc.`,
  statusShimNotOnPath: dir =>
    `  ✖ ${dir} нет в PATH этого шелла — гейт установлен, но не действует. Открой новый терминал.`,
  statusShimNoRealBin: (command, message) =>
    `  ✖ настоящий ${command} за shim не находится: ${message}`,
  statusPathHeader: file => `Запись в PATH: ${file}`,
  statusPathPresent: dir => `  ✅ ${dir} добавлен в PATH`,
  statusPathMissing: dir => `  ✖ ${dir} не добавлен в PATH в этом файле`,
  statusPathForeign: () => '  ✖ в geo-guard PATH-блоке лежит чужое содержимое',
  statusPathFileMissing: () => '  ✖ такого rc-файла нет — запись в PATH не установлена',
  statusPathAlsoIn: files => `  ✅ и ещё в: ${files}`,
  statusUserPathHeader: () => 'Пользовательский PATH (Windows):',
  statusUserPathPresent: dir => `  ✅ ${dir} есть в пользовательском PATH`,
  statusUserPathMissing: dir =>
    `  ✖ ${dir} нет в пользовательском PATH — вне PowerShell гейт не действует`,
  statusUserPathUnknown: reason => `  ⚠️  не удалось прочитать пользовательский PATH: ${reason}`,
  statusProcessPathPresent: dir => `  ✅ ${dir} есть в PATH текущего процесса`,
  statusProcessPathMissing: dir =>
    `  ✖ ${dir} нет в PATH текущего процесса — открой новый терминал`,
  statusCountryHeader: () => 'Страна:',
  statusCountryAllowed: (country, allowed) => `  ✅ ${country} — разрешена (разрешены: ${allowed})`,
  statusCountryNotAllowed: (country, allowed) =>
    `  🚫 ${country} — не разрешена (разрешены: ${allowed})`,
  statusCountryUnknown: () => '  ⚠️  определить не удалось (нет сети?)',
  statusProblem: message => `  ✖ ${message}`,
  statusOk: () => '✅ Всё, что ставит geo-guard, на месте.',
  statusNotOk: () => '✖ Чего-то не хватает или что-то сломано (см. строки с ✖ выше).',
  statusSetupHint: () => '   Починить: geo-guard setup',

  checkNoCountryBlocked: () =>
    '🚫 Geo-check: не удалось определить страну (нет сети?). Запрос заблокирован.',
  checkCountryNotAllowedBlocked: (country, allowed, profile) => {
    const policy = profile ? `политикой '${profile}'` : 'политикой'
    return `🚫 Geo-check: страна '${country}' не разрешена ${policy} (разрешено: ${allowed}). Запрос заблокирован.`
  },
  checkErrorBlocked: message => `🚫 Geo-check: ошибка проверки (${message}). Запрос заблокирован.`,
  wrapNoCommand: () => '🚫 geo-guard: укажи команду. Пример: geo-guard claude',
  wrapSetupHint: () => '   Настройка: geo-guard setup',
  wrapError: message => `🚫 geo-guard: ${message}`,
  wrapNoCountryBlocked: () =>
    '🚫 Geo-check: не удалось определить страну (нет сети?). Запуск заблокирован.',
  wrapCountryNotAllowedBlocked: (country, allowed, profile) => {
    const policy = profile ? `политикой '${profile}'` : 'политикой'
    return `🚫 Geo-check: страна '${country}' не разрешена ${policy} (разрешено: ${allowed}). Запуск заблокирован.`
  },
  wrapGeoCheckOk: country => `✅ Geo-check: ${country}`,
  wrapSpawnFailed: (bin, message) => `🚫 geo-guard: не удалось запустить ${bin}: ${message}`,
  wrapRecursionGuard: envVar =>
    `🚫 geo-guard: гейт на запуск вызвал сам себя (${envVar} достиг предела). Настоящий бинарь закрыт нашим же shim — укажи его явно: GEO_GUARD_REAL_BIN=/path/to/binary`,

  unknownUninstallArg: arg => `Неизвестный аргумент uninstall: ${arg}`,
  hookRemoved: file => `✅ hook убран из ${file}`,
  hookNotFound: () => '⏭  нашего hook в settings.json не найдено',
  cursorHookNotFound: () => '⏭  нашего hook в ~/.cursor/hooks.json не найдено',
  aliasRemoved: file => `✅ alias убран из ${file}`,
  shimRemoved: file => `✅ гейт на запуск убран: ${file}`,
  shimsNotFound: () => '⏭  наших shim не найдено',
  shimKeptOnUninstall: file => `⚠️  ${file} — не наш файл, оставлен как есть, сними сам при желании`,
  pathEntryRemoved: file => `✅ запись в PATH убрана из ${file}`,
  pathEntriesNotFound: () => '⏭  наших PATH-блоков в rc не найдено',
  userPathRemoved: dir => `✅ ${dir} убран из пользовательского PATH`,
  userPathNotFound: () => '⏭  в пользовательском PATH нашего ничего нет',
  userPathRemoveFailed: (dir, reason) =>
    `⚠️  не удалось поправить пользовательский PATH (${reason}) — убери ${dir} оттуда руками`,
  pathEntryManuallyEdited: file =>
    `⚠️  в ${file} geo-guard PATH-блок правился вручную — оставлен как есть, сними сам при желании`,
  aliasBlocksNotFound: () => '⏭  наших alias-блоков в rc не найдено',
  aliasBlockManuallyEdited: file =>
    `⚠️  в ${file} geo-guard alias-блок правился вручную — оставлен как есть, сними сам при желании`,
  configKept: path => `⏭  конфиг оставлен (--keep-config): ${path}`,
  removed: item => `✅ удалено: ${item}`,
  configNotFound: () => '⏭  конфиг не найден',
  uninstallDone: () => 'Готово. Твои alias, строки PATH и settings.json.bak не трогались.',
  preuninstallError: message => `geo-guard-ai preuninstall: ${message}`,

  invalidConfig: (file, message) => `Невалидный конфиг ${file}: ${message}`,
  invalidJson: (file, message) => `${file} — невалидный JSON: ${message}`,
  invalidHookShape: (file, key) =>
    `${file}: '${key}' не той формы, которую ожидает hook-конфиг. Поправь или убери руками — geo-guard не переписывает чужие данные.`,
  notAnObject: () => 'в файле не JSON-объект',
  invalidHookRoot: file =>
    `${file}: в файле не JSON-объект. Поправь или убери руками — geo-guard не переписывает чужие данные.`,
  rcNotWritable: file => `Не могу писать в ${file}. Поправь права или запусти setup с --no-shim.`,
  notACommand: (word, list) =>
    `У geo-guard нет команды '${word}' (команды: ${list}). Чтобы прогнать через гео-проверку программу с таким именем, скажи явно: geo-guard -- ${word}`,
  realBinNotFound: path => `GEO_GUARD_REAL_BIN не найден: ${path}`,
  binNotFound: command => `Не найден бинарь: ${command}`,
  targetIsSelf: command => `Цель указывает на сам geo-guard: ${command}`,
  binNotFoundInPath: command =>
    `Не найден бинарь '${command}' в PATH. Задай путь: GEO_GUARD_REAL_BIN=/path/to/${command}`,
}

const CATALOG: Record<Lang, Messages> = { en, ru }

function rawLocale(): string {
  const override = process.env.GEO_GUARD_LANG
  if (override) return override
  const env =
    process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || process.env.LANGUAGE
  if (env) return env
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return DEFAULT_LANG
  }
}

/** Machine locale → supported language, falling back to English. */
export function detectLang(): Lang {
  // Takes the primary subtag: `ru_RU.UTF-8`, `ru-RU`, `en_US:en` → `ru` / `en`.
  const code = rawLocale().toLowerCase().split(/[-_.:]/)[0] ?? DEFAULT_LANG
  return (SUPPORTED_LANGS as readonly string[]).includes(code) ? (code as Lang) : DEFAULT_LANG
}

/** Message catalog for the active locale. Use as `msg().someKey(args)`. */
export function msg(): Messages {
  return CATALOG[detectLang()]
}
