# Task T-060: Завершить drain capacity queue и корректно освобождать slot при terminal cleanup

```ai-task-contract
version: 2
task_id: T-060
type: follow_up
human_summary: "Устранить зависание оставшихся option-chain и matrix subscriptions после успешного запуска первой queued entry, корректно освобождать capacity slot при terminal cleanup и восстановить обязательный полный PR body."
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
    - application/domain/ts/streams.js
  forbidden_files:
    - application/test/**
    - test/**
    - tests/**
    - "**/*.test.js"
    - "**/*.spec.js"
    - application/api/**
    - application/lib/**
    - application/domain/queue.js
    - application/domain/ts/client.js
    - application/domain/ts/orders.js
    - config/**
    - types/**
    - doc/**
    - node_modules/**
    - coverage/**
    - dist/**
    - logs/**
    - artifacts/**
    - "*.log"
    - "*.zip"

tests:
  phase: implementation
  required: false
  user_acceptance_required: true
  acceptance_reference: none
  cover_behavior: []
  allowed_files: []

pr:
  mode: update_existing_parent_pr
  base: develop
  description_mode: replace_from_task
  comments_allowed: false

validation:
  commands:
    - npm test

diff_budget:
  max_files_changed: 1
  max_added_lines: 220
  max_deleted_lines: 160

commit:
  message: "finish managed capacity queue drain"
```

## Human summary

T-059 корректно перевёл initial option-chain HTTP 429 в managed `queued` state и объединил matrix/chains в общую capacity queue, но review обнаружил два реальных lifecycle gap и один workflow blocker.

### Gap 1: оставшаяся queue теряет probe после первого успешного запуска

Текущий `drainCapacity()` извлекает первую queued entry и после результата `active` сразу возвращает `true`.

При этом успешный `startEntry()`:

- удаляет только текущую entry из queue;
- сбрасывает probe delay;
- не планирует продолжение, если в queue остаются другие entries.

Проблемный сценарий:

```text
capacityQueue = [A, B, C]
client.close или массовый cleanup освобождает несколько upstream slots
один drain запускает A
A становится active
drain завершается
B и C остаются queued без capacityProbe
```

B и C не должны зависеть от случайного будущего unsubscribe или stop другой entry.

### Gap 2: terminal cleanup не распознаёт освобождённый capacity slot

Сейчас permanent error проходит через:

```text
notifyError()
stopEntry()
```

`notifyError()` заранее меняет:

```text
state = failed
upstreamReady = false
```

После этого `stopEntry()` вычисляет `wasActive` через текущее presentation state и ошибочно решает, что active slot не освобождался.

В результате queued entry не запускается после terminal cleanup ранее активного chain или matrix stream.

### Gap 3: PR body не был заменён

PR #13 всё ещё содержит только:

```text
Automated PR from AI Pipeline v8 contract.
```

T-060 должна сохранить `pr.description_mode: replace_from_task` и передать runner полный replacement из раздела `## PR body`.

Если runner не может заменить PR body, task должна завершиться fail, а не считаться выполненной.

## Требуемое поведение

### 1. Явно отслеживать владение capacity slot

Не определять факт освобождения slot только через текущие:

```text
entry.state
entry.upstreamReady
```

Ввести минимальный внутренний lifecycle marker либо эквивалентную модель, которая однозначно показывает, что managed entry реально удерживает upstream capacity slot.

Требования:

- новый entry не удерживает slot;
- initial capacity response не удерживает slot;
- успешный upstream startup отмечает slot как занятый;
- переход active/recovering -> queued освобождает marker;
- terminal cleanup активного upstream stream считается освобождением slot, даже если `notifyError()` уже изменил presentation state;
- `stopEntry()` очищает marker ровно один раз;
- stale startup не может вернуть marker остановленной entry;
- queued entry не может считаться занимающей slot.

Не вводить числовой лимит TradeStation.

### 2. Продолжать bounded обработку оставшейся queue

После успешного запуска одной queued entry:

