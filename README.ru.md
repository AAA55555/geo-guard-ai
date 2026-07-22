# geo-guard-ai

[English](./README.md) · **Русский**

**Гео-ограничение для AI CLI.** Разрешает запуск Claude Code (или другой команды) только если твой внешний IP резолвится в разрешённую страну. Если ты не там, где нужно, — блокирует ещё до отправки промпта.

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

**Поведение fail-closed:** нет сети или ни один провайдер не ответил → блок. Лучше перебдеть.

## Как работает

1. Внешний IP → страна (ISO-код) через публичные провайдеры (`ifconfig.co`, `ipinfo.io` по умолчанию). Провайдеры опрашиваются **параллельно** — побеждает первый валидный ответ (`Promise.any`).
2. Страна сверяется со списком `allowed`.

Проверка всегда **свежая** — без кэша. Каждый вызов `check` (то есть каждый промпт) заново определяет страну, поэтому отвал VPN ловится на следующем же промпте, а не через какое-то окно.

## Чем это НЕ является

Это **не механизм безопасности**, а бытовая страховка. Обходится тривиально:

- запуском `claude` в обход alias (`geo-guard`-обёртки),
- удалением hook,
- любым VPN в разрешённой стране.

Смысл — не «защитить», а не дать *случайно* продолжить работу не оттуда.

---

## Установка

```bash
npm install -g geo-guard-ai
geo-guard setup
```

`setup` в интерактиве спросит:

1. **разрешённые страны** (ISO через запятую, дефолт `ES`);
2. ставить ли **Claude Code hook** (дефолт да);
3. добавить ли **alias `claude` → `geo-guard claude`** в rc текущего shell (дефолт да).

Без вопросов (CI / скрипты):

```bash
geo-guard setup --countries ES,PT --yes
```

Повторный `setup` **не сбрасывает** кастомные `timeoutMs` / `providers` в конфиге — обновляет только `allowed`.

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
| `--hook` / `--no-hook` | ставить/не ставить Claude hook |
| `--alias` / `--no-alias` | ставить/не ставить alias |

## Конфиг

JSON:

- macOS/Linux: `~/.config/geo-guard-ai/config.json`
- Windows: `%APPDATA%\geo-guard-ai\config.json`

```json
{
  "allowed": ["ES"],
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

> ⚠️ Сначала запусти `geo-guard uninstall`, потом `npm uninstall`. В npm 7+ скрипт `preuninstall` **не выполняется**, поэтому `npm uninstall` сам по себе не снимет hook и alias — они останутся висеть в `~/.claude/settings.json` и в rc.

`geo-guard uninstall` убирает **только то, что добавлял пакет**:

- наш hook в `~/.claude/settings.json`;
- маркер-блок alias (`# >>> geo-guard-ai begin >>>` …) во всех известных rc;
- `config.json` и пустой каталог конфига.

Безопасность при удалении:

- **чужие alias** (`cc` / `c` / твой собственный `claude`) не трогаются;
- по умолчанию обходятся все известные rc (`~/.zshrc`, `~/.bashrc`, …). Если задан `GEO_GUARD_RC` — только он: системные rc в этом случае не читаются и не пишутся;
- если наш маркер-блок **правили вручную** (внутри маркеров не то, что мы туда писали) — он **остаётся как есть**, uninstall его не сносит, а предупреждает. Мало ли что важное туда добавили;
- остальной `settings.json` и `settings.json.bak` не трогаются.

## Проверка

```bash
geo-guard check; echo $?                          # 0 — ок
GEO_GUARD_ALLOWED=XX geo-guard check; echo $?     # 2 — блок (ты не в XX)
geo-guard claude --version                        # обёртка запускает claude
```

## Разработка

```bash
npm install          # husky + build (prepare)
npm run typecheck
npm run build
npm test
```

Git hooks (Husky):

- **pre-commit** — `npm run typecheck`
- **pre-push** — `npm run typecheck && npm test`

Лицензия — [MIT](./LICENSE).
