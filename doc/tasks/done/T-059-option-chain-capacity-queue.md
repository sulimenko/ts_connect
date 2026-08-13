# Task T-059: Перевести option chain HTTP 429 в managed capacity queue без RPC 500

```ai-task-contract
version: 2
task_id: T-059
type: follow_up
human_summary: "При подтверждённом TradeStation capacity response для option chain сохранять managed subscription в общей очереди, возвращать queued state вместо RPC 500 и запускать stream после освобождения upstream slot."
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
    - application/lib/stream/optionChain.js
  forbidden_files:
    - application/test/**
    - test/**
    - tests/**
    - "**/*.test.js"
    - "**/*.spec.js"
    - application/lib/ts/stream.js
    - application/domain/ts/client.js
    - application/api/**
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
  max_files_changed: 2
  max_added_lines: 400
  max_deleted_lines: 300

commit:
  message: "queue option chains on stream capacity"
```

## Human summary

Исправить подтверждённую по runtime log ошибку получения option marketdata.

При достижении upstream capacity TradeStation возвращает для option chain:

```text
HTTP 429 Too Many Requests
classification: capacity
```

Низкоуровневый HTTP classifier уже корректно распознаёт `429` как capacity. Его менять не требуется.

Проблема находится выше по lifecycle:

```text
option chain subscribe
  -> HTTP 429 capacity
  -> managed startEntry startup failure
  -> entry removed
  -> RPC 500
  -> клиент запускает recovery
  -> recovery.skip reason=already.running
  -> повторные subscribe и новый capacity burst
```

Текущая adaptive capacity queue поддерживает только `matrix`. Для `chains` подтверждённый capacity response проходит через общий failure path.

## Runtime evidence

В `2026-08-05-W1.log` зафиксировано:

- перед первым отказом существовало десять активных option-chain streams;
- следующая подписка `PLTR` получила `429 Too Many Requests`;
- последующие попытки `PLTR`, `INTC`, `MSTR`, `AG`, `BA` и `BIDU` также получали `429`;
- capacity response сопровождался `recovery.skip reason=already.running`;
- исходный subscribe завершался RPC 500;
- reconnect нескольких существующих chains создавал дополнительный burst подписок.

Число `10` является runtime-наблюдением и не должно становиться production-константой.

## Требуемая архитектура

Обобщить существующий matrix capacity lifecycle до managed capacity queue, поддерживающей как минимум:

```text
matrix
chains
```

Предпочтительная модель:

```text
starting -> queued -> starting -> active
active/recovering -> queued -> starting -> active
```

Очередь должна оставаться domain state в:

```text
application/domain/ts/streams.js
```

`application/lib/stream/optionChain.js` отвечает только за корректное соединение option-chain adapter с managed lifecycle и статусами.

Не переносить queue state в API или низкоуровневый TradeStation adapter.

## 1. Initial option-chain capacity

При initial subscribe, если upstream возвращает ошибку с:

```text
classification: capacity
```

managed entry для `kind: chains` должен:

1. сохраниться в registry;
2. сохранить subscribers;
3. перейти в `queued`;
4. установить `upstreamReady = false`;
5. очистить завершившийся `startPromise`;
6. не считаться failed;
7. не удаляться через `startup.failed`;
8. вернуть успешный RPC result:

```text
state: queued
active: false
upstreamReady: false
resubscribeRequired: false
```

HTTP 429 не должен превращаться в RPC 500.

## 2. Capacity при reconnect

Если active или recovering option chain получает capacity при reconnect:

```text
active/recovering -> queued
```

Требования:

- остановить старый upstream stream;
- сохранить managed entry и subscribers;
- не запускать персональный reconnect timer;
- не публиковать terminal error;
- не требовать повторного subscribe от клиента;
- поставить entry в общую FIFO capacity queue.

## 3. Общая capacity queue

Заменить matrix-only queue abstraction на kind-aware managed capacity queue либо эквивалентную общую реализацию.

Queue entry должна сохранять:

```text
kind
streamKey
generation
subscribers
state
```

Требования:

