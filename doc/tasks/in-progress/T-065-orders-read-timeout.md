# Task T-065: Устранить периодические 408 при batch-загрузке TradeStation orders

```ai-task-contract
version: 2
task_id: T-065
type: primary
human_summary: "Устранить периодические HTTP 408 в account/orders и account/historicalorders: не связывать read-only snapshot с ожиданием brokerage stream recovery, выполнять accounts с ограниченной параллельностью, добавить bounded timeout/retry только для read-only TradeStation orders и исключить ложный успешный partial snapshot."
execution_mode: codex

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: none
  work_branch: ai/T-065-orders-read-timeout
  work_branch_policy: create_task_branch
  allow_new_branch: true
  allow_codex_git: false

scope:
  allowed_files:
    - application/api/account/orders.js
    - application/api/account/historicalorders.js
    - application/domain/ts/clients.js
    - application/lib/ts/orders.js
    - application/lib/ts/ordersBatch.js
    - application/lib/ts/send.js
    - application/test/run.js
  forbidden_files:
    - application/api/orderexecution/**
    - application/lib/ts/placeorder.js
    - application/domain/ts/client.js
    - application/domain/ts/orders.js
    - application/domain/ts/positions.js
    - application/domain/queue.js
    - application/lib/ts/stream.js
    - application/lib/stream/**
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
  required: true
  user_acceptance_required: false
  acceptance_reference: none
  cover_behavior:
    - "account/orders and account/historicalorders do not synchronously wait for brokerage stream synchronization when they only need an authenticated TradeStation client."
    - "Default domain.ts.clients.getClient behavior still synchronizes brokerage streams for existing callers that do not opt out."
    - "Cold client initialization remains single-flight and refreshes OAuth only once; snapshot mode does not require brokerage streams to become ready before read-only orders can start."
    - "Multiple accounts are fetched with bounded concurrency instead of a serial loop; active TradeStation account reads never exceed 3."
    - "One slow account does not prevent independent accounts from starting and completing their TradeStation reads."
    - "Per-account limit, orderIds, historical since and live/sim routing preserve current semantics; T-065 must not replace them with one multi-account upstream request."
    - "orders=[] performs one full-list TradeStation request per account and does not introduce per-order N+1 requests."
    - "Read-only orders retry at most once for HTTP 408, 429, 502, 503, 504 and network/read timeout."
    - "HTTP 400/401/403/404, invalid-symbol, malformed response and other non-transient failures are not automatically retried."
    - "A caller or batch abort is not retried."
    - "An exhausted read timeout or overall batch deadline produces Error code ETIMEOUT so Metacom returns HTTP 408 before the global 25 second Impress timeout."
    - "A TradeStation HTTP 200 response containing account-level Errors fails the whole public snapshot instead of returning a partial successful array."
    - "Full success preserves the existing public result shape: a flat array of TradeStation orders."
    - "Failure of one account never returns successful orders from other accounts as a complete snapshot."
    - "Generic lib.ts.send does not gain automatic retry behavior."
    - "POST orderexecution/order and lib.ts.placeorder remain single-attempt operations; a timeout must never trigger an automatic second broker order."
    - "Diagnostic logs contain endpoint, account, attempt, durationMs, HTTP status, order count and total batch duration without tokens or credentials."
  allowed_files:
    - application/test/run.js

pr:
  mode: create_new
  base: develop
  description_mode: replace_from_task
  comments_allowed: false

validation:
  commands:
    - npm run lint
    - npm run types
    - npm test

diff_budget:
  max_files_changed: 7
  max_added_lines: 900
  max_deleted_lines: 300

commit:
  message: "fix orders batch timeouts"
```

## Контекст

`back.ptfin` периодически запускает reconciliation TradeStation orders через:

```text
POST /api/account/orders
POST /api/account/historicalorders
```

Типичный batch содержит несколько accounts, включая:

```text
SIM2811593M
11957784
12062620
12062622
12062623
11827414
```

В production `account/orders` периодически завершается `408 Request Timeout`.

