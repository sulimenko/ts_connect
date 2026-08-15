# Task T-061: Сделать OAuth refresh single-flight и вернуть contract error для invalid option symbols

```ai-task-contract
version: 2
task_id: T-061
type: follow_up
human_summary: "Устранить production unhandledRejection при сетевой ошибке OAuth refresh, объединить все refresh-вызовы одного клиента в single-flight lifecycle и преобразовывать подтверждённый TradeStation Invalid symbol в публичный DomainError для options expirations/strikes вместо RPC 500."
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
    - application/domain/ts/client.js
    - application/domain/ts/clients.js
    - application/lib/ts/refresh.js
    - application/lib/ts/send.js
    - application/api/options/expirations.js
    - application/api/options/strikes.js
  forbidden_files:
    - application/test/**
    - test/**
    - tests/**
    - "**/*.test.js"
    - "**/*.spec.js"
    - application/api/options/chain.js
    - application/lib/stream/**
    - application/lib/ts/stream.js
    - application/domain/ts/streams.js
    - application/domain/ts/orders.js
    - application/domain/queue.js
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
  max_files_changed: 6
  max_added_lines: 420
  max_deleted_lines: 220

commit:
  message: "fix oauth refresh and invalid symbol errors"
```

## Human summary

Production logs выявили два независимых runtime gap.

### Gap 1: OAuth lifetime refresh создаёт unhandledRejection

Текущий lifetime callback вызывает асинхронный:

```js
lib.ts.refresh({ client: this });
```

в синхронном `try/catch` без `await` или `.catch()`.

При сетевой ошибке `fetch failed` Promise rejection выходит за пределы callback и фиксируется как:

```text
unhandledRejection: TypeError: fetch failed
```

Кроме timer refresh, прямой refresh вызывается из:

- initial client setup;
- brokerage authorization recovery.

Эти пути не используют общий single-flight lock и могут сформировать параллельные OAuth requests одного TradeStation client.

### Gap 2: TradeStation Invalid symbol превращается в RPC 500

`lib.ts.send()` при HTTP error логирует response body, но бросает только общий:

```text
Error: HTTP Error: <status> <statusText>
```

Структурированная информация `status` и upstream error body теряется.

Поэтому публичные процедуры:

- `options/expirations`;
- `options/strikes`;

не могут отличить предсказуемый TradeStation `400 Invalid symbol` от transport/integration failure, и запрос завершается internal RPC 500.

## Часть 1. Общий OAuth refresh lifecycle

### 1.1. Single-flight на уровне client

Добавить к объекту TradeStation client общий refresh state, например:

```text
tokenRefresh
```

или эквивалентный внутренний marker/Promise.

Добавить метод уровня client, например:

```js
refreshAccessToken({ reason });
```

Название может отличаться, но поведение обязательно.

Правила:

- если refresh уже выполняется, вернуть тот же Promise;
- не создавать второй OAuth request;
- single-flight действует для initial setup, lifetime timer и brokerage recovery;
- Promise очищается в `finally`;
- failure не очищает действующие `tokens.access`, `tokens.refresh`, `tokens.expires` или `tokens.id`;
- success использует нормальный результат `lib.ts.refresh()` и обновляет token state ровно один раз;
- transport failure остаётся обычным `Error`, не `DomainError`;
- не добавлять бесконечный retry или tight loop.

### 1.2. Initial setup

В `domain.ts.clients.setClient()` заменить прямой `lib.ts.refresh()` на общий client refresh method.

Требования:

- initial setup по-прежнему ожидает refresh перед brokerage setup;
- ошибка initial refresh корректно отклоняет setup Promise;
- `connecting[name]` очищается существующим `finally`;
- rejected setup не превращается в unhandledRejection;
- не нарушать single-flight setup через `connecting[name]`.

### 1.3. Brokerage recovery

В `recoverBrokerage()` заменить прямой refresh на общий client refresh method.

Требования:

- существующий bounded recovery остаётся максимум в двух циклах;
- одновременные authorization failures orders/positions приводят к одному recovery и одному OAuth request;
- timer refresh, совпавший с authorization recovery, разделяет тот же Promise;
- failed refresh обрабатывается существующим recovery catch;
- duplicate orders/positions streams не создаются;
- `brokerage.ready` не становится true до восстановления обоих streams.

### 1.4. Lifetime timer

Переписать callback так, чтобы Promise rejection всегда был обработан.

Допустимы варианты:

```js
void this.refreshAccessToken({ reason: 'lifetime' }).catch(...)
```

или корректный async callback с явным catch.

Требования:

- ошибка логируется как handled OAuth transport failure;
- `unhandledRejection` отсутствует;
- callback не запускает параллельный refresh;
- после failure следующая попытка остаётся bounded существующим cadence, без немедленной рекурсии;
- при `client.closed === true` callback не вызывает refresh;
- при `client.closed === true` callback не планирует новый timer;
- `close()` очищает существующий timer;
- callback, начавшийся непосредственно перед `close()`, после завершения не воскрешает timer;
- не использовать `setInterval`;
- не менять текущий threshold refresh до expiry без отдельной причины.

