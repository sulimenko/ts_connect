# Task T-055: Add bounded retry and stream status for option chain upstream errors

```ai-task-contract
version: 1
task_id: T-055
type: follow_up
human_summary: "Добавить bounded retry и stream/status для retryable option chain upstream errors"
execution_mode: codex

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: ai/T-054-stale-chain-stream
  work_branch_policy: continue_parent_branch
  work_branch: ai/T-054-stale-chain-stream
  allow_new_branch: false
  allow_codex_git: false

scope:
  allowed_files:
    - application/lib/ts/stream.js
    - application/lib/stream/optionChain.js
    - application/domain/ts/streams.js
    - application/domain/ts/client.js
    - application/test/run.js
  forbidden_files:
    - doc/**
    - doc/tasks/**
    - doc/ai/**
    - AGENTS.md
    - application/api/**
    - application/config/**
    - config/**
    - types/**
    - node_modules/**
    - coverage/**
    - dist/**
    - "*.log"
    - "logs/**"
    - "tmp/**"
    - "temp/**"
    - "*.generated.*"

tests:
  required: true
  cover_behavior:
    - "options/chains Failed/Internal server error is retryable before terminal cleanup"
    - "retryable upstream error emits stream/status recovering, not stream/error"
    - "after first Failed/Internal server error total upstream connections can reach 3: initial + 2 reconnect attempts"
    - "after retry budget is exhausted stream/error includes metadata, terminal=true, active=false and resubscribeRequired=true"
    - "after retry budget is exhausted managed chain entry is cleaned and touch returns active=false/resubscribeRequired=true"
    - "INVALID SYMBOL remains terminal without retry"
    - "GoAway remains transient reconnect behavior"
    - "network/socket/terminated read errors keep transient reconnect behavior"
    - "stream/status includes streamKey, metadata, state, retryAttempt, maxRetries, active and resubscribeRequired"
    - "stream/error includes streamKey, metadata, terminal, retryable, active and resubscribeRequired"
    - "console.debug logs recovering, retry attempt, retry exhausted and terminal cleanup without full TradeStation payload"
  allowed_files:
    - application/test/run.js

pr:
  mode: update_existing_parent_pr
  base: develop

validation:
  commands:
    - npm test

diff_budget:
  max_files_changed: 5
  max_added_lines: 260
  max_deleted_lines: 120

commit:
  message: "fix chain stream retry status handling"
```

## Human summary

После T-054 `ts_connect` перестал оставлять stale `active=true` после terminal upstream error. Но свежие логи показывают, что `TradeStation` часто присылает `Failed/Internal server error` на промежуточных option expirations после частичной загрузки chain. Это не всегда настоящий terminal error: повторная подписка часто получает данные.

Нужно точечно улучшить lifecycle для `options/chains`:

- `Failed/Internal server error` для `options/chains` не должен сразу становиться terminal cleanup;
- после первой ошибки должно быть максимум 2 reconnect attempts, то есть всего до 3 upstream connections: initial + 2 reconnect;
- пока retry budget не исчерпан, клиентам нужно отправлять `stream/status` со статусом `recovering`, а не `stream/error`;
- `stream/error` отправлять только после исчерпания retry budget или для настоящих terminal errors вроде `INVALID SYMBOL`;
- ошибки/status должны быть scoped по точному `streamKey` и metadata, чтобы metaterminal не обрабатывал их как глобальный сбой всех chains.

## Problem

Сейчас после `Failed/Internal server error` на options chain поток может быть закрыт как terminal. Это защищает от stale active stream, но слишком агрессивно для промежуточных expirations: TradeStation часто отдаёт часть данных, затем internal error, а повторный stream может успешно догрузить chain.

Нужно сохранить исправление T-054 для настоящего terminal failure, но добавить bounded recovery для retryable upstream failures.

## Task

### 1. Разделить terminal и retryable packet errors

В `application/lib/ts/stream.js` не считать `Failed/Internal server error` всегда immediate terminal для всех streams.

Нужна классификация:

```text
INVALID SYMBOL / invalid symbol errors:
  terminal=true
  retryable=false
  streamStopped=true
  reconnectable=false

GoAway / StreamStatus GoAway:
  terminal=false
  retryable=true
  streamStopped=false
  reconnectable=true

socket/network/terminated read errors:
  terminal=false
  retryable=true
  reconnectable=true

Failed/Internal server error:
  для options/chains должен быть retryable до исчерпания retry budget
  для остальных stream types поведение не ухудшать
```