`back.ptfin` при недоступном orders snapshot не выполняет reconciliation, основанный на отсутствии broker order. Это безопасное downstream-поведение и в T-065 не меняется.

## Установленная причина

### 1. Общий Impress timeout

Процедура ограничена global `server.timeouts.request = 25000 ms`.

Impress оборачивает Promise процедуры через `metautil.timeoutify()`, а установленный Metacom преобразует `error.code === 'ETIMEOUT'` в HTTP 408.

`timeoutify()` при этом не отменяет исходную async-операцию. Поэтому после уже отправленного 408 незавершённый TradeStation `fetch()` может продолжить работу.

### 2. Последовательная загрузка accounts

`application/api/account/orders.js` и `application/api/account/historicalorders.js` сейчас выполняют один `await lib.ts.orders(...)` на account внутри последовательного цикла.

Для batch из шести accounts wall-clock latency складывается из шести TradeStation round-trip. Один медленный account задерживает все следующие accounts.

### 3. Read-only snapshot синхронно зависит от brokerage stream health

Оба endpoint сначала вызывают обычный:

```js
domain.ts.clients.getClient({})
```

Для существующего client `getClient()` синхронно вызывает `client.syncBrokerageStreams()`.

Если brokerage streams временно unhealthy, read-only snapshot до первого orders GET может ждать:

```text
lib.ptfin.getContract({ accounts: ['all'] })
order stream startup
position stream startup
следующий account
...
```

Initial brokerage stream connect использует `fetch()` без собственного connect timeout.

Получение REST snapshot orders не должно зависеть от завершения stream recovery.

### 4. TradeStation REST transport не ограничен caller deadline

`application/lib/ts/send.js` использует native `fetch()` без caller-provided AbortSignal/request timeout.

Один stalled upstream request способен жить дольше всего Impress RPC.

### 5. Partial snapshot сейчас может маскироваться как success

`lib.ts.orders()` возвращает нормализованные `errors` и `orders`, но public endpoint добавляет результат только когда `response.errors.length === 0` и продолжает следующий account.

Если один account вернул account-level `Errors`, вызывающая сторона может получить HTTP 200 с неполным flat array, который невозможно отличить от authoritative snapshot.

Для absence-based reconciliation это недопустимо.

### 6. Что не является основной причиной

- OAuth token не запрашивается заново на каждый account; refresh уже single-flight.
- При `orders=[]` нет per-order detail N+1: выполняется один full-list request на account.
- `account/orders` напрямую не вызывает `historicalorders`.
- Однако brokerage stream lifecycle может параллельно запускать reconciliation current + historical и создавать дополнительную REST-нагрузку.

## Архитектурное решение

### 1. Развязать token-ready client и brokerage stream synchronization

Изменить `application/domain/ts/clients.js` минимально.

Требуется:

- создание client и OAuth refresh остаются single-flight;
- существующий default `getClient()` сохраняет прежнюю семантику и синхронизирует brokerage streams;
- добавить явный внутренний режим `getClient()` для token-ready client без ожидания `syncBrokerageStreams()`;
- `account/orders` и `account/historicalorders` используют этот режим;
- normal callers, startup prewarm и order placement не меняют default behavior;
- если token-ready setup был создан snapshot caller-ом, последующий default caller всё равно обязан выполнить/дождаться `syncBrokerageStreams()`; shared setup не должен случайно навсегда пропустить brokerage setup;
- `update=true`, delete/revision semantics, OAuth single-flight и lifetime lifecycle сохранить.

API layer не должен самостоятельно делать reconnect или управлять stream state.

### 2. Добавить bounded orders batch helper

Создать:

```text
application/lib/ts/ordersBatch.js
```

Helper должен:

- принимать normalized contracts и параметры current/historical orders;
- использовать существующий `lib.ts.orders()`;
- сохранять один TradeStation request на account;
- не объединять accounts в один TradeStation `{accounts}` request в T-065, потому что current `limit`/pagination semantics применяются per account;
- выполнять независимые accounts с bounded concurrency `3`;
- не запускать больше трёх active account reads одновременно;
- сохранять детерминированный порядок объединения результата независимо от порядка завершения requests;
- иметь общий batch deadline `18000 ms`, то есть гарантированно меньше внешних 25000 ms;
- при первой окончательной account failure отменять ещё выполняющиеся account reads;
- после batch failure/deadline не начинать новые account reads;
- никогда не возвращать partial success.

