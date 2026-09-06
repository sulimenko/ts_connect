# Task T-067: Закрыть native fetch network error classification

```ai-task-contract
version: 2
task_id: T-067
type: follow_up
human_summary: "Закрыть оставшийся review blocker PR T-065/T-066: корректно классифицировать DNS и Undici connect-timeout ошибки native fetch как bounded read-only transport failures, не возвращая broad TypeError retry."
execution_mode: codex

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: ai/T-065-orders-read-timeout
  work_branch_policy: continue_parent_branch
  allow_new_branch: false
  allow_codex_git: false

scope:
  allowed_files:
    - application/lib/ts/orders.js
    - application/test/run.js
  forbidden_files:
    - application/api/**
    - application/domain/**
    - application/lib/ts/send.js
    - application/lib/ts/ordersBatch.js
    - application/lib/ts/placeorder.js
    - application/lib/ts/stream.js
    - application/lib/stream/**
    - config/**
    - types/**
    - doc/**
    - package.json
    - package-lock.json
    - node_modules/**
    - coverage/**
    - dist/**
    - logs/**
    - artifacts/**
    - "*.log"
    - "*.zip"

tests:
  phase: implementation
  required: true
  user_acceptance_required: false
  acceptance_reference: none
  cover_behavior:
    - "Native fetch TypeError с cause.code ENOTFOUND классифицируется как bounded network failure и выполняет максимум одну retry."
    - "Native fetch TypeError с cause.code EAI_AGAIN классифицируется как bounded DNS/network failure и выполняет максимум одну retry."
    - "Undici cause.code UND_ERR_CONNECT_TIMEOUT классифицируется как timeout и после исчерпания retry завершается code ETIMEOUT."
    - "ENOTFOUND/EAI_AGAIN после второй неуспешной попытки не запускают третью попытку."
    - "UND_ERR_CONNECT_TIMEOUT после второй неуспешной попытки не запускает третью попытку."
    - "Произвольный TypeError без подтвержденного transport cause остаётся non-retryable."
    - "TypeError fetch failed с non-transport cause не становится retryable."
    - "Существующие HTTP 408, 429, 502, 503, 504, ECONNRESET, ECONNREFUSED, EHOSTUNREACH, ENETUNREACH, UND_ERR_SOCKET, headers/body timeout semantics не регрессируют."
    - "Generic lib.ts.send и POST order placement behavior не изменяются."
  allowed_files:
    - application/test/run.js

pr:
  mode: update_existing_parent_pr
  base: develop
  description_mode: replace_from_task
  comments_allowed: false

validation:
  commands:
    - npm run lint
    - npm run types
    - npm test

diff_budget:
  max_files_changed: 2
  max_added_lines: 140
  max_deleted_lines: 60

commit:
  message: "fix orders network error classification"
```

## Контекст review

T-066 исправил два предыдущих blocker:

1. повторный TradeStation HTTP 408 теперь получает `ETIMEOUT`;
2. произвольный application `TypeError` больше не retry-ится.

Однако текущий transport allowlist не покрывает несколько реальных ошибок native Node/Undici `fetch()`.

Текущий код:

```js
const timeoutCodes = new Set([
  'ETIMEDOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

const networkCodes = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_SOCKET',
]);
```

## Blocker 1: DNS failures

Native Node `fetch()` может выбрасывать:

```text
TypeError: fetch failed
  cause.code = ENOTFOUND
```

Также временный DNS resolution failure может иметь:

```text
EAI_AGAIN
```

Для read-only TradeStation orders это transport failures, для которых T-065 требует bounded retry.

Добавить только подтверждённые DNS/network codes:

```text
ENOTFOUND
EAI_AGAIN
```

Не возвращать broad rule:

```js
error.name === 'TypeError'
```

## Blocker 2: Undici connect timeout

Undici использует:

```text
UND_ERR_CONNECT_TIMEOUT
```

для connection timeout.

Добавить его в timeout classification рядом с:

```text
ETIMEDOUT
UND_ERR_HEADERS_TIMEOUT
UND_ERR_BODY_TIMEOUT
```

Семантика:

```text
attempt 1 -> UND_ERR_CONNECT_TIMEOUT
attempt 2 -> UND_ERR_CONNECT_TIMEOUT

final error.code = ETIMEOUT
attempt 3 отсутствует
```

Если первая попытка завершается `UND_ERR_CONNECT_TIMEOUT`, а вторая успешна, вернуть normal successful orders result.

## Не расширять retry на application errors

Следующие случаи не должны становиться retryable только из-за `TypeError`:

```text
TypeError: Cannot read properties of undefined
TypeError: Invalid URL
TypeError: fetch failed с unknown/non-transport cause
```

Не retry TLS certificate/configuration/programming errors только потому, что native fetch использует `TypeError`.

## Regression tests

Добавить deterministic tests минимум для:

```text
ENOTFOUND -> success
  attempts = 2

EAI_AGAIN -> success
  attempts = 2

UND_ERR_CONNECT_TIMEOUT -> success
  attempts = 2

UND_ERR_CONNECT_TIMEOUT -> UND_ERR_CONNECT_TIMEOUT
  attempts = 2
  final code = ETIMEOUT

ENOTFOUND -> ENOTFOUND
  attempts = 2
  attempt 3 отсутствует

application TypeError
  attempts = 1

TypeError fetch failed + non-transport cause
  attempts = 1
```

Существующие T-065/T-066 tests для HTTP status, local Abort timeout, malformed response и application TypeError сохранить.

## Ограничения

Не менять:

- `application/api/**`;
- `ordersBatch`;
- `lib.ts.send`;
- generic transport policy;
- OAuth lifecycle;
- brokerage stream lifecycle;
- domain orders/positions state;
- order matching/correlation;
- omnibus attribution;
- symbols;
- order creation;
- `orderexecution/order`;
- `lib.ts.placeorder`.

Категорически не добавлять automatic retry для broker POST orders.

Follow-up продолжает существующую ветку:

```text
ai/T-065-orders-read-timeout
```

и обновляет только PR #17.

## Критерии готовности

- `ENOTFOUND` bounded retry работает.
- `EAI_AGAIN` bounded retry работает.
- `UND_ERR_CONNECT_TIMEOUT` является timeout-class failure.
- Исчерпанный connect timeout возвращает `code = ETIMEOUT`.
- Максимум две read-only attempts.
- Broad `TypeError` retry отсутствует.
- Unknown/non-transport application errors не retry-ятся.
- HTTP 408 semantics T-066 сохранены.
- Generic `lib.ts.send` не изменён.
- Order placement не изменён и не retry-ится.
- Изменены только два разрешённых файла.
- `npm run lint` проходит.
- `npm run types` проходит.
- `npm test` проходит.
