# Task T-062: Исправить production invalid-symbol classifier и восстановить полный PR body

```ai-task-contract
version: 2
task_id: T-062
type: follow_up
human_summary: "Распознавать фактический TradeStation HTTP 400 payload вида `Invalid symbol: <symbol>` без расширения классификации на другие ошибки и гарантированно заменить PR #13 body полным описанием T-056–T-062."
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
    - application/lib/ts/send.js
  forbidden_files:
    - application/test/**
    - test/**
    - tests/**
    - "**/*.test.js"
    - "**/*.spec.js"
    - application/api/**
    - application/domain/**
    - application/lib/stream/**
    - application/lib/ts/stream.js
    - application/lib/ts/refresh.js
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
  max_added_lines: 80
  max_deleted_lines: 40

commit:
  message: "fix production invalid symbol classification"
```

## Human summary

Review T-061 подтвердил, что OAuth single-flight lifecycle реализован корректно на уровне статического анализа, scope соблюдён и CI проходит.

Остались два blocker:

1. `lib.ts.send()` распознаёт invalid symbol только при полном равенстве строки `invalid symbol`;
2. runner не заменил PR #13 body содержимым T-061, хотя task была перемещена в `done`.

Фактический production response TradeStation имеет вид:

```json
{
  "Error": "Failed",
  "Message": "Invalid symbol: SPX"
}
```

Также наблюдались варианты с другими upstream symbols:

```text
Invalid symbol: FFSPC4
Invalid symbol: 3OIL
```

Текущая проверка:

```js
value.toLowerCase() === 'invalid symbol';
```

не классифицирует эти сообщения, поэтому `error.code = 'INVALID_SYMBOL'` не устанавливается, а публичные `options/expirations` и `options/strikes` продолжают завершаться RPC 500 вместо `EINVALIDSYMBOL`.

## Требуемое изменение

### 1. Поддержать фактический production message

В `application/lib/ts/send.js` сохранить текущую структуру разбора plain text и JSON error body.

Для каждого извлечённого строкового значения:

1. выполнить `trim()`;
2. привести к lowercase только для сравнения;
3. считать подтверждённым invalid-symbol только:
   - точное `invalid symbol`;
   - либо строку, начинающуюся с `invalid symbol:`.

Допустимое эквивалентное условие:

```js
message === 'invalid symbol' || message.startsWith('invalid symbol:');
```

Классификация допустима только при:

```text
HTTP status === 400
```

После классификации сохранить contract T-061:

```text
code: INVALID_SYMBOL
classification: invalid
permanent: true
retryable: false
```

### 2. Не расширять классификацию

Не считать invalid-symbol:

```text
invalid symbols
invalid symbolization
symbol invalid
request contains an invalid symbol
invalid underlying
```

если TradeStation не вернул подтверждённую форму:

```text
Invalid symbol
Invalid symbol: <value>
```

Не переклассифицировать:

- другой HTTP 400;
- 401;
- 403;
- 404;
- 429;
- 5xx;
- timeout;
- DNS/network failure;
- malformed JSON без подтверждённого сообщения;
- пустой response body.

Не валидировать входной symbol локально.

Не извлекать `<symbol>` для принятия бизнес-решений.

Не добавлять regex или symbol parsing вне существующего `lib.utils` contract.

### 3. Сохранить T-061 behavior

Не регрессировать:

- structured `status`;
- `statusText`;
- безопасный `responseText`;
- JSON/plain-text parsing;
- отсутствие token/header data в Error;
- обычный `Error`, а не `DomainError`, в lib layer;
- API mapping `INVALID_SYMBOL -> EINVALIDSYMBOL`;
- остальные HTTP/transport failures остаются integration errors;
- OAuth single-flight implementation;
- lifetime handled rejection;
- close/timer lifecycle.

## PR body workflow

Runner обязан полностью заменить PR #13 body содержимым раздела `## PR body`.

Перед перемещением task в `done` runner должен проверить, что PR body:

- начинается с `<!-- ai-pr-body:start -->`;
- заканчивается `<!-- ai-pr-body:end -->`;
- содержит раздел `OAuth refresh`;
- содержит раздел `Options metadata invalid symbol`;
- содержит T-061 и T-062 в `Task history`;
- не является body T-060;
- не является placeholder.

Если replacement или verification не выполнены, task должна завершиться fail и остаться вне `done`.

Не писать PR comments, inline comments или review submissions.