Если `response.errors` содержит хотя бы один элемент, snapshot считать неauthoritative и завершать batch обычным integration `Error`.

Не использовать `DomainError` для transport/integration failures.

### 3. Timeout и retry только для read-only current/historical orders

`application/lib/ts/send.js` разрешается изменить только как generic transport primitive:

- принять optional `signal`;
- передать его native `fetch()`;
- при необходимости сохранить безопасные response metadata, включая status и bounded retry metadata;
- не добавлять retry;
- не добавлять новый default timeout для всех callers;
- не менять request method/body semantics.

Retry policy должна находиться в `lib.ts.orders` либо dedicated read-only orders helper и применяться только к GET current/historical orders.

Production policy:

```text
per-attempt timeout: 7000 ms
maximum attempts: 2
maximum retries: 1
batch deadline: 18000 ms
batch concurrency: 3
```

Retryable:

```text
HTTP 408
HTTP 429
HTTP 502
HTTP 503
HTTP 504
network failure
read/request timeout
```

Не retryable:

```text
HTTP 400 кроме 408
HTTP 401
HTTP 403
HTTP 404
confirmed invalid-symbol
malformed TradeStation response
unexpected application error
caller/batch abort
```

Backoff bounded. Для `429` можно учитывать безопасно извлечённый `Retry-After`, но нельзя ждать дольше оставшегося batch deadline. Если requested delay не помещается в deadline, fail fast.

Никаких бесконечных retries.

### 4. Abort должен реально останавливать fetch

Для каждого read attempt использовать `AbortController`/AbortSignal так, чтобы:

- per-attempt timeout abort-ил `fetch`/body read;
- batch deadline abort-ил все active account reads;
- final account failure abort-ил остальные active reads;
- listeners/timers очищались в `finally`;
- parent/batch abort не классифицировался как retryable per-attempt timeout;
- после abort не оставалось фонового TradeStation request, продолжающего работу после RPC completion.

### 5. Сохранить HTTP 408 semantics для реального timeout

Если:

- account read исчерпал bounded retry из-за timeout; или
- истёк общий orders batch deadline,

финальная transport error должна иметь:

```text
code = ETIMEOUT
```

Это позволяет текущему Metacom вернуть HTTP 408 до того, как сработает внешний Impress 25s timeout.

Permanent account/authorization/shape errors не подменять `ETIMEOUT`.

### 6. Не маскировать partial result

Успешный публичный контракт остаётся прежним:

```text
Order[]
```

Новый response envelope в T-065 не вводить, потому что `back.ptfin` сейчас его не ожидает.

Семантика:

```text
все accounts успешны
  -> вернуть полный flat Order[]

хотя бы один account недоступен или response.Errors не пуст
  -> завершить весь RPC ошибкой

TradeStation полностью недоступен
  -> bounded failure до внешнего 25s timeout
```

Никогда не отдавать HTTP 200 с неполным authoritative snapshot.

## Диагностика

Для каждого внешнего TradeStation current/historical orders request логировать компактно:

```text
endpoint
account
mode=current|historical
attempt
state=start|done|error
durationMs
httpStatus
ordersCount
retryable
retryAttempt
```

Для batch:

```text
endpoint
accountsCount
concurrency
durationMs
completedAccounts
failedAccount
state
```

Для token-ready `getClient` path должно быть диагностируемо, что brokerage stream sync не ожидался.

Не логировать:

- Authorization header;
- access token;
- refresh token;
- client secret;
- API key;
- OAuth body;
- полный config;
- полный orders payload/response.

## Regression tests

Добавить deterministic tests с mocked `fetch`/delays без реального TradeStation.

Обязательно проверить:

1. Batch из нескольких accounts действительно overlap-ится, но `maxActive <= 3`.
2. Порядок завершения requests не меняет детерминированный порядок результата.
3. Slow account не мешает другим accounts начать/закончить read.
4. Transient failure запускает максимум один retry.
5. Первый timeout + второй success возвращает полный successful result.
6. Два timeout одного account дают `ETIMEOUT`, третьего request нет.
7. `408/429/502/503/504` retryable только в read-only orders path.
8. Network/read timeout retryable только bounded.
9. `400/401/403/404`, malformed response и permanent error не retry.
10. Parent/batch abort не запускает новый retry.
11. `response.Errors` одного account отклоняет весь batch.
12. Full success возвращает прежний flat array.
13. Current и historical endpoint используют одинаковый batch policy.
14. `orders=[]` не создаёт order-detail N+1.
15. Default `getClient()` по-прежнему вызывает/ожидает `syncBrokerageStreams()`.
16. Snapshot `getClient()` path не ждёт `syncBrokerageStreams()`.
17. Cold OAuth/client setup остаётся single-flight.
18. Generic `lib.ts.send()` сам по себе не retry.
19. POST через generic send при timeout/rejected fetch выполняет ровно один outbound attempt.
20. `application/api/orderexecution/**`, `lib.ts.placeorder`, order matching/state и stream lifecycle не изменены.

## Способ воспроизведения/проверки

Смоделировать batch:

```text
SIM2811593M
11957784
12062620
12062622
12062623
11827414
```

### Baseline latency scenario

Задать mocked delays так, чтобы последовательная сумма шести account requests превышала wall-clock budget.

Новая реализация должна показать:

```text
max concurrency <= 3
accounts действительно выполняются параллельно
batch duration существенно меньше serial sum
```

### Stalled account

Один account имитирует never-ending/read-timeout response.

Ожидается:

```text
attempt 1 -> timeout
bounded backoff
attempt 2 -> timeout
active remaining reads aborted
new reads not started after final failure
final error.code = ETIMEOUT
attempt 3 отсутствует
partial successful snapshot отсутствует
```

### Transient recovery

```text
attempt 1 -> HTTP 503
attempt 2 -> HTTP 200
batch -> success
```

### Permanent failure

```text
attempt 1 -> HTTP 401
attempt 2 отсутствует
batch -> error
```

## Критические ограничения

Не переносить retry-механику автоматически на endpoint выставления заявок.

Категорически запрещено делать автоматический retry `orderexecution/order` или `lib.ts.placeorder` после timeout: это может создать дублирующий broker order.

Не менять:

- `back.ptfin`;
- business logic создания orders;
- matching/correlation клиентских orders;
- обработку `out-of-order lower executed quantity`;
- omnibus attribution/fallback orders;
- `domain.ts.orders` state/hydration logic;
- positions business state;
- brokerage order/position stream reconnect lifecycle;
- symbol parsing/formatting;
- TradeStation OAuth policy, кроме сохранения существующего single-flight client setup contract;
- public successful response shape.

Не создавать test-only production hooks.
Не коммитить logs, coverage, archives или другие generated artifacts.

## Критерии готовности

- Six-account reconciliation больше не складывает latency всех TradeStation reads последовательно.
- Read-only snapshot не ждёт восстановления brokerage streams.
- Default callers `getClient()` сохраняют существующий brokerage sync behavior.
- Stalled TradeStation read ограничен внутренним timeout и реально abort-ится.
- Transient retry строго bounded: максимум один retry.
- Общий orders batch имеет deterministic deadline 18s, меньше 25s Impress timeout.
- Реальный timeout завершается `ETIMEOUT`/HTTP 408 до внешнего Impress timeout.
- Один failed account не маскируется под полный успешный snapshot.
- Full success сохраняет прежний `Order[]` contract.
- Никакого automatic retry order placement.
- Диагностические logs позволяют определить slow/failed account, attempt, status и duration.
- Secrets и полный orders payload в logs отсутствуют.
- Изменены только `allowed_files`.
- Forbidden/generated files отсутствуют.
- `npm run lint` проходит.
- `npm run types` проходит.
- `npm test` проходит.