- один managed entry может находиться в capacity queue не более одного раза;
- повторный subscribe с тем же `kind + streamKey` multiplex-ится в существующий entry;
- новый upstream stream для того же entry не создаётся параллельно;
- drain выполняется single-flight;
- FIFO сохраняется между queued entries;
- stale entries пропускаются;
- entry без subscribers удаляется из queue;
- generation защищает от завершения устаревшего startup;
- callback или Promise предыдущего startup не может активировать уже остановленный entry.

## 4. Освобождение upstream slot

Capacity drain должен запускаться после освобождения active managed stream из поддерживаемой capacity-группы:

- explicit unsubscribe;
- idle cleanup;
- `client.close`;
- terminal cleanup;
- остановка или замена active upstream stream.

После освобождения slot:

```text
queued -> starting
```

При успешном подключении:

```text
starting -> active
upstreamReady = true
```

Если upstream снова отвечает capacity:

```text
starting -> queued
```

Entry остаётся в queue и использует существующий bounded probe/backoff lifecycle.

Не создавать busy loop.

## 5. Matrix compatibility

Существующее поведение matrix должно сохраниться:

- `403 Stream quota exceeded` остаётся capacity;
- matrix entry сохраняется в queue;
- FIFO drain продолжает работать;
- active/queued counts остаются диагностируемыми;
- matrix reconnect capacity не становится terminal;
- subscribers не теряются.

Нельзя исправлять chains копированием второй независимой queue state machine, если общая реализация может сохранить текущий matrix contract.

## 6. Option-chain adapter

В `application/lib/stream/optionChain.js`:

- передавать capacity status в managed lifecycle без преобразования в permanent error;
- не запускать дополнительную recovery state machine поверх managed queue;
- не выполнять terminal cleanup для capacity;
- сохранять диагностируемые `kind`, `streamKey`, state и classification;
- при queued результате не считать upstream ready;
- не менять option parsing, symbol conversion или emitted `stream/chain` payload.

## 7. Error separation

Сохранить существующее разделение:

### Capacity

```text
HTTP 429
explicit stream quota/capacity signal
```

Результат:

```text
queued
retryable: true
terminal: false
resubscribeRequired: false
```

### Transient transport

Сохраняет текущий reconnect lifecycle.

### Authorization

Сохраняет authorization lifecycle и не попадает в capacity queue.

### Entitlement, invalid и permanent errors

Не должны попадать в capacity queue.

Результат остаётся terminal failure с cleanup и диагностируемой ошибкой.

## 8. Observability

Добавить или обобщить компактные lifecycle logs:

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

Не логировать tokens, secrets или полный чувствительный payload.

Старые matrix-specific log names можно сохранить для совместимости либо заменить общим названием, если diagnostics не теряются.

## Ограничения

- Не менять `application/lib/ts/stream.js`: HTTP 429 уже классифицируется как capacity.
- Не менять public API contract.
- Не менять option-chain symbol parsing.
- Не менять emitted marketdata payload.
- Не хардкодить `MAX_STREAMS = 10`.
- Не определять свободный slot только по локальному числу active streams.
- Не создавать polling с постоянным коротким интервалом.
- Не создавать персональный reconnect timer для queued entry.
- Не запускать client recovery поверх состояния `queued`.
- Не создавать новую branch.
- Не создавать новый PR.
- Не писать PR comments или reviews.
- Не добавлять и не изменять tests до пользовательской приёмки.
- Не добавлять test-only hooks.
- Не коммитить runtime log, zip, coverage или другие artifacts.

## Критерии готовности

- Initial option-chain HTTP 429 возвращает RPC success со `state: queued`.
- HTTP 429 больше не приводит к `startup.failed` и удалению managed entry.
- Subscribers сохраняются во время ожидания upstream slot.
- Одна option-chain entry не появляется в capacity queue несколько раз.
- Повторный subscribe того же `streamKey` не создаёт второй upstream stream.
- Capacity при reconnect переводит chain в `queued`, а не в terminal failure.
- После освобождения upstream slot первая валидная queued entry запускается автоматически.
- Unsubscribe queued entry полностью удаляет её из registry и queue.
- Idle cleanup queued entry не оставляет stale queue item.
- `client.close` очищает queued и active entries.
- Matrix capacity lifecycle не регрессирует.
- Authorization, entitlement, invalid и unknown permanent errors не смешиваются с capacity.
- Числовой лимит TradeStation не захардкожен.
- Не возникает reconnect/recovery storm после queued result.
- Existing `npm test` проходит без изменения test files.
- Изменены только разрешённые файлы.

