# ts_connect

Локальные правила `ts_connect` для AI Pipeline v8.

Repo: `sulimenko/ts_connect`.

Всегда писать задачи, уточняющие вопросы, review, follow-up задачи и критерии готовности на русском языке.

## Документация

- `doc/blueprint.md` — архитектурные правила, слои, контракт процедур, stream lifecycle.
- `doc/openapi_20260411.md` — компактный индекс и дополнение по snapshot TradeStation OpenAPI от 2026-04-11.
- `doc/ai/chatgpt/project-settings.md` — правила AI Pipeline v8 для проекта.
- `doc/ai/chatgpt/task-template.md` — шаблон task contract.
- `doc/ai/chatgpt/review-checklist.md` — review-checklist для PR.
- `doc/tasks/ready/*.md` — активные задачи для runner.
- `doc/tasks/done/*.md` — закрытые/перенесённые task files.
- `doc/task.md` — legacy task history после миграции.
- `doc/review.md` — legacy review history после миграции.
- `doc/changelog.md` — архив закрытых задач и заключений.

## Repo access

ChatGPT работает с `sulimenko/ts_connect` только через GitHub connector или через файлы, приложенные пользователем.

Не предлагать `git clone` для `ts_connect`.

Если нужен локальный запуск, проверка, runner или git-команды — команды даются пользователю или Local Watcher.

## AI Pipeline v8

Base branch: `develop`.

Queue branch: `ai-task-queue`.

Project runner:

```bash
bash doc/scripts/watch-and-run-tasks.sh
```

Run once:

```bash
RUN_ONCE=1 bash doc/scripts/watch-and-run-tasks.sh
```

Runner читает `ai-task-contract` как источник правды.

Активные задачи создаются только в:

```text
doc/tasks/ready/*.md
```

`doc/task.md` больше не является источником активных задач.

## Роли

ChatGPT = Architect + Reviewer.

Runner = git / scope / validation / commit / PR executor.

Codex = bounded code editor.

Codex не управляет git: не создаёт branch, commit, push или PR. Это делает runner.

ChatGPT не меняет production code напрямую, кроме явного запроса пользователя.

## Создание задач

Перед созданием каждой GH task ChatGPT обязан сначала показать человеку draft задачи в writing block.

Только после явной команды “создай задачу в GH” ChatGPT создаёт task markdown в `ai-task-queue`.

Task markdown должен содержать machine-readable block:

```ai-task-contract
...
```

Opening fence должен быть строго ` ```ai-task-contract ` без `id`, `yaml`, attributes или metadata.

Обязательные поля contract:

- `version`
- `task_id`
- `type`
- `human_summary`
- `execution_mode`
- `git`
- `scope`
- `tests`
- `pr`
- `validation`
- `diff_budget`
- `commit`

## Git routing

Primary task:

```yaml
type: primary
git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: none
  work_branch_policy: create_task_branch
  allow_new_branch: true
  allow_codex_git: false
pr:
  mode: create_new
  base: develop
```

Follow-up к открытому PR:

```yaml
type: follow_up
git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: ai/T-XXX-...
  work_branch_policy: continue_parent_branch
  allow_new_branch: false
  allow_codex_git: false
pr:
  mode: update_existing_parent_pr
  base: develop
```

Follow-up создаётся только после review результата и только при реальном gap.

No silent fallback: если routing follow-up невалидный, задача должна fail, а не превращаться в primary.

## Scope

Каждая задача должна явно задавать `allowed_files` и `forbidden_files`.

По умолчанию запрещать:

- `doc/tasks/**`
- `doc/ai/**`
- `node_modules/**`
- `coverage/**`
- `dist/**`
- generated logs / artifacts

В обычных production задачах запрещать `doc/**`, если задача явно не documentation/workflow.

## Слои

- `application/api/` — публичные Impress RPC-процедуры: contract, access, validation, orchestration; не хранит state, не делает reconnect.
- `application/domain/` — server-side state, lifecycle, registries, cleanup, multiplex subscriptions.
- `application/lib/` — TradeStation HTTP/stream adapters, protocol, parsing, normalization helpers.
- `config/` — только `process.env` -> config; без бизнес-логики.
- `types/` — global/service typing.

## TradeStation

- OAuth lifecycle: `lib.ts.refresh` -> `access_token` + `expires`; auto-refresh до expiry.
- Stream lifecycle: subscribe -> touch -> unsubscribe; idle cleanup; `client.close` cleanup.
- `domain.ts.clients` — single-flight setup через `connecting[name]` + `waiters[name]`.
- `domain.ts.streams` — multiplex подписчиков, stable `streamKey`.
- `lib.ts.stream` — upstream HTTP stream с reconnect, heartbeat, JSON line parser.
- Defensive guards на shape ответов TradeStation обязательны.
- `INVALID SYMBOL` не должен запускать бесконечный reconnect.
- `GoAway` / `StreamStatus: 'GoAway'` остаются transient stream events, для которых reconnect ожидаем.

## Symbol contract

- Все symbol parsing/formatting должны идти через `lib.utils`.
- Основные точки входа: `makeSymbol()` и `makeTSSymbol()`.
- `makeSymbol()` возвращает canonical back/metaterminal symbol.
- `makeTSSymbol()` возвращает TradeStation upstream symbol.
- Не собирать OPT symbol вручную через локальные regex + `padStart` / `padEnd` в endpoint-ах, stream parsers или response mappers.

## Impress

- Файлы экспортируют единственную функцию или объект: `({...}) => { ... }` или `({ ... })`.
- Глобальные пространства: `lib.*`, `domain.*`, `config.*`, `application.*`.
- Нельзя делать import-time side effects в файлах, которые загружает общий aggregator.
- Один файл = одна функция в `application/lib/name/`.
- Не помещать несколько функций в один `lib/` файл через object export.
- `domain` файлы экспортируют объект `({...})` с методами и state как registry/singleton.
- Методы `domain` используют `this.*` для доступа к state объекта.

## Ошибки

- `DomainError` — только для предсказуемых бизнес-ошибок публичного контракта.
- `Error` — для багов, transport failures и unexpected integration failures.

## Validation

Стандартная validation:

```bash
npm test
```

При необходимости явно:

```bash
npm run lint
npm run types
npm test
```

## Review

Review должен проверить:

- branch/base;
- task contract compliance;
- changed files vs allowed/forbidden scope;
- отсутствие workflow artifacts;
- validation;
- tests, если required;
- Impress procedure contract;
- API/domain/lib boundaries;
- TradeStation response guards;
- stream lifecycle;
- symbol contract;
- DomainError vs Error;
- реальные behavioral gaps.

Итог писать строго одним из вариантов:

```text
Review status: blocked
```

```text
Review status: merge-ready
```
