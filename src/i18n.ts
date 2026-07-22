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

  // --- setup: prompts ---
  promptCountries: () => string
  promptInstallHook: () => string
  promptAddAlias: (name: string, shell: string) => string
  promptShell: (list: string) => string
  promptAliasName: () => string

  // --- setup: alias conflict (interactive) ---
  aliasConflictHeader: (file: string, name: string) => string
  aliasWontTouch: () => string

  // --- setup: output ---
  configWritten: (file: string) => string
  allowedLine: (list: string) => string
  hookInstalled: (file: string) => string
  hookCommandLine: (command: string) => string
  hookSkipped: () => string
  aliasInstalled: (file: string) => string
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

  // --- check / wrap (run.ts) ---
  checkNoCountryBlocked: () => string
  checkCountryNotAllowedBlocked: (country: string, allowed: string) => string
  checkErrorBlocked: (message: string) => string
  wrapNoCommand: () => string
  wrapSetupHint: () => string
  wrapError: (message: string) => string
  wrapNoCountryBlocked: () => string
  wrapCountryNotAllowedBlocked: (country: string, allowed: string) => string
  wrapGeoCheckOk: (country: string) => string
  wrapSpawnFailed: (bin: string, message: string) => string

  // --- uninstall ---
  unknownUninstallArg: (arg: string) => string
  hookRemoved: (file: string) => string
  hookNotFound: () => string
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
  geo-guard check               hook check (exit 0/2)
  geo-guard <command> [args…]   check geo and run the command

setup options:
  -y, --yes                 no questions (defaults)
  -c, --countries ES,PT     allowed countries
  --shell zsh|bash|fish|powershell
  --hook / --no-hook
  --alias / --no-alias
  --alias-name cc           alias name (default claude; on collision suggests another)

uninstall options:
  --keep-config             don't delete config.json
  -q, --quiet               fewer logs (for npm preuninstall)

Examples:
  npm install -g geo-guard-ai
  geo-guard setup
  geo-guard setup --countries ES,PT --yes
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

  promptCountries: () => 'Allowed countries (ISO, comma-separated)',
  promptInstallHook: () => 'Install the Claude Code hook (UserPromptSubmit)?',
  promptAddAlias: (name, shell) => `Add alias ${name} → geo-guard claude to ${shell}?`,
  promptShell: list => `Shell for the alias (${list})`,
  promptAliasName: () => 'Name for the geo-guard alias (empty — skip alias)',

  aliasConflictHeader: (file, name) => `⚠️  ${file} already has its own alias '${name}':`,
  aliasWontTouch: () => '   geo-guard will not touch it.',

  configWritten: file => `✅ config → ${file}`,
  allowedLine: list => `   allowed: ${list}`,
  hookInstalled: file => `✅ Claude hook → ${file}`,
  hookCommandLine: command => `   command: ${command}`,
  hookSkipped: () => '⏭  Claude hook skipped',
  aliasInstalled: file => `✅ alias → ${file}`,
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

  checkNoCountryBlocked: () =>
    '🚫 Geo-check: could not determine country (no network?). Request blocked.',
  checkCountryNotAllowedBlocked: (country, allowed) =>
    `🚫 Geo-check: country '${country}' is not allowed by policy (allowed: ${allowed}). Request blocked.`,
  checkErrorBlocked: message => `🚫 Geo-check: check failed (${message}). Request blocked.`,
  wrapNoCommand: () => '🚫 geo-guard: specify a command. Example: geo-guard claude',
  wrapSetupHint: () => '   Setup: geo-guard setup',
  wrapError: message => `🚫 geo-guard: ${message}`,
  wrapNoCountryBlocked: () =>
    '🚫 Geo-check: could not determine country (no network?). Launch blocked.',
  wrapCountryNotAllowedBlocked: (country, allowed) =>
    `🚫 Geo-check: country '${country}' is not allowed by policy (allowed: ${allowed}). Launch blocked.`,
  wrapGeoCheckOk: country => `✅ Geo-check: ${country}`,
  wrapSpawnFailed: (bin, message) => `🚫 geo-guard: failed to launch ${bin}: ${message}`,

  unknownUninstallArg: arg => `Unknown uninstall argument: ${arg}`,
  hookRemoved: file => `✅ hook removed from ${file}`,
  hookNotFound: () => '⏭  our hook was not found in settings.json',
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
  geo-guard check               hook-проверка (exit 0/2)
  geo-guard <command> [args…]   проверить гео и запустить команду

setup options:
  -y, --yes                 без вопросов (дефолты)
  -c, --countries ES,PT     разрешённые страны
  --shell zsh|bash|fish|powershell
  --hook / --no-hook
  --alias / --no-alias
  --alias-name cc           имя alias (дефолт claude; при коллизии предложит другое)

uninstall options:
  --keep-config             не удалять config.json
  -q, --quiet               меньше логов (для npm preuninstall)

Примеры:
  npm install -g geo-guard-ai
  geo-guard setup
  geo-guard setup --countries ES,PT --yes
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

  promptCountries: () => 'Разрешённые страны (ISO, через запятую)',
  promptInstallHook: () => 'Установить hook Claude Code (UserPromptSubmit)?',
  promptAddAlias: (name, shell) => `Добавить alias ${name} → geo-guard claude в ${shell}?`,
  promptShell: list => `Shell для alias (${list})`,
  promptAliasName: () => 'Имя для geo-guard alias (пусто — пропустить alias)',

  aliasConflictHeader: (file, name) => `⚠️  В ${file} уже есть свой alias '${name}':`,
  aliasWontTouch: () => '   geo-guard его не тронет.',

  configWritten: file => `✅ конфиг → ${file}`,
  allowedLine: list => `   allowed: ${list}`,
  hookInstalled: file => `✅ Claude hook → ${file}`,
  hookCommandLine: command => `   command: ${command}`,
  hookSkipped: () => '⏭  Claude hook пропущен',
  aliasInstalled: file => `✅ alias → ${file}`,
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

  checkNoCountryBlocked: () =>
    '🚫 Geo-check: не удалось определить страну (нет сети?). Запрос заблокирован.',
  checkCountryNotAllowedBlocked: (country, allowed) =>
    `🚫 Geo-check: страна '${country}' не разрешена политикой (разрешено: ${allowed}). Запрос заблокирован.`,
  checkErrorBlocked: message => `🚫 Geo-check: ошибка проверки (${message}). Запрос заблокирован.`,
  wrapNoCommand: () => '🚫 geo-guard: укажи команду. Пример: geo-guard claude',
  wrapSetupHint: () => '   Настройка: geo-guard setup',
  wrapError: message => `🚫 geo-guard: ${message}`,
  wrapNoCountryBlocked: () =>
    '🚫 Geo-check: не удалось определить страну (нет сети?). Запуск заблокирован.',
  wrapCountryNotAllowedBlocked: (country, allowed) =>
    `🚫 Geo-check: страна '${country}' не разрешена политикой (разрешено: ${allowed}). Запуск заблокирован.`,
  wrapGeoCheckOk: country => `✅ Geo-check: ${country}`,
  wrapSpawnFailed: (bin, message) => `🚫 geo-guard: не удалось запустить ${bin}: ${message}`,

  unknownUninstallArg: arg => `Неизвестный аргумент uninstall: ${arg}`,
  hookRemoved: file => `✅ hook убран из ${file}`,
  hookNotFound: () => '⏭  нашего hook в settings.json не найдено',
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
