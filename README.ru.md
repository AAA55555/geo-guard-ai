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
geo-guard config --countries NL
```

Трогает **только** `config.json` — rc и оба hook-конфига не задеваются. `geo-guard setup -y -c NL` тоже сработает, но он заново проходит всю установку; для рутинной смены лучше `config`.

`setup` больше ничего не сбрасывает без спроса: запуск без `--countries` оставляет настроенный список как есть (и `timeoutMs`, и `providers`, и профили тоже).

Разовая проверка без записи в конфиг: `GEO_GUARD_ALLOWED=NL geo-guard check`.

### Как вернуть дефолты

```bash
geo-guard config --reset                  # весь конфиг, вместе с профилями
geo-guard config --reset --profile cursor # только один профиль (то же, что --unset)
```

`--reset` оставляет `config.json` ровно таким, каким его делает свежая установка: `allowed: ["NL"]`, дефолтные `timeoutMs` и `providers`, без `profiles`. Ничего не переустанавливает и не удаляет — hook-конфиги, alias и rc не трогаются, так что, в отличие от `uninstall`, защита продолжает работать, просто по дефолтной политике.

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

**Если ты дописал в наш alias свои флаги** — например:

```bash
# >>> geo-guard-ai begin >>>
alias claude="geo-guard claude --dangerously-skip-permissions"
# <<< geo-guard-ai end <<<
```

— повторный `geo-guard setup` (например, чтобы поменять страны) **его не перезапишет**. Файл rc вообще не трогается, setup просто сообщает об этом и идёт дальше. Пересобирается только блок, который побайтово совпадает с тем, что мы генерируем, — чтобы обновления пакета могли менять формат сниппета.

То же с чужим содержимым, если его положили между нашими маркерами: остаётся как есть, с предупреждением.

Вернуться к дефолтному alias — явным флагом:

```bash
geo-guard setup --force-alias
```

Твои `timeout` / `statusMessage` / `failClosed` в записях hook (`~/.claude/settings.json`, `~/.cursor/hooks.json`) переживают повторный запуск точно так же — переписывается только `command`.

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
geo-guard config [options]      # показать / изменить разрешённые страны
geo-guard check                 # проверка для hook (exit 0 = ок, 2 = блок)
geo-guard claude [args…]        # обёртка: проверить гео и запустить claude
geo-guard <command> [args…]     # то же для любой команды
geo-guard -- <command> [args…]  # то же, если имя похоже на подкоманду
geo-guard --help
```

`setup`-опции:

