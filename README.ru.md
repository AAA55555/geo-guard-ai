# geo-guard-ai

[![npm version](https://img.shields.io/npm/v/geo-guard-ai.svg)](https://www.npmjs.com/package/geo-guard-ai)

[English](./README.md) · **Русский**

**Гео-ограничение для AI CLI.** Разрешает запуск Claude Code (или другой команды) только если твой внешний IP резолвится в разрешённую страну. Если ты не там, где нужно, — блокирует ещё до отправки промпта.

Так же гейтит чат **Cursor** (IDE и `cursor-agent`) — через собственный конфиг hooks, см. [Cursor](#cursor) ниже.

Кроссплатформенно: **macOS / Linux / Windows**. TypeScript, рантайм — Node 18+.

Язык CLI — **английский или русский**, определяется автоматически по локали машины (`LC_ALL` / `LC_MESSAGES` / `LANG`), по умолчанию английский. Принудительно: `GEO_GUARD_LANG=en|ru`.

---

## Зачем это нужно

Иногда работать с AI-инструментом можно только из определённой страны — из-за политики компании, условий заказчика, юрисдикции или личного правила «не работаю не оттуда». Проблема в том, что легко забыть: VPN отвалился, уехал, сеть переключилась — а ты продолжаешь работать как ни в чём не бывало.

`geo-guard-ai` — это **страховка от «случайно продолжил не оттуда»**. Он проверяет страну по внешнему IP в двух точках:

| Точка контроля | Что делает |
|---|---|
| **Запуск команды** | `geo-guard claude …` (обычно через alias `claude`) сначала проверяет страну, и только если она разрешена — запускает Claude Code |
| **Каждый промпт** | Claude Code hook `UserPromptSubmit` вызывает `geo-guard check` перед отправкой каждого промпта; страна не разрешена → промпт блокируется (exit 2) |

Вторая точка важна: сессию можно запустить в разрешённой стране, а через час VPN отвалится — hook поймает это на следующем промпте.

### Покрытие

| Где | Гейтится через |
|---|---|
| Терминал / встроенный терминал IDE | alias `claude` → обёртку `geo-guard claude` |
| Панель расширения Claude Code | hook `UserPromptSubmit` в `~/.claude/settings.json` |
| Чат Cursor (IDE) | hook `beforeSubmitPrompt` в `~/.cursor/hooks.json` |
| `cursor-agent` | тот же hook в `~/.cursor/hooks.json` |

**Поведение fail-closed:** нет сети или ни один провайдер не ответил → блок. Лучше перебдеть.

## Как работает

1. Внешний IP → страна (ISO-код) через публичные провайдеры (`ifconfig.co`, `ipinfo.io` по умолчанию). Провайдеры опрашиваются **параллельно** — побеждает первый валидный ответ (`Promise.any`).
2. Страна сверяется со списком `allowed`.

Проверка всегда **свежая** — без кэша. Каждый вызов `check` (то есть каждый промпт) заново определяет страну, поэтому отвал VPN ловится на следующем же промпте, а не через какое-то окно.

## Чем это НЕ является

Это **не механизм безопасности**, а бытовая страховка. Обходится тривиально:

- запуском `claude` в обход alias (`geo-guard`-обёртки),
- удалением hook (Claude Code или Cursor),
- любым VPN в разрешённой стране.

Смысл — не «защитить», а не дать *случайно* продолжить работу не оттуда.

---

## Установка

```bash
npm install -g geo-guard-ai
geo-guard setup
```

`setup` в интерактиве спросит:

1. **разрешённые страны** (ISO через запятую, дефолт `NL`);
2. ставить ли **Claude Code hook** (дефолт да);
3. ставить ли **hook Cursor** — спрашивается, только если есть `~/.cursor` (дефолт да);
4. добавить ли **alias `claude` → `geo-guard claude`** в rc текущего shell (дефолт да).

Без вопросов (CI / скрипты):

```bash
geo-guard setup --countries ES,PT --yes
```

С `--yes` hook Cursor ставится автоматически **только если `~/.cursor` уже существует**; передай `--cursor`, чтобы поставить его в любом случае (например, готовишь машину заранее, до установки самого Cursor), или `--no-cursor`, чтобы пропустить:

```bash
geo-guard setup --yes --cursor      # принудительно, даже без ~/.cursor
geo-guard setup --yes --no-cursor   # пропустить
```

Повторный `setup` **не сбрасывает** кастомные `timeoutMs` / `providers` в конфиге — обновляет только `allowed`.

### Как сменить страну

```bash
geo-guard setup -y -c NL
```

Хуки и алиас не трогаются (повторный `setup` идемпотентен). Разовая проверка без записи в конфиг: `GEO_GUARD_ALLOWED=NL geo-guard check`.

## Alias и коллизии

Пойнт установки — сделать так, чтобы привычная команда `claude` шла через проверку. Для этого в rc пишется помеченный маркерами блок:

```sh
# >>> geo-guard-ai begin >>>
alias claude="geo-guard claude"
# <<< geo-guard-ai end <<<
```

**Если у тебя уже есть свой `alias claude`** (или функция) — geo-guard его *не трогает*:

- в интерактиве предложит другое имя (по умолчанию `cc`) или пропустить alias;
- в `--yes` автоматически подберёт свободное имя (`cc`, `ccg`, …) и скажет какое.

Задать имя явно:

```bash
geo-guard setup --alias-name cc      # запускать Claude Code через `cc`
```

Чужие alias вроде `cc` / `c`, если они уже заняты не нами, тоже не перезаписываются — берётся следующее свободное имя.

### Shells

Автоопределение по `$SHELL` (на Windows — PowerShell). Поддерживаются **zsh, bash, fish, powershell**.

| Shell | Файл |
|---|---|
| zsh | `~/.zshrc` |
| bash | `~/.bashrc` (на macOS login-shell читает `~/.bash_profile` — при необходимости добавь туда `source ~/.bashrc`) |
| fish | `~/.config/fish/config.fish` |
| PowerShell | `$PROFILE` (`Documents/PowerShell/…` или `~/.config/powershell/…`) |

Принудительно: `geo-guard setup --shell zsh`, либо `GEO_GUARD_SHELL=bash` / `GEO_GUARD_RC=/path/to/rc`.

После setup перечитай rc:

```bash
source ~/.zshrc   # или свой файл
```

## Cursor

Cursor (чат IDE и `cursor-agent`) сам читает конфиги hooks от Claude Code — `~/.claude/settings.json` и проектные аналоги — и импортирует найденные там хуки. Это односторонний импорт при загрузке, а не синхронизация; управляется собственной настройкой Cursor **Third-Party Imports** (по умолчанию включена).

`geo-guard setup` (если есть `~/.cursor`, или с флагом `--cursor`) также пишет hook `beforeSubmitPrompt` прямо в `~/.cursor/hooks.json`, с `failClosed: true`:

```json
{
  "version": 1,
  "hooks": {
    "beforeSubmitPrompt": [
      { "command": "geo-guard check", "timeout": 10, "failClosed": true }
    ]
  }
}
```

Cursor дедуплицирует хуки, импортированные из Claude Code, против хуков, уже объявленных в его собственном конфиге, сравнивая точную строку команды. Поскольку `geo-guard setup` пишет одинаковую команду `geo-guard check` в оба файла, проверка всё равно уходит **один раз за промпт**, а не дважды — явная запись побеждает, а импортированная копия отбрасывается. Убедиться в этом можно в логе хуков Cursor (панель Output → канал hooks): ищи строку `Removed duplicate claude-user hook for beforeSubmitPrompt: command:geo-guard check`.

**`failClosed: true`** означает, что любой сбой hook блокирует промпт — сетевая ошибка, таймаут (10с), крах, **или отсутствие бинаря `geo-guard` в PATH** (exit 127). Последний случай стоит знать отдельно: если пакет снесли не через `geo-guard uninstall` / `npm uninstall -g geo-guard-ai` (например, `--ignore-scripts`, ручное удаление каталога установки, смена версии Node, из-за которой пропал глобальный bin), чат Cursor перестаёт работать полностью — блокируется каждый промпт — пока запись не будет убрана вручную.

**Как выйти из этого состояния:** открой `~/.cursor/hooks.json` (и, для симметрии, `~/.claude/settings.json`) в текстовом редакторе и удали запись hook с `geo-guard check` руками. `geo-guard uninstall` делает то же самое программно, но он не запустится, если причина этого состояния как раз в том, что бинарь пропал.

**Если Third-Party Imports выключен**, импорт из `~/.claude/settings.json` вообще не происходит — тогда явная запись в `~/.cursor/hooks.json` от `geo-guard setup` остаётся *единственным*, что гейтит Cursor, и продолжает работать штатно.

Чтобы увидеть ровно то, что видит хост hook, направь stdout в пайп: `geo-guard check | cat`. На успехе печатает ровно `{"continue":true}` без завершающего перевода строки (это общий контракт `geo-guard check` на любом неинтерактивном stdout, а не особенность Cursor — Claude Code видит те же байты). В интерактивном терминале stdout остаётся пустым, а `✔ geo-check ok` идёт в stderr.

Управляется только **глобальный** `~/.cursor/hooks.json`; проектный `.cursor/hooks.json` вне объёма.

Проверено на: Cursor 3.15.6, `cursor-agent 2026.07.09-a3815c0`, Claude Code 2.1.227.

## Команды

```bash
geo-guard setup [options]       # настройка
geo-guard uninstall [options]   # убрать hook + alias + конфиг
geo-guard check                 # проверка для hook (exit 0 = ок, 2 = блок)
geo-guard claude [args…]        # обёртка: проверить гео и запустить claude
geo-guard <command> [args…]     # то же для любой команды
geo-guard --help
```

`setup`-опции:

| Опция | Значение |
|---|---|
| `-y, --yes` | без вопросов, дефолты |
| `-c, --countries ES,PT` | разрешённые страны |
| `--shell zsh\|bash\|fish\|powershell` | целевой shell для alias |
| `--alias-name cc` | имя alias (дефолт `claude`; при коллизии предложит другое) |
| `--hook` / `--no-hook` | ставить/не ставить hook Claude Code |
| `--cursor` / `--no-cursor` | ставить/не ставить hook Cursor (дефолт: ставить, если есть `~/.cursor`) |
| `--alias` / `--no-alias` | ставить/не ставить alias |

## Конфиг

JSON:

- macOS/Linux: `~/.config/geo-guard-ai/config.json`
- Windows: `%APPDATA%\geo-guard-ai\config.json`

```json
{
  "allowed": ["NL"],
  "timeoutMs": 5000,
  "providers": [
    "https://ifconfig.co/country-iso",
    "https://ipinfo.io/country"
  ]
}
```

Env перекрывает файл:

| Переменная | Назначение |
|---|---|
| `GEO_GUARD_ALLOWED` | `ES,PT` |
| `GEO_GUARD_TIMEOUT` | таймаут запроса к провайдеру, **секунды** (в файле `timeoutMs` — миллисекунды) |
| `GEO_GUARD_PROVIDERS` | URL провайдеров через пробел (пусто → провайдеров нет → блок) |
| `GEO_GUARD_REAL_BIN` | явный путь к целевому бинарю (в обход поиска в PATH) |
| `GEO_GUARD_CONFIG_DIR` | каталог конфига |
| `GEO_GUARD_CONFIG_FILE` | путь к `config.json` |
| `GEO_GUARD_SHELL` / `GEO_GUARD_RC` | shell / файл для alias. Если `GEO_GUARD_RC` задан, `uninstall` работает **только** с этим файлом и не трогает системные rc |
| `GEO_GUARD_LANG` | принудительный язык CLI (`en`, `ru`) в обход автоопределения локали машины |

Провайдер должен отдавать двухбуквенный ISO-код страны текстом (`ES`). Ответ не в формате `^[A-Za-z]{2}$` игнорируется. В `allowed` тоже принимаются **только** ISO alpha-2 (`ES`, `PT`); значения вроде `SPAIN` / `ESP` отклоняются при `setup` и отбрасываются при загрузке конфига. Пустой список `providers` (`[]`) означает «провайдеров нет» → страна не определяется → блок.

## Удаление

```bash
geo-guard uninstall               # hook + alias во всех rc + конфиг
geo-guard uninstall --keep-config # то же, но config.json оставить
geo-guard uninstall -q            # тихо (без вывода), напр. для скриптов
npm uninstall -g geo-guard-ai     # удалить сам пакет
```

> ⚠️ Сначала запусти `geo-guard uninstall`, потом `npm uninstall`. В npm 7+ скрипт `preuninstall` **не выполняется**, поэтому `npm uninstall` сам по себе не снимет хуки и alias — они останутся висеть в `~/.claude/settings.json`, `~/.cursor/hooks.json` и в rc.

`geo-guard uninstall` убирает **только то, что добавлял пакет**:

- наш hook в `~/.claude/settings.json`;
- наш hook в `~/.cursor/hooks.json`;
- маркер-блок alias (`# >>> geo-guard-ai begin >>>` …) во всех известных rc;
- `config.json` и пустой каталог конфига.

Если сам бинарь `geo-guard` пропал (см. [Cursor](#cursor) → `failClosed`), `geo-guard uninstall` не запустится — убери записи hook из обоих файлов вручную.

Безопасность при удалении:

- **чужие alias** (`cc` / `c` / твой собственный `claude`) не трогаются;
- по умолчанию обходятся все известные rc (`~/.zshrc`, `~/.bashrc`, …). Если задан `GEO_GUARD_RC` — только он: системные rc в этом случае не читаются и не пишутся;
- если наш маркер-блок alias **правили вручную** (внутри маркеров не то, что мы туда писали) — он **остаётся как есть**, uninstall его не сносит, а предупреждает. Мало ли что важное туда добавили;
- наши записи hook и в `settings.json`, и в `hooks.json` убираются **по совпадению строки команды**, одинаково в обоих файлах — даже если ты руками поправил `timeout` или дописал флаг, запись всё равно распознается и уберётся; автоматический `.bak` — твоя страховка, если это не то, чего ты хотел;
- остальной `settings.json` / `hooks.json` и оба `.bak`-файла не трогаются.

## Проверка

```bash
geo-guard check; echo $?                          # 0 — ок
GEO_GUARD_ALLOWED=XX geo-guard check; echo $?     # 2 — блок (ты не в XX)
geo-guard check | cat                             # то, что видит хост hook на успехе: {"continue":true}
geo-guard claude --version                        # обёртка запускает claude
```

## Разработка

```bash
npm install          # husky + build (prepare)
npm run typecheck
npm run build
npm test
npm run test:e2e      # настоящий CLI против песочного $HOME, только POSIX
npm run test:pack     # npm pack → установка тарбола → смоук-тест
```

Git hooks (Husky):

- **pre-commit** — `npm run typecheck`
- **pre-push** — `npm run typecheck && npm test && npm run test:e2e && npm run test:pack`

### Ручной чек-лист перед релизом

`test:e2e` работает в песочном `$HOME`, поэтому не видит, как *настоящие* Cursor / Claude Code читают *настоящие* конфиги. Перед релизом, на машине с обоими установленными:

1. `geo-guard setup --cursor` → заблокировать промпт в чате Cursor из запрещённой страны → убедиться, что блокирует нашим текстом, и что в логе hooks видна строка `Removed duplicate claude-user hook for beforeSubmitPrompt: command:geo-guard check` (панель Output → канал hooks) — признак того, что проверка ушла один раз, а не дважды.
2. Выключить в Cursor настройку **Third-Party Imports** → блокировка выше должна продолжать работать, теперь чисто через `~/.cursor/hooks.json`.
3. `geo-guard check | cat` → байт в байт `{"continue":true}`, без завершающего перевода строки и лишнего вывода.

Лицензия — [MIT](./LICENSE).