Можно реализовать через metadata/options в `lib.ts.stream`, например:

```js
retryPolicy: {
  packetErrors: {
    failedInternalServerError: {
      retryable: true,
      maxRetries: 2,
    },
  },
}
```

Или через helper/classification, который учитывает `endpointName()` / endpoint group.

Важно: не ломать `INVALID SYMBOL`: он должен остаться terminal без retry.

### 2. Добавить bounded reconnect для retryable options/chains errors

Для `marketdata/stream/options/chains` при `Failed/Internal server error`:

```text
connection #1: initial subscribe
error #1: Failed/Internal server error
connection #2: reconnect attempt 1
error #2: Failed/Internal server error
connection #3: reconnect attempt 2
error #3: Failed/Internal server error
then terminal stream/error + cleanup
```

То есть после первой ошибки разрешены 2 reconnect, всего 3 подключения.

Требования:

- retry counter должен быть per upstream stream instance / per streamKey;
- counter должен логироваться через `console.debug`;
- после успешного получения нормального data packet можно сбросить consecutive retry counter или пометить recovery as succeeded;
- не запускать бесконечный reconnect;
- не создавать параллельные reconnect timers для одного streamKey;
- controlled stop/unsubscribe/client.close должен отменять pending reconnect.

### 3. Добавить `stream/status`

В `application/domain/ts/streams.js` добавить безопасный способ отправить status клиентам, например:

```js
notifyStatus(entry, status)
```

или расширить существующий emit helper.

Для retryable recovering состояния отправлять:

```js
{
  kind: 'chains',
  streamKey,
  metadata: entry.metadata,
  state: 'recovering',
  reason: 'upstream.Failed',
  active: true,
  resubscribeRequired: false,
  retryable: true,
  terminal: false,
  retryAttempt: 1,
  maxRetries: 2,
  error: {
    message,
    code,
    upstreamMessage,
    symbol
  }
}
```

Event name:

```text
stream/status
```

Для successful recovery можно отправить:

```js
{
  kind: 'chains',
  streamKey,
  metadata: entry.metadata,
  state: 'active',
  reason: 'recovered',
  active: true,
  resubscribeRequired: false,
  retryable: false,
  terminal: false
}
```

Если это слишком много для первого шага, достаточно `recovering` + terminal `stream/error`.

### 4. Улучшить `stream/error` payload

В `application/domain/ts/streams.js` расширить `notifyError(entry, error)`.

Сейчас error payload не содержит metadata/state flags. Нужно добавить:

```js
{
  kind: entry.kind,
  streamKey: entry.key,
  metadata: entry.metadata,
  state: 'failed',
  active: false,
  resubscribeRequired: true,
  retryable: false,
  terminal: true,
  error: serializeError(error)
}
```

Это нужно, чтобы metaterminal понимал, что ошибка относится только к конкретному `streamKey`, например `SOXL?...expiration=2026-07-24...`, а не ко всей доске или всем expirations.

### 5. Обновить option chain adapter

В `application/lib/stream/optionChain.js`:

- retryable upstream error должен приводить к `stream/status recovering`, а не к `stream/error`;
- terminal cleanup через `domain.ts.streams.stopEntry()` должен выполняться только:
  - для `INVALID SYMBOL`;
  - после исчерпания retry budget;
  - для unrecoverable startup failure;
  - при controlled cleanup/unsubscribe/idle/client.close.

Если `lib.ts.stream` сам делает bounded reconnect, `optionChain.js` должен получить callback/status из upstream stream и транслировать его в `domain.ts.streams.notifyStatus(...)`.

Возможный контракт callback:

```js
onStatus({
  state,
  reason,
  retryAttempt,
  maxRetries,
  retryable,
  terminal,
  error,
})
```

### 6. Состояния managed stream

В `domain.ts.streams` поддержать хотя бы логически состояния:

```text
starting
active
recovering
failed
stopping
```

Минимально:

- при retryable upstream error: `entry.state = 'recovering'`;
- `touch()` в recovering должен возвращать:

```js
{
  active: true,
  recovering: true,
  resubscribeRequired: false,
  state: 'recovering'
}
```

- при successful recovery: `entry.state = 'active'`;
- при terminal cleanup: entry удаляется, следующий `touch()` возвращает `active=false/resubscribeRequired=true`.

### 7. Debug logs

Добавить `console.debug` для всех новых действий:

