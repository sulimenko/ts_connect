# Task T-055: Исправить lifecycle matrix streams и добавить адаптивную очередь

```ai-task-contract
version: 1
task_id: T-055
type: primary
human_summary: "Сделать startup и lifecycle stream/matrix правдивыми: initial HTTP failure не должен становиться active subscription, capacity-подобная ошибка должна переводить подписку в адаптивную очередь без хардкода лимита, а listeners, timers и registry entries должны полностью очищаться."
execution_mode: codex

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: none
  work_branch: ai/T-055-matrix-stream-lifecycle
  work_branch_policy: create_task_branch
  allow_new_branch: true
  allow_codex_git: false

scope:
  allowed_files:
    - application/domain/ts/streams.js
    - application/api/stream/matrix.js
    - application/domain/ts/client.js
    - application/lib/ts/stream.js
    - application/test/run.js
  forbidden_files:
    - doc/**
    - node_modules/**
    - coverage/**
    - dist/**
    - package.json
    - package-lock.json
    - "*.log"
    - "*.zip"
    - metaterminal/**
    - application/api/marketdata/**
    - application/domain/ts/barcharts.js

tests:
  required: true
  cover_behavior:
    - "Успешный initial matrix startup возвращает active=true только после подтверждённого HTTP connection и создаёт один upstream stream."
    - "Initial HTTP failure не оставляет ложное состояние active=true или upstreamReady=true."
    - "Capacity-подобная ошибка переводит подписку в queued без персонального reconnect timer."
    - "Queued subscription автоматически стартует после освобождения upstream slot."
    - "Очередь FIFO, но stale или уже отменённая подписка не запускается."
    - "Unsubscribe queued subscription полностью удаляет её из очереди и registry."
    - "Authorization, entitlement, invalid request и permanent errors не попадают в очередь."
    - "Transient transport errors используют bounded reconnect и не смешиваются с capacity queue."
    - "HTTP error сохраняет status, statusText, безопасный response body и релевантные headers для классификации."
    - "Два subscribers одного streamKey используют один startPromise и один upstream stream."
    - "Удаление одного subscriber не останавливает multiplex stream, удаление последнего полностью очищает ресурсы."
    - "Количество close listeners остаётся bounded после большого числа matrix subscribe/unsubscribe cycles."
    - "Unsubscribe и client close во время reconnect backoff отменяют следующий connection attempt."
    - "Stale reconnect generation не может восстановить удалённый или заменённый stream."
    - "Существующие GoAway, INVALID SYMBOL и bounded option-chain retry tests не регрессируют."
  allowed_files:
    - application/test/run.js

pr:
  mode: create_new
  base: develop

validation:
  commands:
    - npm run lint
    - npm run types
    - npm test

diff_budget:
  max_files_changed: 5
  max_added_lines: 800
  max_deleted_lines: 400

commit:
  message: "fix adaptive matrix stream lifecycle"
```

## Контекст

В текущем lifecycle initial HTTP error внутри `lib.ts.stream` логируется и запускает reconnect, но не отклоняет startup наружу. Из-за этого domain/client и managed streams считают startup успешным, сохраняют upstream handle и могут вернуть `active=true`, даже когда состояние уже `failed`.

Дополнительно каждая managed subscription добавляет отдельный `close` listener на downstream Metacom client. При 11-й подписке возникает `MaxListenersExceededWarning`, хотя это само по себе не доказывает upstream-лимит TradeStation.

В runtime также наблюдался `403 Forbidden` после серии успешных matrix streams. Нельзя хардкодить лимит `10`: он не подтверждён контрактом и может зависеть от аккаунта, окружения или типа stream.

## Цель

Исправить startup, reconnect и cleanup lifecycle matrix streams и реализовать адаптивную очередь, которая реагирует на capacity-подобный ответ upstream без заранее заданного числового лимита.

## Требуемое поведение

### 1. Правдивый initial startup

- `initiateStream()` должен завершаться успешно только после реального HTTP connection.
- Initial HTTP failure должен быть возвращён вызывающему слою как `Error` с нормализованными данными ответа.
- Managed subscription не может иметь `active=true` или `upstreamReady=true`, если initial connection не установлен.
- Низкоуровневый stream handle сохранять в `domain.ts.client` только после успешного initial startup.

### 2. Нормализация HTTP ошибок

Для HTTP failure сохранить в объекте ошибки:

- `status`;
- `statusText`;
- ограниченный по размеру безопасный response body;
- только релевантные headers, например `retry-after`, request/correlation identifiers и rate-limit headers.

Не логировать access token, authorization headers и другие credentials.

### 3. Классификация ошибок

Разделить как минимум:

- authorization/authentication;
- entitlement/permission;
- invalid request или invalid symbol/instrument;
- capacity/rate-limit-like response;
- transient transport/server failure;
- unknown forbidden/unknown HTTP failure.

`DomainError` не использовать для transport/integration failures. Это остаются обычные `Error`.

### 4. Адаптивная capacity queue

Не вводить константу `MAX_MATRIX_STREAMS = 10` и не считать warning EventEmitter доказательством upstream capacity.

Если новая matrix subscription получает capacity-подобную ошибку при наличии уже работающих matrix streams:

- перевести entry в `queued`;
- вернуть `active=false`, `upstreamReady=false`;
- не создавать персональный reconnect timer;
- сохранить subscription и subscriber, чтобы она могла стартовать после освобождения slot;
- поставить её в FIFO queue.

Когда активный matrix stream полностью остановлен из-за последнего unsubscribe, idle cleanup или client close:

