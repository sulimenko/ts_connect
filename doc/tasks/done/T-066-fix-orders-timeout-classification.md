# Task T-066: Исправить timeout classification в PR T-065

```ai-task-contract
version: 2
task_id: T-066
type: follow_up
human_summary: "Исправить два review blocker PR T-065: после исчерпания retry для TradeStation HTTP 408 возвращать ETIMEOUT и не считать любой application TypeError сетевой ошибкой."
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
    - "Два последовательных TradeStation HTTP 408 выполняют ровно две GET-попытки и завершаются Error code ETIMEOUT."
    - "TradeStation HTTP 408 на первой попытке и HTTP 200 на второй остаются успешным bounded retry."
    - "Локальный per-attempt Abort timeout после двух попыток по-прежнему завершается ETIMEOUT."
    - "HTTP 429/502/503/504 остаются retryable максимум один раз, но не переклассифицируются в ETIMEOUT только из-за своего HTTP status."
    - "Если оставшегося batch deadline недостаточно для разрешённой retry/backoff попытки после timeout, завершение имеет ETIMEOUT и новый request не запускается."
    - "Настоящая transport/network ошибка native fetch retry-ится максимум один раз."
    - "Произвольный application TypeError не классифицируется как network failure и не retry-ится."
    - "Malformed response ERESPONSE не retry-ится."
    - "Generic lib.ts.send и POST/order placement behavior не изменяются."
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
  max_added_lines: 180
  max_deleted_lines: 80

commit:
  message: "fix orders timeout classification"
```

## Контекст review

PR #17 / T-065 корректно реализовал:

- token-ready `getClient({ sync: false })`;
- bounded concurrency для account reads;
- 18s batch deadline;
- AbortSignal propagation;
- отсутствие partial successful snapshot;
- read-only retry;
- отсутствие retry для order placement.

Review обнаружил два contract blocker.

## Blocker 1: повторный HTTP 408 не становится ETIMEOUT

Текущая implementation включает:

```js
const transient = new Set([408, 429, 502, 503, 504]);
```

но timeout classification учитывает только `error.code`.

Поэтому:

```text
attempt 1 -> HTTP 408
attempt 2 -> HTTP 408
```

после второй попытки выбрасывает Error с `status=408`, но без:

```text
code = ETIMEOUT
```

Исправить classification так, чтобы TradeStation HTTP status `408` считался timeout-class failure.

Требуемая семантика:

```text
HTTP 408 attempt 1
  -> retry один раз

HTTP 408 attempt 2
  -> final error.code = ETIMEOUT
```

Не выполнять третью попытку.

Не преобразовывать `429/502/503/504` в ETIMEOUT только по HTTP status.

Если timeout retry уже невозможно выполнить в пределах оставшегося batch deadline, завершить operation как `ETIMEOUT`, не запускать request, который заведомо не помещается в deadline.

## Blocker 2: не retry любой TypeError

Текущая проверка:

```js
error.name === 'TypeError'
```

слишком широкая и ошибочно считает любой application/programming TypeError network failure.

Retry должен выполняться только для подтверждённых transport failures.

При классификации разрешается учитывать:

```text
error.code
error.cause?.code
```

и известные network/undici transport codes, включая существующий набор:

```text
ECONNRESET
ECONNREFUSED
EHOSTUNREACH
ENETUNREACH
UND_ERR_SOCKET
ETIMEDOUT
UND_ERR_HEADERS_TIMEOUT
UND_ERR_BODY_TIMEOUT
```

Для native fetch `TypeError: fetch failed` допускается учитывать его только как transport failure при наличии соответствующего transport cause/признака.

Произвольные ошибки вида:

```js
new TypeError('Cannot read properties of undefined')
```

не должны retry-иться.

Не расширять classifier на unknown application errors.

## Regression tests

Добавить deterministic tests.

### 1. HTTP 408 exhausted

```text
attempt 1 -> status 408
attempt 2 -> status 408
attempt 3 -> отсутствует
final code -> ETIMEOUT
```

### 2. HTTP 408 recovery

```text
attempt 1 -> status 408
attempt 2 -> HTTP 200
result -> success
```

### 3. Non-timeout transient

Для `429`, `502`, `503`, `504` подтвердить:

```text
maximum attempts = 2
```

и отсутствие автоматического `ETIMEOUT` только из-за статуса.

### 4. Genuine network failure

Смоделировать native-fetch-like transport error с network cause.

Ожидать максимум один retry.

### 5. Unexpected TypeError

Смоделировать:

```js
new TypeError('Cannot read properties of undefined')
```

Ожидать:

```text
attempts = 1
```

### 6. Deadline exhausted before retry

Смоделировать timeout/transient path, когда оставшийся deadline меньше допустимого retry/backoff budget.

Ожидать:

```text
новый outbound request не запускается
final code = ETIMEOUT для timeout-class path
```

## Ограничения

Не менять:

- API procedures;
- `ordersBatch`;
- `lib.ts.send`;
- generic transport retry policy;
- OAuth lifecycle;
- brokerage streams;
- domain orders state;
- positions;
- order matching/correlation;
- omnibus attribution;
- symbol helpers;
- order creation;
- `orderexecution/order`;
- `lib.ts.placeorder`.

Категорически не добавлять automatic retry для POST broker orders.

Не создавать новую branch или новый PR.

Follow-up обязан продолжить:

```text
ai/T-065-orders-read-timeout
```

и обновить существующий PR #17.

## Критерии готовности

- Два последовательных upstream HTTP 408 дают ровно две попытки.
- Финальный Error после второго HTTP 408 имеет `code = ETIMEOUT`.
- Metacom получает корректный timeout classification для публичного HTTP 408.
- Первый HTTP 408 + второй HTTP 200 остаётся success.
- `429/502/503/504` retry-ятся bounded, но не маскируются под ETIMEOUT.
- Настоящая network failure retry-ится bounded.
- Произвольный application TypeError выполняется один раз.
- `ERESPONSE` не retry-ится.
- Generic `lib.ts.send` не изменён.
- Order placement не изменён и не retry-ится.
- Изменены только два разрешённых файла.
- `npm run lint` проходит.
- `npm run types` проходит.
- `npm test` проходит.
