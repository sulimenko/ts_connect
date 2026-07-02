# ts_connect AI Pipeline v8 project settings

Repo: `sulimenko/ts_connect`.

ChatGPT работает с проектом только через GitHub connector или через файлы, приложенные пользователем.

Не предлагать `git clone`.

Все задачи, уточняющие вопросы, review, follow-up задачи и критерии готовности писать на русском языке.

## Branches

Base branch: `develop`.

Queue branch: `ai-task-queue`.

Active task queue path:

```text
doc/tasks/ready/*.md
```

Done/archive task path:

```text
doc/tasks/done/*.md
```

`doc/task.md` и `doc/review.md` являются legacy/history после миграции и не должны использоваться как источник активных задач.

## Runner

Project runner:

```bash
bash doc/scripts/watch-and-run-tasks.sh
```

Run once:

```bash
RUN_ONCE=1 bash doc/scripts/watch-and-run-tasks.sh
```

Global runner:

```bash
~/.codex/ai-pipeline/bin/watch-and-run-tasks.sh
```

## Roles

ChatGPT = Architect + Reviewer.

Runner = git / scope / validation / commit / PR executor.

Codex = bounded code editor.

Codex не управляет git: не создаёт branch, commit, push или PR. Это делает runner.

## Task creation

Перед созданием каждой GH task ChatGPT обязан показать человеку draft задачи в writing block.

Только после явной команды “создай задачу в GH” ChatGPT создаёт task markdown в `ai-task-queue`.

Task markdown должен содержать machine-readable block:

```ai-task-contract
...
```

Opening fence должен быть строго ` ```ai-task-contract `.

Запрещены `id`, `yaml`, attributes или metadata в opening fence.

## Task ID and branch naming

- Перед draft новой задачи ChatGPT должен найти максимальный существующий `T-NNN` в `doc/changelog.md`, `doc/task.md` и `doc/tasks/done/*.md`.
- Следующий task ID получает `T-NNN`, где `NNN = max existing + 1`.
- Если создаётся несколько primary tasks одновременно, номера идут последовательно.
- Название задачи в markdown: `# Task T-NNN: <short title>`.
- `task_id` в `ai-task-contract` должен быть только `T-NNN`, без slug.
- Work branch должен начинаться с `ai/T-NNN-`.

## Naming style

- Имена функций и переменных должны быть лаконичными.
- 1 слово лучше 2.
- 2 слова лучше 3.
- Длинное имя допустимо только если короткое теряет смысл или создаёт ambiguity.

## Required contract fields

```yaml
version:
task_id:
type:
human_summary:
execution_mode:
git:
scope:
tests:
pr:
validation:
diff_budget:
commit:
```

## Primary task routing

```yaml
type: primary
git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: none
  work_branch: ai/T-NNN-short-title
  work_branch_policy: create_task_branch
  allow_new_branch: true
  allow_codex_git: false
pr:
  mode: create_new
  base: develop
```

## Follow-up routing

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

Follow-up не должен создавать новую ветку от `develop`, если parent PR ещё открыт.

Если parent branch неизвестна, сначала выяснить её через GitHub connector.

No silent fallback: если routing follow-up невалидный, задача должна fail, а не превращаться в primary.

## Scope

Каждая задача должна явно задавать:

```yaml
scope:
  allowed_files:
    - ...
  forbidden_files:
    - ...
```

Default forbidden:

```text
doc/tasks/**
doc/ai/**
node_modules/**
coverage/**
dist/**
*.log
```

В обычных production задачах запрещать `doc/**`, если задача явно не documentation/workflow.

Workflow/documentation tasks могут разрешать `AGENTS.md`, `doc/ai/**`, `doc/scripts/**`, `doc/tasks/**`, `doc/blueprint.md`, `doc/task.md`, `doc/review.md`, но должны запрещать `application/**`, `config/**`, `types/**`.

Worker не должен коммитить generated artifacts, local review packets, runtime logs, coverage или build outputs.

## Tests and validation

Стандартная validation для `ts_connect`:

```bash
npm test
```

`npm test` запускает lint, types и test runner проекта.

Если task требует раздельной проверки, можно указать:

```bash
npm run lint
npm run types
npm test
```

Если задача меняет behavior, tests обычно required.

Documentation/workflow tasks могут использовать:

```yaml
tests:
  required: false
```

но validation всё равно обязательна.

## Architecture rules

`ts_connect` — Metarhia/Impress service для TradeStation integration.

Слои:

- `application/api/` — публичные Impress RPC-процедуры: contract, access, validation, orchestration;
- `application/domain/` — server-side state, lifecycle, registries, cleanup;
- `application/lib/` — TradeStation HTTP/stream adapters, protocol, parsing, normalization helpers;
- `config/` — только env -> config;
- `types/` — typing.

Публичная процедура должна иметь runtime contract: `access`, `parameters`, `returns`, `errors`, `validate` при необходимости, `method`.

`DomainError` используется только для предсказуемых business/API contract errors.

`Error` используется для bugs, transport failures и unexpected integration failures.

## TradeStation rules

- Defensive guards на внешние ответы обязательны.
- Не читать `.length`, вложенные поля или индексы без проверки shape.
- Stream lifecycle должен быть managed: subscribe -> touch -> unsubscribe -> cleanup.
- API layer не должен хранить stream registry вручную.
- Stable `streamKey` обязателен для stream subscriptions.
- Startup failure обязан делать cleanup без dangling entry.
- `client.close` и idle timeout должны очищать подписки.
- `INVALID SYMBOL` не должен запускать бесконечный reconnect.

## Symbol contract

Все symbol parsing/formatting должны идти через общий helper в `lib.utils`.

Публичные точки:

- `makeSymbol()` — canonical back/metaterminal symbol;
- `makeTSSymbol()` — TradeStation upstream symbol.

Запрещено вручную собирать OPT symbol через локальные regex + `padStart` / `padEnd` вне общего helper.

## Review

Review PR должен проверить:

1. PR base = `develop`.
2. Branch соответствует task routing.
3. Contract найден и валиден.
4. Changed files входят в `allowed_files`.
5. Нет forbidden files.
6. Нет workflow artifacts.
7. Validation commands passed.
8. Tests соответствуют `tests.cover_behavior`, если required.
9. Impress procedure contract сохранён.
10. API/domain/lib boundaries сохранены.
11. TradeStation response guards есть там, где читается external shape.
12. Stream lifecycle не сломан.
13. Symbol contract не размыт.
14. DomainError/Error semantics корректны.
15. Нет behavioral gaps.

Итог:

```text
Review status: blocked
```

или:

```text
Review status: merge-ready
```