- запустить ровно один общий drain queue;
- попытаться стартовать первую актуальную queued subscription;
- при успехе удалить её из очереди и перевести в `active`;
- при повторном capacity response оставить queued и применить один общий bounded backoff/probe, а не таймер на каждую entry;
- при permanent/auth/entitlement/invalid error удалить entry из очереди, завершить её как failed и уведомить subscribers через существующий error path.

Если queued subscription потеряла всех subscribers до запуска, удалить её без upstream request.

### 5. Защита от races и stale retries

- Использовать generation/token guard для startup, reconnect и queue drain.
- Старый reconnect или queue probe не может восстановить entry после unsubscribe, client close, replacement или нового generation.
- Одновременные subscribe одного `streamKey` должны использовать один `startPromise` и один upstream stream.
- Queue drain должен быть single-flight.

### 6. Listener lifecycle

Не исправлять warning через `setMaxListeners()`.

Сделать количество `close` listeners bounded:

- предпочтительно один listener на downstream client с fan-out cleanup всех его subscriptions;
- либо эквивалентный механизм с доказуемо симметричным add/remove lifecycle.

После unsubscribe, failed startup, idle cleanup и client close не должны оставаться stale listeners.

### 7. State invariants

Зафиксировать и соблюдать:

- `active` означает подтверждённый работающий upstream connection;
- `upstreamReady=true` допустим только после successful initial connection;
- `queued` всегда имеет `active=false` и `upstreamReady=false`;
- `failed` не может возвращаться как active subscription;
- stopped/removed entry не может быть восстановлена старым timer или promise;
- одна entry имеет не более одного upstream stream.

### 8. Observability

Добавить структурированные логи без credentials:

- классификация ошибки;
- переходы `starting -> active`, `starting -> queued`, `queued -> starting`, `queued -> failed`, `active -> stopping`;
- текущие `activeMatrixCount` и `queuedMatrixCount`;
- число активных streams в момент capacity response как наблюдаемое значение, но не как установленный контрактный лимит;
- причина queue drain и результат попытки;
- отмена stale generation/reconnect/probe.

Логи должны позволить после реального запуска определить фактическое поведение TradeStation и наблюдаемый предел без изменения кода.

## API/domain/lib boundaries

- `application/api/stream/matrix.js`: runtime contract, orchestration и перевод результата domain в публичный ответ; без собственного registry, queue или reconnect state.
- `application/domain/ts/streams.js`: subscriptions, multiplex, entry state, FIFO queue, cleanup, listener lifecycle и single-flight coordination.
- `application/domain/ts/client.js`: хранение успешно открытых low-level streams и их stop lifecycle.
- `application/lib/ts/stream.js`: HTTP stream, parsing, heartbeat, error normalization и низкоуровневый reconnect policy.

Не изменять публичный Impress error contract молча. Если корректная реализация требует нового публичного business error, остановиться и описать необходимость в отчёте runner вместо самостоятельного расширения контракта.

## Тесты

Добавить детерминированные тесты минимум для следующих сценариев:

1. Successful initial matrix startup.
2. Initial 403 не становится `active` и не оставляет stored stream.
3. Смоделированный capacity response переводит entry в `queued`.
4. Освобождение одного active stream запускает ровно одну queued entry.
5. Повторный capacity response сохраняет очередь и создаёт только один общий probe/backoff.
6. Authorization/entitlement/invalid response не попадает в очередь.
7. FIFO порядок для нескольких queued entries.
8. Unsubscribe queued entry до запуска удаляет её без upstream request.
9. Два subscribers одного key используют один startup и один upstream.
10. Один subscriber уходит — upstream продолжает работать; последний уходит — полный cleanup.
11. Не менее 20 разных subscribe/unsubscribe cycles не увеличивают число `close` listeners без границ.
12. Client close очищает active и queued entries, timers, listeners и stored streams.
13. Stale reconnect generation и stale queue drain не восстанавливают удалённый stream.
14. Failed или queued state никогда не возвращает `active=true`/`upstreamReady=true`.
15. Существующие GoAway, INVALID SYMBOL и option-chain retry tests проходят без регрессий.

Тесты не должны делать реальные запросы к TradeStation.

## Ручная проверка после merge

На реальном аккаунте последовательно открыть matrix streams до первого capacity-подобного ответа и проверить по логам:

- сколько upstream streams было активно перед ответом;
- response status/body/headers и выбранную классификацию;
- переход новой подписки в `queued`;
- отсутствие reconnect storm;
- автоматический старт queued subscription после закрытия одного active stream;
- отсутствие роста `close` listeners.

Результат ручной проверки используется для наблюдения реального лимита, но не для хардкода числа в production-коде.

## Критерии готовности

- Initial HTTP failure больше не маскируется как successful subscribe.
- `failed` и `queued` entries не имеют `active=true` или `upstreamReady=true`.
- Capacity-подобная ошибка использует адаптивную FIFO queue без фиксированного лимита 10.
- Очередь автоматически продвигается после освобождения upstream slot.
- Нет персонального reconnect storm для queued entries.
- Permanent/auth/entitlement/invalid errors не застревают в queue.
- Listener count bounded; `setMaxListeners()` не используется как исправление.
- Все timers, listeners, registry entries и stored streams очищаются при unsubscribe, failure, idle и client close.
- API/domain/lib boundaries сохранены.
- В изменённых production-файлах нет ручной сборки option symbols.
- `npm run lint`, `npm run types`, `npm test` проходят.

## Отчёт runner

В PR указать:

- root cause;
- реализованную классификацию HTTP errors;
- алгоритм adaptive queue и queue drain;
- state invariants;
- способ ограничения `close` listeners;
- добавленные тесты;
- результаты validation;
- фактический changed-files scope;
- известные ограничения и что необходимо проверить на реальном TradeStation аккаунте.