| Опция | Значение |
|---|---|
| `-y, --yes` | без вопросов, дефолты |
| `-c, --countries ES,PT` | разрешённые страны |
| `--shell zsh\|bash\|fish\|powershell` | целевой shell для alias |
| `--alias-name cc` | имя alias (дефолт `claude`; при коллизии предложит другое) |
| `--force-alias` | перезаписать alias-блок, который правил вручную (по умолчанию — сохраняется) |
| `--hook` / `--no-hook` | ставить/не ставить hook Claude Code |
| `--cursor` / `--no-cursor` | ставить/не ставить hook Cursor (дефолт: ставить, если есть `~/.cursor`) |
| `--alias` / `--no-alias` | ставить/не ставить alias |
| `--claude-countries ES,PT` | страны только для Claude Code (см. [Разные страны для разных инструментов](#разные-страны-для-разных-инструментов)) |
| `--cursor-countries PL` | страны только для Cursor |

Опции `config` — меняют политику, **не трогая** ни rc, ни оба hook-конфига:

| Опция | Значение |
|---|---|
| *(без опций)* | показать эффективный конфиг |
| `-c, --countries ES,PT` | задать разрешённые страны |
| `-p, --profile claude\|cursor` | применить только к этому инструменту |
| `--unset --profile cursor` | убрать профиль; инструмент вернётся к общему списку |
| `--reset` | вернуть всё к дефолтам, все профили удалить |
| `--reset --profile cursor` | то же, что `--unset --profile cursor` |

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
| `GEO_GUARD_ALLOWED_CLAUDE` / `GEO_GUARD_ALLOWED_CURSOR` | то же самое, но только для одного инструмента (аналогично `GEO_GUARD_TIMEOUT_*` / `GEO_GUARD_PROVIDERS_*`) — см. [Разные страны для разных инструментов](#разные-страны-для-разных-инструментов) |
| `GEO_GUARD_PROFILE` | задать профиль для `geo-guard check` принудительно (`claude`, `cursor`) |
| `GEO_GUARD_REAL_BIN` | явный путь к целевому бинарю (в обход поиска в PATH) |
| `GEO_GUARD_CONFIG_DIR` | каталог конфига |
| `GEO_GUARD_CONFIG_FILE` | путь к `config.json` |
| `GEO_GUARD_SHELL` / `GEO_GUARD_RC` | shell / файл для alias. Если `GEO_GUARD_RC` задан, `uninstall` работает **только** с этим файлом и не трогает системные rc |
| `GEO_GUARD_LANG` | принудительный язык CLI (`en`, `ru`) в обход автоопределения локали машины |

Провайдер должен отдавать двухбуквенный ISO-код страны текстом (`ES`). Ответ не в формате `^[A-Za-z]{2}$` игнорируется. В `allowed` тоже принимаются **только** ISO alpha-2 (`ES`, `PT`); значения вроде `SPAIN` / `ESP` отклоняются при `setup` и отбрасываются при загрузке конфига. Пустой список `providers` (`[]`) означает «провайдеров нет» → страна не определяется → блок.

### Разные страны для разных инструментов

По умолчанию Claude Code и Cursor живут по одной политике. Если им нужно разойтись — добавляется **профиль**: необязательная секция `profiles`, которая переопределяет общий уровень для одного инструмента:

```json
{
  "allowed": ["NL", "DE"],
  "timeoutMs": 5000,
  "profiles": {
    "cursor": { "allowed": ["PL"] }
  }
}
```

Тут Claude Code разрешён из NL/DE, а Cursor — из PL. Профиль может переопределять `allowed`, `timeoutMs` и `providers`; что не указано — наследуется с общего уровня. Конфиг без `profiles` работает ровно как раньше.

Задаётся из CLI, ни rc, ни hook-конфиги при этом не трогаются:

```bash
geo-guard config                                   # показать эффективную политику по инструментам
geo-guard config --countries NL,DE                 # общий список
geo-guard config --countries PL --profile cursor   # только Cursor
geo-guard config --unset --profile cursor          # вернуть к общему списку
```

```
Конфиг: ~/.config/geo-guard-ai/config.json
  общее    allowed: NL, DE   timeout: 5s   (из файла)
  claude   allowed: NL, DE   (наследует)
  cursor   allowed: PL   (свой профиль)
```

Метка показывает, откуда список взялся на самом деле, чтобы переменная окружения в шелле не читалась как настройка из файла: при заданном `GEO_GUARD_ALLOWED_CURSOR=CN` строка cursor скажет `(перебито GEO_GUARD_ALLOWED_CURSOR)`. На содержимое файла env не влияет никогда.

`setup` тоже умеет — сразу при установке: `geo-guard setup --countries NL,DE --cursor-countries PL`, либо ответом на вопрос *«Для Cursor нужен отдельный список стран?»* в интерактиве.

Приоритет, от высшего:

1. `GEO_GUARD_ALLOWED_CLAUDE` / `GEO_GUARD_ALLOWED_CURSOR` (и аналоги `_TIMEOUT_` / `_PROVIDERS_`)
2. `GEO_GUARD_ALLOWED` и соседи
3. `profiles.<инструмент>` в `config.json`
4. верхний уровень `config.json`
5. встроенные дефолты

**Как hook понимает, кто его позвал.** Флагом в команде это сделать нельзя: Cursor импортирует хуки Claude Code и выбрасывает те, чья строка команды побайтово совпадает с его собственной, — именно это совпадение и оставляет одну проверку на промпт вместо двух (см. [Cursor](#cursor)). Поэтому в обоих файлах остаётся одинаковый `geo-guard check`, а профиль определяется в рантайме по JSON, который хост пишет хуку в stdin: Claude Code присылает `hook_event_name: "UserPromptSubmit"`, Cursor — `"beforeSubmitPrompt"`. Это фактический хост, из какого бы файла ни пришла запись.

Если в stdin вообще ничего не пришло — значит `geo-guard check` запустили руками в терминале — применяется **общая** политика, поведение ровно как до появления профилей. Если хост что-то прислал, но опознать его не удалось (мусор или незнакомое имя события), применяется **самая строгая** политика: только те страны, которые разрешены и общим списком, и каждым настроенным профилем. Угадывать, какому инструменту какая политика, — ровно тот случай, где стоит падать в закрытую сторону.

Стоит понимать, чем это оборачивается при непересекающихся списках: `claude: ["NL"]` и `cursor: ["PL"]` в пересечении дают пустоту, то есть неопознанный хост заблокирует каждый промпт. Падать мы хотим именно в эту сторону, но если будущая версия любого из инструментов переименует своё событие, ты увидишь тотальную блокировку, а не предупреждение. `geo-guard check --profile claude` сразу покажет, в этом ли дело.

Профиль можно задать явно, для отладки:

```bash
geo-guard check --profile cursor     # или GEO_GUARD_PROFILE=cursor
```

Когда профилей нигде не настроено, stdin не читается вообще — обычная конфигурация за это не платит.

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

`setup` проверяет всё, что может отказать, **до** первой записи: если `~/.claude/settings.json` или `~/.cursor/hooks.json` — невалидный JSON либо секция хуков не той формы, которую пишут эти инструменты (например, в `"UserPromptSubmit"` лежит строка), ты получишь сообщение с именем файла и ключа, и ничего не изменится вообще. geo-guard не переписывает данные, которых не понимает, и не оставляет тебя с конфигом, но без хука. Непонятные записи *внутри* корректного списка просто обходятся и остаются на месте.

Безопасность при удалении:

- **чужие alias** (`cc` / `c` / твой собственный `claude`) не трогаются;
- по умолчанию обходятся все известные rc (`~/.zshrc`, `~/.bashrc`, …). Если задан `GEO_GUARD_RC` — только он: системные rc в этом случае не читаются и не пишутся;
- наш маркер-блок снимается, даже если ты дописал в alias свои флаги (`geo-guard claude --dangerously-skip-permissions` — всё ещё наш alias). Но если внутри маркеров лежит **чужое** — вообще не `geo-guard`-alias — блок **остаётся как есть**: uninstall его не сносит, а предупреждает. Мало ли что важное туда добавили;
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
4. С **разными странами по инструментам** (`geo-guard config --countries <разрешённая> --profile claude` и `--countries <запрещённая> --profile cursor`): промпт в Claude Code проходит, промпт в Cursor блокируется; поменять списки местами и убедиться, что поведение зеркалится. Это единственная проверка того, что определение хоста в рантайме работает против настоящих хостов — профиль читается из payload, который каждый из них пишет в stdin, а `test:e2e` этих payload не видит вовсе. Заодно убедиться, что строка `Removed duplicate claude-user hook` в логе hooks Cursor всё ещё на месте: если она пропала, два конфига разъехались и Cursor гоняет проверку дважды на каждый промпт.

Лицензия — [MIT](./LICENSE).
