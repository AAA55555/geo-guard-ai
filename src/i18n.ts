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
  invalidAliasName: (name: string) => string
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
  promptAddAlias: (name: string, shell: string) => string
  promptShell: (list: string) => string
  promptAliasName: () => string
  promptCursorSeparateCountries: () => string
  promptCursorCountries: () => string

  // --- setup: alias conflict (interactive) ---
  aliasConflictHeader: (file: string, name: string) => string
  aliasWontTouch: () => string

  // --- setup: output ---
  configWritten: (file: string) => string
  allowedLine: (list: string) => string
  hookInstalled: (file: string) => string
  hookCommandLine: (command: string) => string
  hookSkipped: () => string
  cursorHookInstalled: (file: string) => string
  cursorHookSkipped: () => string
  aliasInstalled: (file: string) => string
  aliasKeptCustom: (file: string) => string
  aliasKeptForeign: (file: string) => string
  aliasForceHint: () => string
  aliasNameChangeSkipped: (kept: string, requested: string) => string
  hookCustomKept: () => string
  aliasClaudeTaken: (name: string) => string
  aliasRunVia: (name: string) => string
  reloadRc: (file: string) => string
  macosBashProfileHint: () => string
  aliasSkippedReason: (reason: string) => string
  aliasSkipped: () => string
  aliasSkipUserChose: () => string
  aliasSkipAllTaken: (name: string) => string
  setupDone: () => string
  configPathLine: (path: string) => string

  // --- status command ---
  unknownStatusArg: (arg: string) => string
  statusConfigPresent: () => string
  statusConfigMissing: () => string
  statusClaudeHookHeader: (file: string) => string
  statusCursorHookHeader: (file: string) => string
  statusHookInstalled: () => string
  statusHookMissing: () => string
  statusHookFileMissing: () => string
  statusAliasHeader: (file: string) => string
  statusAliasFileMissing: () => string
  statusAliasMissing: () => string
  statusAliasPristine: (name: string) => string
  statusAliasCustom: (body: string) => string
  statusAliasForeign: (body: string) => string
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

  // --- uninstall ---
  unknownUninstallArg: (arg: string) => string
  hookRemoved: (file: string) => string
  hookNotFound: () => string
  cursorHookNotFound: () => string
  aliasRemoved: (file: string) => string
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
  rcNotWritable: (file: string) => string
  notACommand: (word: string, list: string) => string
  aliasAlreadyExists: (name: string, existing: string) => string
  realBinNotFound: (path: string) => string
  binNotFound: (command: string) => string
  targetIsSelf: (command: string) => string
  binNotFoundInPath: (command: string) => string
}

