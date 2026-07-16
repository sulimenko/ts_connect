# Task T-057: Распознавать `Stream quota exceeded` как matrix capacity

```ai-task-contract
version: 1
task_id: T-057
type: follow_up
human_summary: "Исправить классификацию реального ответа TradeStation `403 Stream quota exceeded`, чтобы matrix subscription переходила в adaptive queue и не завершалась RPC 500 как permanent forbidden error."
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
    - application/lib/ts/stream.js
    - application/test/run.js
  forbidden_files:
    - doc/**
    - application/api/**
    - application/domain/**
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
    - "HTTP 403 с точным body `Stream quota exceeded` классифицируется как capacity."
    - "Распознавание quota response не зависит от регистра, дополнительных пробелов и знаков пунктуации."
    - "Фразы `stream quota exceeded`, `quota exceeded`, `stream quota reached` и `quota limit reached` распознаются как capacity в stream HTTP classifier."
    - "Unknown HTTP 403 без quota, capacity, entitlement или authorization signal остаётся forbidden."
    - "HTTP 403 с entitlement или permission body остаётся entitlement и не попадает в capacity queue."
    - "HTTP 401 остаётся authorization."
    - "HTTP 429 остаётся capacity."
    - "HTTP 503 с Retry-After без явного quota/capacity body остаётся transient."
    - "HTTP 503 с явным stream quota/capacity body может классифицироваться как capacity."
    - "Initial matrix startup с `403 Stream quota exceeded` и уже существующим active matrix stream возвращает state=queued, active=false и upstreamReady=false."
    - "Quota subscribe не создаёт low-level reconnect timer и не удаляет managed entry или subscribers."
    - "После освобождения active matrix stream queued subscription запускается через существующий shared queue drain."
    - "Существующие capacity, reconnect, permanent error, FIFO queue, listener lifecycle, GoAway и INVALID SYMBOL tests не регрессируют."
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
  max_files_changed: 2
  max_added_lines: 180
  max_deleted_lines: 80

commit:
  message: "classify TradeStation stream quota as capacity"
```

## Источники и подтверждённые факты

В проектном индексе OpenAPI от 2026-04-11 явно указан лимит `max 10 concurrent streams` только для:

```text
GET /v3/marketdata/stream/options/quotes
```

Matrix endpoint `/v2/stream/matrix/changes/{symbol}` в этом OpenAPI-индексе не описан, поэтому число `10` нельзя переносить на matrix как документированный контракт.

Runtime test текущего аккаунта показал:

```text
HTTP 403 Forbidden
body: Stream quota exceeded
activeMatrixCount: 10
queuedMatrixCount: 0
```

Это подтверждает, что `Stream quota exceeded` является реальным capacity signal для matrix streams. Наблюдаемое значение `10` относится к использованному аккаунту и моменту тестирования, но не должно становиться production-константой.

Публично доступную актуальную официальную документацию TradeStation, которая отдельно задаёт числовой лимит для `/v2/stream/matrix/changes`, найти не удалось. Поэтому production behavior должен основываться на явном upstream quota signal, а не на предположении о числе.

## Подтверждённый runtime gap

Текущий HTTP classifier распознаёт `capacity`, `concurrent stream`, `stream limit` и похожие ответы, но не распознаёт реальную фразу:

```text
Stream quota exceeded
```

Поэтому ошибка классифицируется как:

```text
classification: forbidden
permanent: true
retryable: false
```

Далее lifecycle выполняет:

```text
startup.failed
managed entry removed
RPC 500
```

Вместо ожидаемого:

```text
classification: capacity
starting -> queued
active: false
upstreamReady: false
RPC success with state=queued
```

## Требуемое исправление

Расширить только `classifyHttpError()` и связанные тесты.

Распознавать подтверждённые quota-формулировки, включая:

```text
Stream quota exceeded
stream quota reached
quota exceeded
quota limit reached
```

Pattern должен быть:

- case-insensitive;
- устойчивым к нескольким пробелам, дефисам и пунктуации;
- достаточно узким, чтобы одиночное слово `quota` без контекста не превращало неизвестный `403` в capacity;
- применимым только в HTTP stream error classifier.

Сохранить существующий приоритет классификации:

1. authorization;
2. entitlement/permission;
3. `429`;
4. явные stream capacity/quota signals;
5. invalid request;
6. transient `408`, `425`, `5xx` без quota/capacity signal;
7. unknown `403` как forbidden.

Не добавлять константу `MAX_MATRIX_STREAMS = 10` и не изменять adaptive queue scheduler.

## Ожидаемый lifecycle

При initial matrix subscribe с quota response:

1. `buildHttpError()` возвращает:

```text
classification: capacity
permanent: false
retryable: true
reconnectable: false
```

2. `startEntry()` сохраняет managed entry и subscribers.
3. Entry переходит в `queued`.
4. RPC subscribe возвращает JSON-результат:

```text
state: queued
active: false
upstreamReady: false
```

5. Персональный reconnect timer не создаётся.
6. После unsubscribe, idle cleanup или client close одного active stream существующий queue drain запускает первую queued entry.
7. При успешном подключении entry проходит:

```text
queued -> starting -> active
```

## Обязательные тесты

Добавить unit test с точным production response:

```text
status: 403
statusText: Forbidden
body: Stream quota exceeded
```

Проверить:

- `classification === 'capacity'`;
- `permanent === false`;
- `retryable === true`;
- `reconnectable === false`.

Добавить варианты регистра и форматирования:

```text
STREAM QUOTA EXCEEDED
stream   quota   exceeded
Stream quota exceeded.
stream-quota reached
quota limit reached
```

Добавить negative cases:

```text
403 Forbidden
quota information unavailable
not entitled to market depth
permission denied
```

Добавить end-to-end unit test без реального TradeStation:

```text
HTTP 403 Stream quota exceeded
  -> buildHttpError classification=capacity
  -> managed matrix subscribe state=queued
  -> release active matrix stream
  -> shared queue drain starts queued entry
  -> entry state=active
```

Тест не должен использовать фиксированный лимит `10`.

## Ручная проверка

После выполнения задачи:

1. Открыть matrix streams до первого quota response.
2. Проверить:

```text
classification: capacity
starting -> queued
queuedMatrixCount: 1
```

3. Убедиться, что API не пишет:

```text
status=error:internal
HTTP 500
```

4. Закрыть одну active subscription или дождаться её idle cleanup.
5. Проверить:

```text
queue drain start
queued -> starting
starting -> active
```

6. Убедиться, что metaterminal не повторяет RPC subscribe для того же `streamKey` из-за generic error.

## Критерии готовности

- `403 Stream quota exceeded` классифицируется как capacity.
- Подписка переходит в adaptive queue.
- RPC не завершается кодом 500.
- Subscribers и managed entry сохраняются.
- Нет персонального reconnect storm.
- После освобождения upstream slot queued stream автоматически становится active.
- Unknown `403` остаётся forbidden.
- Entitlement и authorization не смешиваются с capacity.
- Лимит `10` не захардкожен.
- Изменены только разрешённые файлы.
- `npm run lint`, `npm run types`, `npm test` проходят.

## Отчёт runner

В обновлённом PR #10 указать:

- точную quota-фразу из runtime log;
- новый classifier pattern;
- почему лимит `10` не был захардкожен;
- результат end-to-end queue transition test;
- результаты validation;
- фактический changed-files scope.