### 1.5. Logging

Добавить компактные безопасные lifecycle logs с полями по необходимости:

```text
event
reason
state
shared
closed
errorName
errorCode
```

Запрещено логировать:

- access token;
- refresh token;
- client secret;
- OAuth request body;
- полный config.

## Часть 2. Структурированная TradeStation HTTP error

### 2.1. Сохранить upstream error metadata

В `application/lib/ts/send.js` при `res.ok === false` создавать обычный `Error` с безопасными структурированными полями минимум:

```text
status
statusText
responseText или эквивалентное нормализованное upstream message
```

Разрешено добавить:

```text
code
classification
permanent
retryable
```

для точно распознанных случаев.

Требования:

- не использовать `DomainError` в `lib`;
- не терять исходный HTTP status;
- корректно обрабатывать пустой response body;
- корректно обрабатывать plain text и JSON body;
- не падать повторно при невалидном JSON;
- не включать Authorization header или token в Error;
- успешные ответы продолжают проходить defensive JSON parsing в существующем contract;
- сетевой `fetch failed` остаётся обычным transport `Error`.

### 2.2. Узкая классификация Invalid symbol

Распознавать invalid-symbol только при достаточном подтверждении:

- HTTP status `400`;
- upstream message/body содержит точное case-insensitive значение `Invalid symbol` либо эквивалентное поле JSON с этим значением.

Для подтверждённого случая нормализовать regular Error, например:

```text
code: INVALID_SYMBOL
classification: invalid
permanent: true
retryable: false
```

Не классифицировать как invalid symbol:

- любой другой HTTP 400;
- 401/403;
- 404;
- 429;
- 5xx;
- timeout;
- DNS/network failure;
- malformed response без `Invalid symbol`.

Не добавлять локальные regex для проверки допустимости symbol до запроса. TradeStation остаётся источником истины по существованию underlying.

## Часть 3. Публичный API contract options metadata

### 3.1. options/expirations

Добавить публичную ошибку:

```text
EINVALIDSYMBOL: TradeStation rejected the underlying symbol
```

или эквивалентное стабильное описание.

Обернуть только вызов `lib.ts.send()`:

- подтверждённый `error.code === 'INVALID_SYMBOL'` преобразовать в `new DomainError('EINVALIDSYMBOL')`;
- все остальные ошибки rethrow без преобразования;
- существующий `ESYMBOL` для отсутствующего параметра сохранить;
- существующий `ESTRIKEPRICE` сохранить;
- успешные response shape guards сохранить.

### 3.2. options/strikes

Добавить тот же публичный `EINVALIDSYMBOL`.

Поведение:

- подтверждённый upstream invalid symbol -> `DomainError('EINVALIDSYMBOL')`;
- прочие transport/integration errors -> обычный `Error`;
- существующие `ESYMBOL` и `EINTERVAL` сохранить;
- response shape и параметры не менять.

### 3.3. Scope boundary

Не изменять в этой задаче:

- `options/chain`;
- option-chain stream classification;
- capacity queue;
- `INVALID SYMBOL` reconnect policy stream adapter;
- symbol parsing/formatting;
- `makeSymbol()` и `makeTSSymbol()`;
- matrix;
- orders payload;
- public procedures вне expirations/strikes.

## Ограничения

- Не добавлять tests до явной пользовательской приёмки.
- Не создавать test-only hooks.
- Не создавать новый branch или PR.
- Не писать PR comments, inline comments или review submissions.
- Не менять существующие capacity queue и brokerage order behavior.
- Не добавлять polling.
- Не добавлять blind OAuth retries.
- Не использовать `DomainError` для OAuth/transport failures.
- Не собирать и не валидировать option symbols через локальные regex.
- Не коммитить production logs, archives, coverage или другие generated artifacts.
- Runner обязан полностью заменить PR body содержимым раздела `## PR body`.
- Если PR body не заменён, task должна завершиться fail, а не перемещаться в `done`.

## Критерии готовности

### OAuth

- Network failure lifetime refresh не создаёт `unhandledRejection`.
- Один TradeStation client имеет максимум один выполняющийся OAuth refresh.
- Initial setup, lifetime и brokerage recovery используют общий refresh Promise.
- Одновременный timer/recovery вызывает один OAuth request.
- Failed refresh не очищает действующий token state.
- После failure отсутствует synchronous/tight retry loop.
- Следующая bounded timer attempt остаётся возможной.
- `close()` не позволяет callback повторно запланировать lifetime timer.
- После close OAuth request не запускается.
- Brokerage recovery остаётся bounded и single-flight.
- Orders/positions streams не дублируются.

### Invalid symbol

- `options/expirations` для подтверждённого TradeStation `400 Invalid symbol` возвращает `EINVALIDSYMBOL`, а не RPC 500.
- `options/strikes` имеет такое же поведение.
- Missing symbol по-прежнему возвращает `ESYMBOL`.
- Invalid interval/strikePrice сохраняют текущие contract errors.
- Другой HTTP 400 не маскируется как invalid symbol.
- 401/403/429/5xx и network errors остаются integration errors.
- `lib.ts.send` сохраняет status и безопасное upstream error message.
- Stream/capacity/symbol formatting behavior не изменён.