const en: Messages = {
  help: () => `geo-guard-ai — geo-restriction for AI CLIs

Usage:
  geo-guard setup [options]     interactive setup
  geo-guard uninstall [--keep-config]  remove our traces (hook, alias, config)
  geo-guard config [options]    show / change the allowed countries
  geo-guard check               hook check (exit 0/2)
  geo-guard status              what is installed and working (exit 0/1)
  geo-guard <command> [args…]   check geo and run the command
  geo-guard -- <command> […]    same, for a name that looks like a subcommand

setup options:
  -y, --yes                 no questions (defaults)
  -c, --countries ES,PT     allowed countries
  --shell zsh|bash|fish|powershell
  --hook / --no-hook
  --cursor / --no-cursor    install the Cursor hook (~/.cursor/hooks.json)
  --alias / --no-alias
  --alias-name cc           alias name (default claude; on collision suggests another)
  --force-alias             overwrite an alias block you edited by hand
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
  invalidAliasName: name =>
    `Invalid alias name: '${name}'. Allowed: letters, digits, _ - . and no spaces`,
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
  promptAddAlias: (name, shell) => `Add alias ${name} → geo-guard claude to ${shell}?`,
  promptShell: list => `Shell for the alias (${list})`,
  promptAliasName: () => 'Name for the geo-guard alias (empty — skip alias)',
  promptCursorSeparateCountries: () => 'Use a different country list for Cursor?',
  promptCursorCountries: () => 'Allowed countries for Cursor (ISO, comma-separated)',

  aliasConflictHeader: (file, name) => `⚠️  ${file} already has its own alias '${name}':`,
  aliasWontTouch: () => '   geo-guard will not touch it.',

  configWritten: file => `✅ config → ${file}`,
  allowedLine: list => `   allowed: ${list}`,
  hookInstalled: file => `✅ Claude hook → ${file}`,
  hookCommandLine: command => `   command: ${command}`,
  hookSkipped: () => '⏭  Claude hook skipped',
  cursorHookInstalled: file => `✅ Cursor hook → ${file}`,
  cursorHookSkipped: () => '⏭  Cursor hook skipped',
  aliasInstalled: file => `✅ alias → ${file}`,
  aliasKeptCustom: file => `⏭  alias in ${file} has your own flags — left untouched:`,
  aliasKeptForeign: file => `⚠️  the geo-guard block in ${file} holds foreign content — left untouched:`,
  aliasForceHint: () => '   Overwrite with the default alias: geo-guard setup --force-alias',
  aliasNameChangeSkipped: (kept, requested) =>
    `   Kept the existing name '${kept}', did not switch to '${requested}' — use --force-alias to rename.`,
  hookCustomKept: () => '   your own hook settings (timeout etc.) were kept',
  aliasClaudeTaken: name => `   'claude' was taken by your own alias — using '${name}'.`,
  aliasRunVia: name => `   Run Claude Code via: ${name} …`,
  reloadRc: file => `Reload your rc: source ${file}`,
  macosBashProfileHint: () =>
    '   macOS: a login bash shell reads ~/.bash_profile. If the alias is not picked up — add `source ~/.bashrc` to ~/.bash_profile.',
  aliasSkippedReason: reason => `⏭  alias skipped: ${reason}`,
  aliasSkipped: () => '⏭  alias skipped',
  aliasSkipUserChose: () => 'you chose not to create the alias (name taken)',
  aliasSkipAllTaken: name =>
    `name '${name}' and fallbacks (cc/ccg/…) are taken — set your own: --alias-name <name>`,
  setupDone: () => 'Done. Verify: geo-guard check && geo-guard claude --version',
  configPathLine: path => `Config: ${path}`,

  unknownStatusArg: arg => `Unknown status argument: ${arg}`,
  statusConfigPresent: () => '  ✅ config file found',
  statusConfigMissing: () => '  ✖ no config file — the built-in defaults are in effect',
  statusClaudeHookHeader: file => `Claude Code hook: ${file}`,
  statusCursorHookHeader: file => `Cursor hook: ${file}`,
  statusHookInstalled: () => '  ✅ our hook entry is in place',
  statusHookMissing: () => '  ✖ our hook entry is missing',
  statusHookFileMissing: () => '  ✖ no such file — the hook is not installed',
  statusAliasHeader: file => `Shell alias: ${file}`,
  statusAliasFileMissing: () => '  ✖ no such rc file — the alias is not installed',
  statusAliasMissing: () => '  ✖ no geo-guard alias block in this file',
  statusAliasPristine: name => `  ✅ alias '${name}' → geo-guard claude`,
  statusAliasCustom: body => `  ✅ alias with flags of your own: ${body}`,
  statusAliasForeign: body => `  ✖ the geo-guard block holds foreign content: ${body}`,
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

  unknownUninstallArg: arg => `Unknown uninstall argument: ${arg}`,
  hookRemoved: file => `✅ hook removed from ${file}`,
  hookNotFound: () => '⏭  our hook was not found in settings.json',
  cursorHookNotFound: () => '⏭  our hook was not found in ~/.cursor/hooks.json',
  aliasRemoved: file => `✅ alias removed from ${file}`,
  aliasBlocksNotFound: () => '⏭  no geo-guard alias blocks found in rc files',
  aliasBlockManuallyEdited: file =>
    `⚠️  the geo-guard alias block in ${file} was edited by hand — left as is, remove it yourself if you want`,
  configKept: path => `⏭  config kept (--keep-config): ${path}`,
  removed: item => `✅ removed: ${item}`,
  configNotFound: () => '⏭  config not found',
  uninstallDone: () => "Done. Other aliases (cc/c) and settings.json.bak were left untouched.",
  preuninstallError: message => `geo-guard-ai preuninstall: ${message}`,

  invalidConfig: (file, message) => `Invalid config ${file}: ${message}`,
  invalidJson: (file, message) => `${file} — invalid JSON: ${message}`,
  invalidHookShape: (file, key) =>
    `${file}: '${key}' is not the shape the hook config expects. Fix or remove it by hand — geo-guard will not rewrite someone else's data.`,
  invalidHookRoot: file =>
    `${file}: the file does not hold a JSON object. Fix or remove it by hand — geo-guard will not rewrite someone else's data.`,
  rcNotWritable: file => `Cannot write ${file}. Fix its permissions, or run setup with --no-alias.`,
  notACommand: (word, list) =>
    `geo-guard has no '${word}' command (commands: ${list}). To run a program called '${word}' through the geo-check, be explicit: geo-guard -- ${word}`,
  aliasAlreadyExists: (name, existing) => `Alias '${name}' already exists: ${existing}`,
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
  geo-guard uninstall [--keep-config]  убрать наши следы (hook, alias, конфиг)
  geo-guard config [options]    показать / изменить разрешённые страны
  geo-guard check               hook-проверка (exit 0/2)
  geo-guard status              что установлено и работает (exit 0/1)
  geo-guard <command> [args…]   проверить гео и запустить команду
  geo-guard -- <command> […]    то же, если имя похоже на подкоманду

setup options:
  -y, --yes                 без вопросов (дефолты)
  -c, --countries ES,PT     разрешённые страны
  --shell zsh|bash|fish|powershell
  --hook / --no-hook
  --cursor / --no-cursor    установить hook Cursor (~/.cursor/hooks.json)
  --alias / --no-alias
  --alias-name cc           имя alias (дефолт claude; при коллизии предложит другое)
  --force-alias             перезаписать alias-блок, который правил вручную
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
  invalidAliasName: name =>
    `Недопустимое имя alias: '${name}'. Разрешены буквы, цифры, _ - . без пробелов`,
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
  promptAddAlias: (name, shell) => `Добавить alias ${name} → geo-guard claude в ${shell}?`,
  promptShell: list => `Shell для alias (${list})`,
  promptAliasName: () => 'Имя для geo-guard alias (пусто — пропустить alias)',
  promptCursorSeparateCountries: () => 'Для Cursor нужен отдельный список стран?',
  promptCursorCountries: () => 'Разрешённые страны для Cursor (ISO, через запятую)',

  aliasConflictHeader: (file, name) => `⚠️  В ${file} уже есть свой alias '${name}':`,
  aliasWontTouch: () => '   geo-guard его не тронет.',

  configWritten: file => `✅ конфиг → ${file}`,
  allowedLine: list => `   allowed: ${list}`,
  hookInstalled: file => `✅ Claude hook → ${file}`,
  hookCommandLine: command => `   command: ${command}`,
  hookSkipped: () => '⏭  Claude hook пропущен',
  cursorHookInstalled: file => `✅ Cursor hook → ${file}`,
  cursorHookSkipped: () => '⏭  Cursor hook пропущен',
  aliasInstalled: file => `✅ alias → ${file}`,
  aliasKeptCustom: file => `⏭  в ${file} alias с твоими флагами — не трогаем:`,
  aliasKeptForeign: file => `⚠️  в ${file} внутри наших маркеров чужое содержимое — не трогаем:`,
  aliasForceHint: () => '   Перезаписать дефолтным alias: geo-guard setup --force-alias',
  aliasNameChangeSkipped: (kept, requested) =>
    `   Оставили имя '${kept}', не меняли на '${requested}' — для переименования: --force-alias.`,
  hookCustomKept: () => '   твои настройки хука (timeout и т.п.) сохранены',
  aliasClaudeTaken: name => `   'claude' был занят твоим alias — используем '${name}'.`,
  aliasRunVia: name => `   Запускай Claude Code через: ${name} …`,
  reloadRc: file => `Перечитай rc: source ${file}`,
  macosBashProfileHint: () =>
    '   macOS: login-shell bash читает ~/.bash_profile. Если alias не подхватился — добавь `source ~/.bashrc` в ~/.bash_profile.',
  aliasSkippedReason: reason => `⏭  alias пропущен: ${reason}`,
  aliasSkipped: () => '⏭  alias пропущен',
  aliasSkipUserChose: () => 'ты выбрал не создавать alias (имя занято)',
  aliasSkipAllTaken: name =>
    `имя '${name}' и запасные (cc/ccg/…) заняты — задай своё: --alias-name <имя>`,
  setupDone: () => 'Готово. Проверка: geo-guard check && geo-guard claude --version',
  configPathLine: path => `Конфиг: ${path}`,

  unknownStatusArg: arg => `Неизвестный аргумент status: ${arg}`,
  statusConfigPresent: () => '  ✅ файл конфига найден',
  statusConfigMissing: () => '  ✖ файла конфига нет — действуют встроенные дефолты',
  statusClaudeHookHeader: file => `Hook Claude Code: ${file}`,
  statusCursorHookHeader: file => `Hook Cursor: ${file}`,
  statusHookInstalled: () => '  ✅ наша запись hook на месте',
  statusHookMissing: () => '  ✖ нашей записи hook нет',
  statusHookFileMissing: () => '  ✖ файла нет — hook не установлен',
  statusAliasHeader: file => `Alias в shell: ${file}`,
  statusAliasFileMissing: () => '  ✖ такого rc-файла нет — alias не установлен',
  statusAliasMissing: () => '  ✖ в этом файле нет geo-guard-блока с alias',
  statusAliasPristine: name => `  ✅ alias '${name}' → geo-guard claude`,
  statusAliasCustom: body => `  ✅ alias с твоими флагами: ${body}`,
  statusAliasForeign: body => `  ✖ в geo-guard-блоке лежит чужое содержимое: ${body}`,
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

  unknownUninstallArg: arg => `Неизвестный аргумент uninstall: ${arg}`,
  hookRemoved: file => `✅ hook убран из ${file}`,
  hookNotFound: () => '⏭  нашего hook в settings.json не найдено',
  cursorHookNotFound: () => '⏭  нашего hook в ~/.cursor/hooks.json не найдено',
  aliasRemoved: file => `✅ alias убран из ${file}`,
  aliasBlocksNotFound: () => '⏭  наших alias-блоков в rc не найдено',
  aliasBlockManuallyEdited: file =>
    `⚠️  в ${file} geo-guard alias-блок правился вручную — оставлен как есть, сними сам при желании`,
  configKept: path => `⏭  конфиг оставлен (--keep-config): ${path}`,
  removed: item => `✅ удалено: ${item}`,
  configNotFound: () => '⏭  конфиг не найден',
  uninstallDone: () => 'Готово. Чужие alias (cc/c) и settings.json.bak не трогались.',
  preuninstallError: message => `geo-guard-ai preuninstall: ${message}`,

  invalidConfig: (file, message) => `Невалидный конфиг ${file}: ${message}`,
  invalidJson: (file, message) => `${file} — невалидный JSON: ${message}`,
  invalidHookShape: (file, key) =>
    `${file}: '${key}' не той формы, которую ожидает hook-конфиг. Поправь или убери руками — geo-guard не переписывает чужие данные.`,
  invalidHookRoot: file =>
    `${file}: в файле не JSON-объект. Поправь или убери руками — geo-guard не переписывает чужие данные.`,
  rcNotWritable: file => `Не могу писать в ${file}. Поправь права или запусти setup с --no-alias.`,
  notACommand: (word, list) =>
    `У geo-guard нет команды '${word}' (команды: ${list}). Чтобы прогнать через гео-проверку программу с таким именем, скажи явно: geo-guard -- ${word}`,
  aliasAlreadyExists: (name, existing) => `Уже существует alias '${name}': ${existing}`,
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
