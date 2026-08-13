# Task T-063: Восстановить brokerage streams после успешного OAuth refresh

```ai-task-contract
version: 2
task_id: T-063
type: follow_up
human_summary: "После успешного lifetime OAuth refresh автоматически восстановить остановленные orders/positions streams, если предыдущий authorization recovery завершился из-за refresh failure, без второго OAuth request, deadlock или дублирования streams."
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
  forbidden_files:
    - application/test/**
    - test/**
    - tests/**
    - "**/*.test.js"
    - "**/*.spec.js"
    - application/api/**
    - application/domain/queue.js
    - application/domain/ts/clients.js
    - application/domain/ts/orders.js
    - application/domain/ts/streams.js
    - application/lib/**
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
  max_added_lines: 140
  max_deleted_lines: 80

commit:
  message: "recover brokerage streams after oauth refresh"
```

## Human summary

Итоговый review PR #13 подтвердил корректность T-056–T-062, но обнаружил один lifecycle blocker.

При authorization failure текущий `recoverBrokerage()`:

1. останавливает orders и positions streams;
2. пытается обновить OAuth token;
3. при network failure завершает recovery со значением `false`;
4. очищает `brokerage.recovery`.

Lifetime timer продолжает работать и позднее может успешно выполнить `refreshAccessToken({ reason: 'lifetime' })`.

Однако успешный lifetime refresh только обновляет token state. Он не вызывает восстановление остановленных brokerage streams.

В результате после восстановления сети возможно состояние:

```text
OAuth token успешно обновлён
brokerage accounts сохранены
orders stream отсутствует или остановлен
positions stream отсутствует или остановлен
brokerage.ready = false
brokerage recovery не выполняется
```

Streams восстанавливаются только после случайного внешнего вызова, который снова запускает `syncBrokerageStreams()`.

## Требуемое поведение

### 1. После успешного lifetime refresh восстановить brokerage streams

После успешного завершения:

```js
await this.refreshAccessToken({ reason: 'lifetime' });
```

проверить необходимость восстановления brokerage lifecycle.

Recovery требуется только если одновременно выполняются условия:

- client не закрыт;
- `brokerage.accounts.size > 0`;
- `brokerageHealthy()` возвращает `false`;
- streams действительно требуют восстановления;
- recovery не должен создавать новый OAuth request.

Запустить или присоединиться к единственному:

```js
recoverBrokerage({
  reason: 'oauth.recovered',
  authorization: false,
});
```

Название reason может быть эквивалентным, но должно однозначно указывать на восстановление после успешного OAuth refresh.

### 2. Не создавать второй OAuth refresh

Восстановление после успешного lifetime refresh должно использовать уже обновлённый access token.

Запрещено:

- передавать `authorization: true`;
- повторно вызывать `refreshAccessToken()` для этого recovery;
- выполнять второй OAuth request;
- создавать blind retry;
- добавлять новый polling loop.

### 3. Исключить Promise cycle и deadlock

Нельзя вызывать или ожидать brokerage recovery изнутри ещё выполняющегося shared refresh Promise так, чтобы возник цикл:

```text
recoverBrokerage
  -> await refreshAccessToken
     -> await recoverBrokerage
```

Recovery должен запускаться только после того, как shared refresh Promise завершился и `tokenRefresh` может быть безопасно освобождён.

Предпочтительный минимальный вариант:

- выполнить проверку и recovery в lifetime caller после `await refreshAccessToken(...)`;
- либо использовать эквивалентный post-refresh helper, который гарантированно выполняется после завершения shared refresh.

### 4. Сохранить single-flight recovery

Если в момент post-refresh проверки уже выполняется `brokerage.recovery`:

- не создавать второй recovery;
- использовать существующий single-flight flow;
- не останавливать streams повторно;
- не дублировать orders/positions subscriptions.

После восстановления на один account должно существовать не более одного usable orders stream и одного usable positions stream.

### 5. Сохранить close lifecycle

Если client закрыт:

- не запускать post-refresh recovery;
- не создавать новые streams;
- не планировать новый lifetime timer;
- не восстанавливать уже закрытые subscriptions.

Если `close()` произошёл во время OAuth request, последующий success не должен воскресить brokerage lifecycle.

### 6. Не запускать ненужный recovery

Post-refresh recovery не требуется, если:

- brokerage accounts ещё не загружены;
- orders и positions streams уже healthy;
- client закрыт;
- refresh завершился ошибкой.

Успешный normal lifetime refresh при healthy brokerage lifecycle не должен перезапускать streams.

### 7. Сохранить текущие contracts

Не регрессировать:

- общий per-client `tokenRefresh`;
- single-flight initial setup через `connecting[name]`;
- bounded brokerage recovery;
- максимум два recovery cycle;
- handled lifetime rejection;
- сохранение действующего token state после refresh failure;
- `Error` для OAuth/transport failures;
- отсутствие `DomainError` в domain/lib OAuth lifecycle;
- orders/positions unified recovery;
- stream registry cleanup;
- generation barrier и order reconciliation;
- option capacity queue;
- invalid-symbol contract;
- symbol helpers и formatting contract.

## Logging

Разрешён компактный безопасный lifecycle log со значениями:

```text
event: brokerage.recovery
reason: oauth.recovered
state: skipped | started | shared | completed | failed
closed
healthy
accountCount
```

Не логировать:

- access token;
- refresh token;
- client secret;
- OAuth request body;
- полный account contract;
- полный config.

## Ограничения

