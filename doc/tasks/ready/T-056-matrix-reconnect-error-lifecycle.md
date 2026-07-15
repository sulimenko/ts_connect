# Task T-056: Исправить HTTP error lifecycle при reconnect matrix stream

```ai-task-contract
version: 1
task_id: T-056
type: follow_up
human_summary: "Исправить blocker из review PR #10: capacity и permanent HTTP errors во время reconnect должны попадать в корректный domain lifecycle, а rate-limit headers и 5xx должны классифицироваться без ложного перевода в capacity queue."
execution_mode: codex

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: ai/T-055-matrix-stream-lifecycle
  work_branch: ai/T-055-matrix-stream-lifecycle
  work_branch_policy: continue_parent_branch
  allow_new_branch: false
  allow_codex_git: false

scope:
  allowed_files:
    - application/domain/ts/streams.js
    - application/lib/ts/stream.js
    - application/test/run.js
  forbidden_files:
    - doc/**
    - application/api/**
    - application/domain/ts/client.js
    - application/domain/ts/clients.js
    - application/domain/ts/barcharts.js
    - config/**
    - types/**
    - node_modules/**
    - coverage/**
    - dist/**
    - package.json
    - package-lock.json
    - "*.log"
    - "*.zip"
    - metaterminal/**

tests:
  required: true
  cover_behavior:
    - "HTTP capacity response во время reconnect останавливает персональный low-level reconnect и переводит managed matrix entry в queued."
    - "Queued entry после reconnect capacity имеет active=false и upstreamReady=false."
    - "Authorization, entitlement, invalid и unknown forbidden во время reconnect становятся permanent failure и полностью очищают managed/stored stream state."
    - "Только transient HTTP и transport failures продолжают bounded reconnect."
    - "429 классифицируется как capacity."
    - "x-ratelimit-*, ratelimit-* и rate-limit-* headers распознаются корректно."
    - "503 с Retry-After остаётся transient, если body явно не сообщает о concurrent stream capacity."
    - "5xx с явным capacity body может классифицироваться как capacity только при подтверждающем upstream signal."
    - "Capacity reconnect не создаёт персональный reconnect timer одновременно с общим matrix queue probe."
    - "Permanent reconnect failure не оставляет reconnect timer, heartbeat timer, stored stream, managed entry или close listener."
    - "Существующие initial startup, adaptive FIFO queue, GoAway, INVALID SYMBOL и option-chain retry tests не регрессируют."
  allowed_files:
    - application/test/run.js

pr:
  mode: update_existing_parent_pr
  base: develop

validation:
  commands:
    - npm run lint
    - npm run types
    - npm test

diff_budget:
  max_files_changed: 3
  max_added_lines: 300
  max_deleted_lines: 180

commit:
  message: "fix matrix reconnect error lifecycle"
```

## Контекст

Review PR #10 выявил два blocker.

### Blocker 1: reconnect HTTP errors обходят adaptive queue

Initial HTTP failure корректно выбрасывается в `startEntry()`, но HTTP failure при последующем reconnect обрабатывается одинаково для всех classifications: отправляется `recovering`, запускается персональный `scheduleReconnect()`, capacity response не передаётся domain для перехода entry в `queued`, а authorization, entitlement, invalid и forbidden также продолжают reconnect.

### Blocker 2: rate-limit headers классифицируются неточно

Код сохраняет `x-ratelimit-*`, `ratelimit-*` и `rate-limit-*`, но classification покрывает не все варианты. Также `503 Retry-After` не должен автоматически считаться capacity: это transient outage, если body или иной явный upstream signal не подтверждает concurrent-stream capacity.

## Требуемое исправление

### 1. Передавать reconnect outcome в domain lifecycle

Low-level stream должен сообщать domain результат reconnect через существующий status/error callback без изменения публичного Impress RPC contract.

Для reconnect HTTP failure:

- `capacity`: остановить персональный low-level reconnect; передать internal status/error для перехода managed matrix entry в `queued`; установить `active=false`, `upstreamReady=false`; дальнейшие попытки выполнять только общим matrix queue drain/probe;
- `authorization`, `entitlement`, `invalid`, `forbidden`: permanent stop, уведомление существующего error path и полный cleanup entry, stored stream, listeners и timers;
- `transient`: оставить bounded exponential reconnect; managed entry остаётся `recovering`; после успешного reconnect возвращается в `active`.

Не создавать новый `DomainError`: это transport/integration failures.

### 2. Не допускать двойной retry orchestration

После capacity classification не должны одновременно существовать low-level `reconnectTimer`, matrix `matrixProbe` и независимая попытка reconnect той же entry. Единственным владельцем повторной попытки capacity entry должен быть domain matrix queue scheduler.

### 3. Исправить HTTP classification

Минимальные правила:

- `401`, token/auth body -> `authorization`;
- явное entitlement/permission body -> `entitlement`;
- invalid request/symbol/instrument -> `invalid`;
- `429` -> `capacity`;
- явный concurrent/capacity/stream-limit body -> `capacity`;
- rate-limit headers являются дополнительным capacity signal преимущественно для `403`/`429`, но не превращают любой `5xx` в capacity;
- `408`, `425`, `5xx` -> `transient`, если нет явного capacity body;
- неизвестный `403` -> `forbidden`.

Поддержать headers `retry-after`, `ratelimit-*`, `x-ratelimit-*`, `rate-limit-*`.

### 4. Managed stream transition

Добавить или использовать явный internal transition:

```text
active/recovering -> queued
```

При переходе:

- остановить и удалить текущий stored low-level stream;
- не удалять subscribers;
- оставить managed entry в registry;
- поставить entry в FIFO queue один раз;
- отменить stale generation и low-level timers;
- не отправлять terminal `stream/error`, пока entry находится в capacity queue.

Permanent reconnect failure должен завершать entry через существующий cleanup path.

## Тесты

Добавить детерминированные тесты минимум для:

1. Активный matrix stream получает `429` при reconnect -> entry становится `queued`.
2. Capacity body в `403` при reconnect -> entry становится `queued`.
3. Capacity entry не имеет low-level reconnect timer после передачи в queue.
4. Общий matrix probe остаётся единственным retry scheduler.
5. `401` при reconnect -> permanent cleanup.
6. Entitlement `403` при reconnect -> permanent cleanup.
7. Unknown `403` при reconnect -> permanent cleanup, не queue.
8. Invalid request при reconnect -> permanent cleanup.
9. `503 Retry-After` -> transient reconnect, не queue.
10. `503` с явным concurrent capacity body -> capacity queue.
11. `x-ratelimit-remaining`, `ratelimit-remaining` и `rate-limit-remaining` распознаются.
12. Успешный reconnect после transient failure возвращает managed entry в `active`.
13. Stale reconnect callback не может изменить остановленную или queued entry.
14. Все существующие тесты T-055 продолжают проходить.

Тесты не должны обращаться к реальному TradeStation.

## Критерии готовности

- Capacity HTTP failure во время reconnect использует adaptive queue.
- Для capacity entry нет персонального reconnect storm.
- Permanent HTTP failure во время reconnect полностью очищает stream.
- Только transient failure запускает low-level reconnect.
- `503 Retry-After` без capacity body не попадает в очередь.
- Все поддерживаемые варианты rate-limit headers классифицируются корректно.
- Не изменён публичный Impress procedure contract.
- Не добавлены `DomainError` для transport failures.
- Изменены только разрешённые файлы.
- `npm run lint`, `npm run types`, `npm test` проходят.

## Отчёт runner

В обновлённом PR #10 указать:

- как reconnect classification передаётся из lib в domain;
- кто владеет retry для transient и capacity cases;
- как предотвращён двойной timer;
- таблицу HTTP classification;
- добавленные тесты;
- результаты validation;
- changed-files scope.