### Scope и validation

- Изменены только разрешённые файлы.
- Tests не изменены.
- Generated artifacts отсутствуют.
- `npm test` проходит.
- PR body полностью заменён содержимым этой task.

## Ручная проверка после implementation

### OAuth staging

1. Установить expiry менее чем через две минуты.
2. Заблокировать `signin.tradestation.com`.
3. Дождаться lifetime refresh.
4. Проверить:
   - один handled error;
   - нет `unhandledRejection`;
   - процесс жив;
   - token state не очищен;
   - нет tight loop.
5. Одновременно вызвать brokerage authorization recovery.
6. Проверить один общий OAuth request/Promise.
7. Восстановить сеть.
8. Проверить успешный refresh и восстановление обоих brokerage streams.
9. Закрыть client около момента timer callback.
10. Проверить, что timer не создаётся повторно.

### Options API

1. Вызвать `options/expirations` с подтверждённо invalid underlying.
2. Ожидать `EINVALIDSYMBOL`.
3. Повторить для `options/strikes`.
4. Вызвать процедуру без symbol — ожидать `ESYMBOL`.
5. Смоделировать другой HTTP 400 — он не должен стать `EINVALIDSYMBOL`.
6. Смоделировать 429/500/network failure — ожидать обычный integration error.
7. Проверить valid symbols и нормальные ответы.

## PR body

<!-- ai-pr-body:start -->

# Цель

Сделать TradeStation integration устойчивой к lifecycle и public-contract failures:

1. восстановить надёжную доставку и reconciliation brokerage orders;
2. обеспечить единый authorization recovery orders и positions;
3. не терять multi-leg order state и не откатывать новые stream updates устаревшим REST snapshot;
4. при upstream option-marketdata capacity сохранять managed subscription в очереди вместо RPC 500;
5. гарантировать bounded FIFO processing общей chains/matrix capacity queue;
6. исключить unhandled Promise rejection и параллельные запросы OAuth refresh;
7. возвращать предсказуемую public contract error для подтверждённого TradeStation Invalid symbol в options metadata endpoints.

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

### OAuth refresh

- Initial setup, lifetime timer и brokerage authorization recovery используют общий per-client single-flight refresh.
- Network failure обрабатывается как regular transport Error.
- Lifetime refresh не создаёт `unhandledRejection`.
- Failed refresh не очищает действующий token state.
- `client.close` прекращает timer lifecycle и не допускает его повторного планирования.

### Options metadata invalid symbol

- TradeStation `400 Invalid symbol` сохраняется как структурированная integration error в lib layer.
- `options/expirations` и `options/strikes` преобразуют только подтверждённый invalid-symbol case в публичный `EINVALIDSYMBOL`.
- Остальные HTTP/transport errors не маскируются под business error.
- Локальная guess-based symbol validation не добавляется.

Пользовательская приёмка результата T-059/T-060/T-061 ещё не выполнена.

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
- T-061: OAuth refresh объединён в single-flight lifecycle с handled timer failures.
- T-061: `lib.ts.send` сохраняет безопасные HTTP error metadata.
- T-061: options expirations/strikes возвращают contract error для подтверждённого Invalid symbol.

## Открытые gaps

- Нет известных implementation gaps.
- User acceptance pending.
- Accepted-behavior tests pending.

## Пользовательская приёмка

Status: pending.

Acceptance reference: none.

До приёмки требуется staging fault injection для OAuth и последующая runtime-проверка option-chain capacity на версии с T-059/T-060/T-061.

## Regression coverage

### Existing coverage

- Existing `npm test` остаётся regression gate.
- Implementation tasks T-059/T-060/T-061 не изменяют test files.

### Pending after acceptance

После явной пользовательской приёмки отдельная accepted-behavior follow-up task должна покрыть:

- initial option-chain HTTP 429 -> queued RPC result;
- сохранение subscribers и managed entry;
- FIFO drain и continuation после первого успешного startup;
- terminal cleanup active stream -> запуск следующей queued entry;
- matrix capacity regression;
- lifetime OAuth network failure без `unhandledRejection`;
- concurrent lifetime/recovery -> один refresh Promise;
- close во время timer callback без timer resurrection;
- expirations/strikes Invalid symbol -> `EINVALIDSYMBOL`;
- прочие HTTP errors не маскируются как invalid symbol.

## Validation

- `npm test` — passed для T-061 перед завершением task.
- Tests в implementation phase не изменялись.

## Task history

- T-056 — primary brokerage order stream recovery.
- T-058 — delivery, hydration, authorization recovery и generation-barrier follow-up.
- T-059 — option-chain managed capacity queue follow-up.
- T-060 — capacity queue continuation и terminal slot release follow-up.
- T-061 — OAuth refresh single-flight и options invalid-symbol contract follow-up.
<!-- ai-pr-body:end -->