- Изменять только `application/domain/ts/client.js`.
- Не менять `lib.ts.refresh`.
- Не менять `domain.ts.clients`.
- Не менять API procedures.
- Не менять orders state.
- Не менять managed capacity queue.
- Не менять stream adapter.
- Не добавлять tests до пользовательской приёмки.
- Не создавать test-only hooks.
- Не создавать новый branch или PR.
- Не писать PR comments, inline comments или review submissions.
- Не коммитить logs, archives, coverage или generated artifacts.

## Критерии готовности

- Authorization recovery может завершиться после network failure без остановки процесса.
- После восстановления сети следующий успешный lifetime refresh запускает восстановление unhealthy brokerage streams.
- Orders и positions streams после recovery снова usable.
- Для post-refresh recovery не выполняется второй OAuth request.
- Одновременные lifetime refresh и authorization failure используют один refresh Promise.
- Одновременные post-refresh triggers используют один brokerage recovery.
- Отсутствует Promise cycle или deadlock между `refreshAccessToken()` и `recoverBrokerage()`.
- Healthy brokerage streams не перезапускаются после обычного lifetime refresh.
- При пустом `brokerage.accounts` recovery не запускается.
- После `client.close` recovery и streams не воскрешаются.
- Failed lifetime refresh не запускает brokerage recovery.
- Failed lifetime refresh не создаёт `unhandledRejection`.
- Нет synchronous или tight retry loop.
- Existing token state не очищается при failure.
- Изменён только `application/domain/ts/client.js`.
- Tests не изменены.
- Generated artifacts отсутствуют.
- `npm test` проходит.
- PR body полностью заменён содержимым этой task.

## Ручная проверка после implementation

1. Запустить client с активными orders и positions streams.
2. Смоделировать authorization failure обоих streams.
3. Заблокировать `signin.tradestation.com`.
4. Убедиться, что brokerage recovery:
   - остановил stale streams;
   - получил handled refresh failure;
   - не создал `unhandledRejection`;
   - не вошёл в tight loop.
5. Восстановить сеть.
6. Дождаться следующего lifetime refresh.
7. Проверить:
   - выполнен один OAuth request;
   - access token обновлён;
   - выполнен один brokerage recovery;
   - orders stream восстановлен;
   - positions stream восстановлен;
   - `brokerageHealthy()` возвращает `true`;
   - `brokerage.ready === true`.
8. Повторить при уже healthy streams — streams не должны пересоздаваться.
9. Повторить с одновременным authorization failure во время lifetime refresh — не должно быть второго refresh или deadlock.
10. Закрыть client во время OAuth request — после success streams и timer не должны восстановиться.

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
7. восстанавливать brokerage streams после успешного OAuth refresh, если предыдущий recovery завершился из-за временной сетевой ошибки;
8. возвращать предсказуемую public contract error для фактического TradeStation `Invalid symbol: <symbol>` в options metadata endpoints.

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
- После успешного lifetime refresh unhealthy brokerage lifecycle автоматически восстанавливает orders и positions без второго OAuth request.
- `client.close` прекращает timer lifecycle и не допускает восстановления streams или повторного планирования timer.

### Options metadata invalid symbol

- TradeStation HTTP 400 сохраняется как структурированная integration error в lib layer.
- Точное `Invalid symbol` и production variant `Invalid symbol: <symbol>` классифицируются как `INVALID_SYMBOL`.
- `options/expirations` и `options/strikes` преобразуют только подтверждённый invalid-symbol case в публичный `EINVALIDSYMBOL`.
- Остальные HTTP/transport errors не маскируются под business error.
- Локальная guess-based symbol validation не добавляется.

Пользовательская приёмка результата T-059–T-063 ещё не выполнена.

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
- T-062: восстановлен полный PR body workflow.
- T-063: после успешного lifetime OAuth refresh восстанавливаются unhealthy brokerage orders/positions streams без второго OAuth request.

## Открытые gaps

- Нет известных implementation gaps после T-063.
- User acceptance pending.
- Accepted-behavior tests pending.

## Пользовательская приёмка

Status: pending.

Acceptance reference: none.

До приёмки требуется staging fault injection для OAuth и runtime-проверка option-chain capacity и invalid-symbol contract на версии с T-059–T-063.

## Regression coverage

### Existing coverage

- Existing `npm test` остаётся regression gate.
- Implementation tasks T-059–T-063 не изменяют test files.

### Pending after acceptance

После явной пользовательской приёмки отдельная accepted-behavior follow-up task должна покрыть:

- initial option-chain HTTP 429 -> queued RPC result;
- сохранение subscribers и managed entry;
- FIFO drain и continuation после первого успешного startup;
- terminal cleanup active stream -> запуск следующей queued entry;
- matrix capacity regression;
- lifetime OAuth network failure без `unhandledRejection`;
- failed authorization recovery -> успешный lifetime refresh -> восстановление orders/positions;
- concurrent lifetime/recovery -> один refresh Promise и один recovery;
- отсутствие deadlock между refresh и recovery;
- close во время timer callback или OAuth request без timer/stream resurrection;
- expirations/strikes `Invalid symbol: <symbol>` -> `EINVALIDSYMBOL`;
- прочие HTTP errors не маскируются как invalid symbol.

## Validation

- `npm test` должен пройти для T-063 перед завершением task.
- Tests в implementation phase не изменяются.

## Task history

- T-056 — primary brokerage order stream recovery.
- T-058 — delivery, hydration, authorization recovery и generation-barrier follow-up.
- T-059 — option-chain managed capacity queue follow-up.
- T-060 — capacity queue continuation и terminal slot release follow-up.
- T-061 — OAuth refresh single-flight и options invalid-symbol contract follow-up.
- T-062 — production invalid-symbol classifier и PR body verification follow-up.
- T-063 — brokerage recovery после успешного lifetime OAuth refresh.
<!-- ai-pr-body:end -->