- если queue пуста — завершить drain без нового timer;
- если queue не пуста — гарантировать последующее bounded продолжение;
- продолжение может выполняться новым adaptive probe либо эквивалентным безопасным механизмом;
- не запускать параллельные drain;
- не создавать synchronous busy loop;
- не сбрасывать backoff так, чтобы оставшаяся queue создавала burst запросов;
- не терять FIFO;
- одна entry не должна находиться в queue более одного раза.

После capacity response следующая попытка использует существующий bounded backoff.

После успешного запуска можно сбросить backoff для будущего независимого capacity cycle только так, чтобы уже оставшиеся entries всё равно получили запланированную попытку.

### 3. Обработать массовое освобождение slots

Сценарии:

- `client.close`;
- несколько последовательных unsubscribe;
- idle cleanup;
- terminal cleanup;
- закрытие активных matrix/chains entries.

должны приводить к тому, что очередь продолжает продвигаться без случайного внешнего события.

Если одним lifecycle action освобождено несколько slots, разрешено запускать entries последовательно через bounded probe. Не требуется угадывать фактическое число свободных upstream slots.

### 4. Terminal cleanup должен запускать drain

Если active managed stream завершился permanent/terminal error:

1. error/status остаётся диагностируемым;
2. upstream stream останавливается;
3. entry удаляется из registry;
4. capacity ownership очищается;
5. если очередь не пуста, запускается bounded drain/probe.

Authorization, invalid, entitlement и другие permanent classifications не должны попадать в capacity queue, но освобождение их ранее занятого stream slot должно продвигать уже существующую queue.

### 5. Сохранить T-059 behavior

Не регрессировать:

- initial option-chain HTTP 429 возвращает `state: queued`;
- RPC 500 для normal capacity lifecycle отсутствует;
- subscribers и metadata сохраняются;
- queued touch возвращает `retryable: true`;
- `resubscribeRequired: false`;
- reconnect capacity переводит entry в queue;
- matrix `403 Stream quota exceeded` остаётся capacity;
- chains и matrix используют общую FIFO queue;
- stale generation не активирует остановленную entry;
- queued unsubscribe и `client.close` очищают registry/queue;
- отсутствует hardcoded capacity limit.

## Observability

Сохранить компактные logs:

```text
event
kind
streamKey
state
classification
queueLength
activeCount
subscriberCount
generation
reason
```

При необходимости добавить только минимальный безопасный marker:

```text
capacityHeld
```

Не логировать tokens, secrets или чувствительные payload.

## Ограничения

- Изменять только `application/domain/ts/streams.js`.
- Не менять option-chain adapter.
- Не менять низкоуровневый `lib.ts.stream`.
- Не менять API, client recovery, symbol parsing или emitted payload.
- Не добавлять tests до явной пользовательской приёмки.
- Не создавать test-only hooks.
- Не создавать новый branch или PR.
- Не писать PR comments, inline comments или review submissions.
- Не коммитить logs, coverage, archives или generated artifacts.
- Не исправлять старый GitHub comment: единственный актуальный GitHub-side документ — PR body.

## Критерии готовности

- После успешного запуска A entries B и C не остаются queued без probe.
- Queue продолжает FIFO processing через bounded mechanism.
- Нет параллельных `capacityDrain`.
- Нет synchronous retry loop.
- Terminal cleanup ранее active entry продвигает queue.
- `notifyError()` не скрывает факт освобождения занятого slot.
- Capacity ownership очищается ровно один раз.
- Initial и reconnect capacity не считаются занятым slot.
- `client.close` с несколькими active и queued entries не оставляет живые queued entries без дальнейшей попытки.
- Matrix behavior T-059 не регрессирует.
- Option-chain HTTP 429 behavior T-059 не регрессирует.
- Изменён только разрешённый файл.
- Existing `npm test` проходит без изменения tests.
- PR body полностью заменён содержимым из этой task.

## Ручная проверка после implementation

1. Создать минимум три queued entries: A, B, C.
2. Освободить несколько active slots одним `client.close`.
3. Убедиться, что:
   - A запускается;
   - B и C остаются в FIFO;
   - для оставшейся queue существует bounded continuation;
   - B запускается без дополнительного ручного subscribe/unsubscribe.
4. Смоделировать terminal cleanup active entry при непустой queue.
5. Убедиться, что следующая queued entry получает попытку запуска.
6. Проверить initial chain 429:
   - RPC success;
   - `state: queued`;
   - `active: false`;
   - `upstreamReady: false`;
   - `resubscribeRequired: false`.