## Ограничения

- Изменять только `application/lib/ts/send.js`.
- Не менять API procedures.
- Не менять OAuth code.
- Не менять stream adapter.
- Не менять capacity queue.
- Не менять symbol helpers.
- Не добавлять tests до пользовательской приёмки.
- Не создавать test-only hooks.
- Не создавать новый branch или PR.
- Не коммитить logs, archives, coverage или generated artifacts.

## Критерии готовности

- HTTP 400 JSON `{"Message":"Invalid symbol: SPX"}` получает `code: INVALID_SYMBOL`.
- HTTP 400 JSON `{"Message":"Invalid symbol"}` получает `code: INVALID_SYMBOL`.
- Case-insensitive variant распознаётся.
- Leading/trailing whitespace не мешает распознаванию.
- Plain text `Invalid symbol: SPX` распознаётся.
- Nested JSON string `Invalid symbol: SPX` распознаётся.
- `Invalid symbols` не распознаётся.
- `Request contains an invalid symbol` не распознаётся.
- Другой HTTP 400 не распознаётся.
- 401/403/429/5xx не распознаются.
- Network error остаётся transport `Error`.
- `options/expirations` и `options/strikes` получают существующий `INVALID_SYMBOL` code и возвращают `EINVALIDSYMBOL`.
- OAuth implementation T-061 не изменена.
- Изменён один разрешённый файл.
- Tests не изменены.
- `npm test` проходит.
- PR body полностью заменён и верифицирован.

## Ручная проверка после implementation

1. Вызвать `options/expirations` с symbol, для которого TradeStation отвечает:

```json
{
  "Error": "Failed",
  "Message": "Invalid symbol: SPX"
}
```

Ожидать:

```text
EINVALIDSYMBOL
```

а не RPC 500.

2. Повторить для `options/strikes`.

3. Проверить plain text:

```text
Invalid symbol: SPX
```

4. Проверить отрицательные случаи:

```text
Invalid symbols
Request contains an invalid symbol
Bad request
```

Они не должны получать `INVALID_SYMBOL`.

5. Проверить HTTP 429 и 500 — они не должны получать `INVALID_SYMBOL`.

6. Проверить valid symbol — успешный response не изменён.

7. Проверить, что PR #13 содержит полный body из этой задачи.

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
7. возвращать предсказуемую public contract error для фактического TradeStation `Invalid symbol: <symbol>` в options metadata endpoints.

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

- TradeStation HTTP 400 сохраняется как структурированная integration error в lib layer.
- Точное `Invalid symbol` и production variant `Invalid symbol: <symbol>` классифицируются как `INVALID_SYMBOL`.
- `options/expirations` и `options/strikes` преобразуют только подтверждённый invalid-symbol case в публичный `EINVALIDSYMBOL`.
- Остальные HTTP/transport errors не маскируются под business error.
- Локальная guess-based symbol validation не добавляется.

Пользовательская приёмка результата T-059/T-060/T-061/T-062 ещё не выполнена.

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
- T-062: invalid-symbol classifier поддерживает фактическое production message `Invalid symbol: <symbol>`.
- T-062: PR body workflow требует replacement и verification до завершения task.

## Открытые gaps

- Нет известных implementation gaps после T-062.
- User acceptance pending.
- Accepted-behavior tests pending.

## Пользовательская приёмка

Status: pending.

Acceptance reference: none.

До приёмки требуется staging fault injection для OAuth и runtime-проверка option-chain capacity и invalid-symbol contract на версии с T-059–T-062.

## Regression coverage

### Existing coverage

- Existing `npm test` остаётся regression gate.
- Implementation tasks T-059–T-062 не изменяют test files.

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
- expirations/strikes `Invalid symbol: <symbol>` -> `EINVALIDSYMBOL`;
- прочие HTTP errors не маскируются как invalid symbol.

## Validation

- `npm test` — passed для T-062 перед завершением task.
- Tests в implementation phase не изменялись.

## Task history

- T-056 — primary brokerage order stream recovery.
- T-058 — delivery, hydration, authorization recovery и generation-barrier follow-up.
- T-059 — option-chain managed capacity queue follow-up.
- T-060 — capacity queue continuation и terminal slot release follow-up.
- T-061 — OAuth refresh single-flight и options invalid-symbol contract follow-up.
- T-062 — production invalid-symbol classifier и PR body verification follow-up.
<!-- ai-pr-body:end -->