## Ручная проверка после implementation

1. Создать option-chain streams до первого upstream capacity response.
2. Открыть дополнительную chain subscription.
3. Проверить ответ RPC:

```text
state: queued
active: false
upstreamReady: false
resubscribeRequired: false
```

4. Убедиться, что отсутствуют:

```text
HTTP 500
startup.failed
recovery.skip reason=already.running
```

для normal queued lifecycle.

5. Закрыть одну active chain либо дождаться idle cleanup.
6. Проверить:

```text
queue drain start
queued -> starting
starting -> active
```

7. Проверить получение `stream/chain` после активации queued entry.
8. Повторить для matrix и убедиться, что текущий lifecycle сохранился.

## PR body

<!-- ai-pr-body:start -->

# Цель

Сделать TradeStation integration устойчивой к lifecycle failures:

1. восстановить надёжную доставку и reconciliation brokerage orders;
2. обеспечить единый authorization recovery orders и positions;
3. не терять multi-leg order state и не откатывать новые stream updates устаревшим REST snapshot;
4. не завершать option-chain subscribe кодом RPC 500 при подтверждённом upstream capacity, а сохранять подписку в managed queue до освобождения stream slot.

## Согласованное поведение

### Brokerage orders

- Downstream fingerprint проходит `observed -> pending -> delivered`.
- Failed delivery возвращается в `observed`.
- Partial order packets hydrate-ятся из cache/current/historical state.
- Multi-leg partial update не удаляет ранее известные legs.
- Stream update имеет приоритет над REST snapshot, начатым раньше.
- Orders и positions используют общий single-flight authorization recovery.

### Option marketdata capacity

- HTTP 429 уже является подтверждённым capacity signal.
- Initial option-chain capacity возвращает `state: queued`, а не RPC 500.
- Managed entry и subscribers сохраняются.
- Queued chain автоматически запускается после освобождения upstream slot.
- Capacity queue поддерживает matrix и chains без числового hardcode.
- Capacity не запускает parallel client recovery или персональный reconnect storm.

Эти пункты описывают target implementation. Пользовательская приёмка результата ещё не выполнена.

## Реализованные изменения

- T-056: добавлен восстанавливаемый brokerage order stream lifecycle.
- T-056: добавлены REST orders helper, hydration и reconciliation.
- T-056: downstream queue защищена от rejected Promise и зависших concurrency slots.
- T-058: добавлена delivery state machine `observed -> pending -> delivered`.
- T-058: исправлен merge multi-leg orders.
- T-058: orders и positions подключены к общему authorization recovery.
- T-058: добавлен generation barrier между REST reconciliation и stream ingest.
- T-059: implementation option-chain managed capacity queue pending.

## Открытые gaps

- Option-chain HTTP 429 пока проходит через startup failure и RPC 500.
- Capacity queue пока ограничена matrix lifecycle.
- User acceptance для T-059 pending.
- Accepted-behavior tests для T-059 pending.

## Пользовательская приёмка

Status: pending.

Acceptance reference: none.

Принятое поведение будет зафиксировано только после явной пользовательской проверки implementation.

## Regression coverage

### Existing coverage

- Существующие tests T-056 и предыдущих stream lifecycle задач остаются regression gate.
- Existing `npm test` должен проходить без изменения test files.

### Pending after acceptance

После явной пользовательской приёмки отдельная accepted-behavior follow-up task должна покрыть:

- initial chain HTTP 429 -> queued RPC result;
- сохранение subscribers и managed entry;
- FIFO drain после освобождения slot;
- reconnect capacity -> queued;
- cleanup queued entry;
- отсутствие regression matrix capacity lifecycle.

## Validation

- T-058 head: `npm test` passed.
- T-059 implementation: `npm test` pending.
- Test files в T-059 изменяться не должны.

## Task history

- T-056 — primary brokerage order stream recovery.
- T-058 — delivery, hydration, authorization recovery и generation-barrier follow-up.
- T-059 — option-chain managed capacity queue follow-up.
<!-- ai-pr-body:end -->