```text
stream/chains recovering status
stream/chains retry scheduled
stream/chains retry start
stream/chains retry exhausted
stream/chains recovered
stream/chains terminal error after retries
managed stream status
managed stream state change
```

Не логировать полный TradeStation payload.

Логировать только агрегаты и metadata:

```text
streamKey
symbol
expiration
optionType
strikeRange
strikeProximity
state
reason
retryAttempt
maxRetries
active
resubscribeRequired
observedStrikes
observedLegs
```

### 8. Throttling не добавлять в эту задачу

Не добавлять полноценный fan-out throttle/concurrency limit в рамках этой задачи, чтобы fix остался точечным.

Но подготовить код так, чтобы в будущем можно было добавить per-symbol throttle без переписывания retry/status lifecycle.

## Tests

Добавить regression tests в `application/test/run.js`.

### Scenario A — retryable Failed/Internal server error emits status, not error

1. Subscribe `options/chains`.
2. Simulate `Failed/Internal server error`.
3. Assert:
   - client получает `stream/status`, not `stream/error`;
   - status has `state='recovering'`;
   - `retryAttempt=1`, `maxRetries=2`;
   - `active=true`, `resubscribeRequired=false`;
   - managed entry remains present;
   - touch returns `active=true`, `recovering=true`.

### Scenario B — total 3 upstream connections

1. Initial connection starts.
2. First `Failed/Internal server error`.
3. Reconnect attempt 1 starts.
4. Second `Failed/Internal server error`.
5. Reconnect attempt 2 starts.
6. Third `Failed/Internal server error`.
7. No fourth connection is started.
8. `stream/error` is emitted.
9. managed entry is cleaned.
10. touch returns `active=false/resubscribeRequired=true`.

### Scenario C — recovered after retry

1. Initial connection gets `Failed/Internal server error`.
2. Retry starts.
3. Retry receives normal chain data packet.
4. Assert:
   - state becomes `active`;
   - optional `stream/status state='active' reason='recovered'` emitted;
   - retry counter reset/cleared;
   - no `stream/error`.

### Scenario D — INVALID SYMBOL remains terminal

1. `INVALID SYMBOL` packet error.
2. No retry.
3. `stream/error` emitted with terminal true.
4. managed entry cleaned.
5. touch returns `active=false/resubscribeRequired=true`.

### Scenario E — GoAway remains transient

1. `GoAway` packet.
2. Reconnect still scheduled.
3. It must not go through terminal stream/error cleanup.

### Scenario F — error payload is scoped

Assert `stream/error` includes:

```js
streamKey
metadata
state: 'failed'
active: false
resubscribeRequired: true
terminal: true
retryable: false
```

Assert `stream/status` includes:

```js
streamKey
metadata
state: 'recovering'
active: true
resubscribeRequired: false
terminal: false
retryable: true
retryAttempt
maxRetries
```

## Constraints

- Не добавлять cache/replay/snapshot fallback в `ts_connect`.
- Не переносить ответственность metaterminal в `ts_connect`.
- Не решать weekly/monthly expiration routing в `ts_connect`.
- Не менять request params для TradeStation options chain.
- Не менять `strikeProximity=1000` для `strikeRange=All`.
- Не возвращать `priceCenter` для `strikeRange=All`.
- Не добавлять глобальный reconnect без лимитов.
- Не логировать полный TradeStation payload.
- Не менять symbol parsing/formatting.
- Не собирать OPT symbol вручную.
- Не менять публичные Impress API procedures.
- Не менять `application/config/log.js`.
- Codex не должен создавать branch, commit, push или PR.

## Acceptance criteria

- `Failed/Internal server error` на options/chains не приводит к immediate terminal cleanup.
- После первой такой ошибки выполняется максимум 2 reconnect attempts, всего максимум 3 upstream connections.
- Во время retry клиент получает `stream/status recovering`, а не terminal `stream/error`.
- `touch()` во время recovery возвращает `active=true`, `recovering=true`, `resubscribeRequired=false`.
- После успешного retry state возвращается в `active`.
- После исчерпания retry budget клиент получает scoped `stream/error` с metadata и terminal flags.
- После исчерпания retry budget managed entry очищается, следующий `touch()` возвращает `active=false/resubscribeRequired=true`.
- `INVALID SYMBOL` остаётся terminal без retry.
- `GoAway` остаётся transient reconnect behavior.
- Debug logs покрывают retry/status/error lifecycle и не содержат полный payload.
- `npm test` проходит.
