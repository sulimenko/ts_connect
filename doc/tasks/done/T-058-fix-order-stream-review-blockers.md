# Task T-058: Закрыть delivery, hydration и brokerage recovery blockers в PR T-056

```ai-task-contract
version: 1
task_id: T-058
type: follow_up
human_summary: "Исправить 4 критических behavioral race-condition и state consistency проблемы в order stream pipeline без добавления тестов до пользовательской приёмки."
execution_mode: codex

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: ai/T-056-order-stream-recovery
  work_branch_policy: continue_parent_branch
  allow_new_branch: false
  allow_codex_git: false

scope:
  allowed_files:
    - application/domain/queue.js
    - application/domain/ts/client.js
    - application/domain/ts/orders.js
  forbidden_files:
    - application/test/**
    - doc/**
    - config/**
    - types/**
    - node_modules/**
    - coverage/**
    - dist/**
    - logs/**
    - artifacts/**
    - "*.log"

tests:
  required: false

pr:
  mode: update_existing_parent_pr
  base: develop

validation:
  commands:
    - npm test

diff_budget:
  max_files_changed: 3
  max_added_lines: 450
  max_deleted_lines: 250

commit:
  message: "fix T-056 review blockers"
```

# Human summary

Исправить 4 критических проблемы, выявленных в review PR #13:

1. неправильная фиксация delivery state (fingerprint lifecycle);
2. некорректный merge multi-leg orders;
3. неполный authorization recovery для positions stream;
4. race condition между REST reconciliation и stream ingest.

# 1. Delivery state: разделить observed / pending / delivered

## Проблема

Сейчас fingerprint фиксируется как "обработанный" до фактического успешного downstream POST.

Это приводит к потере событий при:

- downstream failure;
- retry reconciliation;
- повторном stream ingest.

## Требуемая модель

Ввести строгую state machine:

```text
observed -> pending -> delivered
```

## Поведение

- `observed` — получен stream / REST order;
- `pending` — поставлен в queue, но не подтверждён downstream;
- `delivered` — успешно отправлен downstream.

## Правила

- fingerprint нельзя ставить в queue, если он уже `pending`;
- `delivered` — финальное состояние для идемпотентного подавления;
- при failure выполнять `pending -> observed`;
- reconciliation может повторно поставить только `observed`;
- запрещено считать delivery успешным до callback success.

## Queue contract

Queue task должен иметь completion hooks:

```js
{
  endpoint,
  data,
  onSuccess,
  onFailure,
}
```

Требования:

- callback вызывается ровно один раз;
- callback не блокирует queue;
- callback не влияет на освобождение concurrency slot;
- исключения внутри callback не ломают pipeline.

# 2. Merge multi-leg orders без потери данных

## Проблема

`Legs: []` или partial update может стереть существующие legs.

## Требуемая логика

### Merge rules

- `undefined Legs` — оставить старые;
- `[]` — не очищать legs, интерпретировать как partial update;
- partial array обновляет только совпадающие элементы и не удаляет отсутствующие legs;
- итоговая длина массива не меньше `max(previous.length, incoming.length)`.

### Leg identity

- если в TradeStation payload есть стабильный identifier, использовать его;
- иначе применять index-based merge;
- не вводить guess-based identity.

### Validation rule

Order считается complete только если каждый leg имеет непустой `Symbol` после merge.

# 3. Authorization recovery для orders и positions

## Проблема

Positions stream не участвует в unified recovery flow.

## Требуемое поведение

При любой authorization failure выполнить single-flight recovery:

1. сбросить `brokerage.ready = false`;
2. остановить stale streams orders и positions;
3. вызвать один `recoverBrokerage({ authorization: true })`;
4. выполнить token refresh под single-flight lock;
5. пересоздать orders и positions streams;
6. не оставлять stale positions stream entry;
7. не допускать параллельные recovery.

Обработать authorization failure:

- при initial startup;
- в `onError`;
- в terminal `onStatus`;
- после reconnect failure.

Permanent non-authorization failure не должен запускать token refresh или бесконечный reconnect.

# 4. REST reconciliation race condition

## Выбранная архитектура: generation barrier

Generation barrier выбран как минимально инвазивный вариант, который не блокирует stream ingest и не требует buffering stream events.

## Проблема

Возможен сценарий:

```text
1. REST snapshot started
2. stream emits new state FLL
3. REST returns old state ACK
4. old state overwrites new state
```

Результат — rollback order state.

## Решение: generation-based monotonic barrier

Ввести account-level ingest generation, например:

```text
account.orderGeneration
```

или эквивалентное состояние в domain order registry.

## Правила generation

### Stream ingest

При каждом принятом stream update увеличивать generation и сохранять generation вместе с order state.

### REST reconciliation start

При старте snapshot фиксировать:

```text
snapshotGeneration = currentGeneration
```

### REST snapshot apply

Перед применением snapshot проверять:

```text
if snapshotGeneration < currentGeneration:
  snapshot is stale
```

Stale snapshot не может перезаписать order state, обновлённый stream после начала REST request.

## Поведение при конфликте

Разрешено:

- игнорировать stale snapshot;
- один раз повторить reconciliation;
- применить safe backfill только для отсутствующих orders, не перезаписывая существующие более новые states.

Повтор должен быть bounded. Нельзя создавать polling или бесконечный retry loop.

## Дополнительная защита

При apply snapshot:

- сравнивать per-order fingerprint и сохранённую generation;
- не перезаписывать state с более новой generation;
- REST использовать как backfill, а не как безусловный source of truth поверх stream.

## Запрещено

- использовать `Date.now()` как порядок версий;
- считать REST response новее только потому, что Promise завершился позже;
- подавлять stream events во время reconciliation;
- блокировать stream ingestion;
- позволять REST snapshot откатывать newer stream state.

## Итоговая гарантия

- stream update имеет приоритет над REST snapshot, начатым раньше;
- REST остаётся backfill-механизмом;
- rollback order state из-за concurrent reconciliation невозможен.

# Ограничения

- Не изменять `application/test/**`.
- Не добавлять tests, fixtures или test-only hooks.
- Не создавать новую branch.
- Не создавать новый PR.
- Не писать комментарии в PR.
- Не менять PR description в рамках этой implementation-задачи.
- Не использовать `DomainError` для transport, queue или lifecycle failures.
- Не менять symbol contract.
- Не добавлять polling timers.
- Не добавлять blind retries.
- Не коммитить generated artifacts.

# Критерии готовности

- fingerprint не считается delivered до success callback;
- reconciliation может повторно отправить failed order;
- delivered fingerprint не дублируется;
- один fingerprint не находится одновременно в нескольких queue tasks;
- `Legs: []` не стирает ранее известные legs;
- partial update одного leg не удаляет остальные legs multi-leg order;
- positions и orders используют общий single-flight authorization recovery;
- одновременные authorization failures orders и positions приводят к одному refresh/recovery;
- REST snapshot не может перезаписать newer stream state;
- система сохраняет monotonic order state при concurrent reconciliation и stream ingest;
- existing `npm test` проходит без изменения test files;
- изменены только разрешённые production-файлы.