7. Проверить matrix capacity lifecycle.
8. Проверить, что PR #13 содержит полный body ниже.

## PR body

<!-- ai-pr-body:start -->

# Цель

Сделать TradeStation integration устойчивой к lifecycle failures:

1. восстановить надёжную доставку и reconciliation brokerage orders;
2. обеспечить единый authorization recovery orders и positions;
3. не терять multi-leg order state и не откатывать новые stream updates устаревшим REST snapshot;
4. при upstream option-marketdata capacity сохранять managed subscription в очереди вместо RPC 500;
5. гарантировать, что общая chains/matrix capacity queue продолжает bounded FIFO processing после освобождения slots и terminal cleanup.

## Согласованное поведение

### Brokerage orders

- Downstream fingerprint проходит `observed -> pending -> delivered`.
- Failed delivery возвращается в `observed`.
- Partial order packets hydrate-ятся из cache/current/historical state.
- Multi-leg partial update не удаляет ранее известные legs.
- Stream update имеет приоритет над REST snapshot, начатым раньше.
- Orders и positions используют общий single-flight authorization recovery.

### Option marketdata capacity

- HTTP 429 является capacity signal.
- Initial option-chain capacity возвращает managed `state: queued`, а не RPC 500.
- Managed entry, subscribers и metadata сохраняются.
- Queued chain автоматически запускается после освобождения upstream slot.
- Matrix и chains используют общую FIFO capacity queue без числового hardcode.
- Успешный запуск одной queued entry не оставляет остальные entries без bounded continuation.
- Terminal cleanup ранее active stream продвигает очередь.
- Capacity ownership отслеживается независимо от presentation state.
- Capacity lifecycle не запускает parallel client recovery или reconnect storm.

Пользовательская приёмка результата T-059/T-060 ещё не выполнена.

## Реализованные изменения

- T-056: добавлен восстанавливаемый brokerage order stream lifecycle.
- T-056: добавлены REST orders helper, hydration и reconciliation.
- T-056: downstream queue защищена от rejected Promise и зависших concurrency slots.
- T-058: добавлена delivery state machine `observed -> pending -> delivered`.
- T-058: исправлен merge multi-leg orders.
- T-058: orders и positions подключены к общему authorization recovery.
- T-058: добавлен generation barrier между REST reconciliation и stream ingest.
- T-059: initial/reconnect option-chain capacity переведён в managed queue.
- T-059: matrix и chains объединены в общую adaptive FIFO capacity queue.
- T-060: добавлено bounded продолжение оставшейся queue после успешного запуска entry.
- T-060: освобождение capacity slot отделено от изменяемых `state/upstreamReady`.
- T-060: terminal cleanup и массовое освобождение slots продвигают очередь.

## Открытые gaps

- Нет известных implementation gaps.
- User acceptance pending.
- Accepted-behavior tests pending.

## Пользовательская приёмка

Status: pending.

Acceptance reference: none.

Результат должен быть проверен на runtime option-chain capacity до создания accepted-behavior test task.

## Regression coverage

### Existing coverage

- Существующие tests T-056 и предыдущих stream lifecycle задач остаются regression gate.
- T-059 и T-060 не изменяют test files.

### Pending after acceptance

После явной пользовательской приёмки отдельная accepted-behavior follow-up task должна покрыть:

- initial option-chain HTTP 429 -> queued RPC result;
- сохранение subscribers и managed entry;
- FIFO drain после освобождения slot;
- продолжение queue после первого успешного startup;
- terminal cleanup active stream -> запуск следующей queued entry;
- cleanup queued entry;
- отсутствие regression matrix capacity lifecycle.

## Validation

- `npm test` — passed для T-060 перед завершением task.
- Tests в implementation phase не изменялись.

## Task history

- T-056 — primary brokerage order stream recovery.
- T-058 — delivery, hydration, authorization recovery и generation-barrier follow-up.
- T-059 — option-chain managed capacity queue follow-up.
- T-060 — capacity queue continuation и terminal slot release follow-up.
<!-- ai-pr-body:end -->
