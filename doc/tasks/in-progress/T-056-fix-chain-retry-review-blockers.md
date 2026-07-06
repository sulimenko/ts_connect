# Task T-056: Fix option chain retry blockers from review

```ai-task-contract
version: 1
task_id: T-056
type: follow_up
human_summary: "Исправить blockers после review: transient packet errors, GoAway status, live stats и bounded reconnect tests"
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
    - application/domain/ts/client.js
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
    - "unknown retryable packet errors do not become terminal only because maxRetries is 0"
    - "bounded retry exhaustion applies only to configured packet errors such as chains Failed/Internal server error"
    - "GoAway emits stream/status recovering and still schedules reconnect without terminal cleanup"
    - "options/chains Failed/Internal server error still allows initial + 2 reconnect attempts and then terminal stream/error"
    - "no fourth upstream connection is started after retry budget exhaustion"
    - "live stream/chains observed stats include minStrike, maxStrike, minStrikeValue, maxStrikeValue, firstStrikes and lastStrikes"
    - "tests verify real lib.ts.stream packet Error -> status -> reconnect -> exhausted flow"
    - "debug logs and status/error payloads do not include full TradeStation payloads"
  allowed_files:
    - application/test/run.js

pr:
  mode: update_existing_parent_pr
  base: develop

validation:
  commands:
    - npm test

diff_budget:
  max_files_changed: 4
  max_added_lines: 220
  max_deleted_lines: 100

commit:
  message: "fix chain retry review blockers"
```

## Human summary

После T-055 PR #9 стал ближе к нужному поведению: `options/chains` получил bounded retry, `stream/status`, scoped `stream/error` и `recovering` state.

Но review выявил 4 blocker-а, которые нужно исправить до merge:

1. неизвестные packet errors сейчас могут ошибочно становиться terminal из-за `maxRetries: 0`;
2. `GoAway` остаётся transient, но не отправляет `stream/status recovering`;
3. live `stream/chains observed stats` всё ещё потерял поля диапазона strikes из T-053;
4. тесты не проверяют реальный bounded reconnect flow внутри `lib.ts.stream`.

Задача — точечно исправить эти blockers в текущем PR #9, не расширяя scope и не добавляя fan-out throttle.

## Review blockers to fix

### Blocker 1 — не превращать unknown transient packet errors в terminal

В `application/lib/ts/stream.js` сейчас unknown `packet.Error`, который не `INVALID` и не `Failed/Internal server error`, классифицируется как retryable с `maxRetries: 0`.

Из-за этого первый же такой packet error может пройти через retry exhaustion path и стать terminal.

Нужно разделить:

```text
bounded retryable error
transient reconnect error without terminal exhaustion
terminal error
```

Ожидаемая модель:

```js
// INVALID SYMBOL
{
  terminal: true,
  retryable: false,
  bounded: false,
  streamStopped: true,
  reconnectable: false,
  maxRetries: 0
}

// Failed/Internal server error with configured retryPolicy
{
  terminal: false,
  retryable: true,
  bounded: true,
  streamStopped: false,
  reconnectable: true,
  maxRetries: 2
}

// unknown packet error
{
  terminal: false,
  retryable: true,
  bounded: false,
  streamStopped: false,
  reconnectable: true,
  maxRetries: null
}
```

В `handlePacket()` exhaustion должен применяться только если `classification.bounded === true`.

Если `bounded === false`, поведение должно быть старым transient reconnect:

```text
onStatus recovering optional
scheduleReconnect()
return false
```

Не должен вызываться `onError()` и не должен быть `stopStream('permanent-error')`.

### Blocker 2 — GoAway должен отправлять stream/status recovering

`GoAway` должен оставаться transient и reconnect должен сохраняться.

Но перед reconnect нужно отправлять `onStatus`:

```js
this.onStatus?.({
  state: 'recovering',
  reason: 'upstream.GoAway',
  retryAttempt: null,
  maxRetries: null,
  retryable: true,
  terminal: false,
  active: true,
  resubscribeRequired: false,
});
```

Требования:

- не вызывать `onError`;
- не делать terminal cleanup;
- не увеличивать bounded retry counter;
- не влиять на `INVALID SYMBOL`;
- `scheduleReconnect()` должен остаться.

### Blocker 3 — вернуть detailed live observed stats

В `application/lib/stream/optionChain.js` вернуть поля в `stream/chains observed stats`:

```js
const strikes = [...observedStrikes].sort((a, b) => Number(a) - Number(b));
const strikeValues = strikes.map((strike) => Number(strike) / 1000);

minStrike: strikes[0] ?? null,
maxStrike: strikes.at(-1) ?? null,
minStrikeValue: strikeValues[0] ?? null,
maxStrikeValue: strikeValues.at(-1) ?? null,
firstStrikes: strikes.slice(0, 10),
lastStrikes: strikes.slice(-10),
```

Не логировать полный TradeStation payload.

Эти поля нужны для диагностики промежуточных expirations: по ним видно, где оборвался stream до `Failed/Internal server error`.

### Blocker 4 — добавить тест реального bounded reconnect flow

Сейчас тесты проверяют `stream/status` в adapter/domain через ручной вызов `statusHandlers`, но не проверяют реальную цепочку внутри `lib.ts.stream`.

Добавить unit test в `application/test/run.js` на `application/lib/ts/stream.js`.

Тест должен доказать:

```text
1. initial connection стартует;
2. первый packet Error Failed/Internal server error:
   - emits onStatus recovering
   - retryAttempt = 1
   - schedules reconnect
3. reconnect #1 стартует второе подключение;
4. второй packet Error:
   - emits onStatus recovering
   - retryAttempt = 2
   - schedules reconnect
5. reconnect #2 стартует третье подключение;
6. третий packet Error:
   - no fourth connection
   - calls onError with terminal/exhausted flags
   - stopStream('permanent-error')
```

Проверить:

```js
statusEvents.length === 2
statusEvents[0].retryAttempt === 1
statusEvents[1].retryAttempt === 2
terminalErrors.length === 1
terminalErrors[0].exhausted === true
terminalErrors[0].terminal === true
terminalErrors[0].retryable === false
connectionCount === 3
no fourth reconnect timer / no fourth initiateStream
```

Также добавить тест, что unknown packet error без bounded policy не становится terminal:

```text
packet Error SomeTransient / temporary
-> scheduleReconnect
-> onError not called
-> stopStream permanent not called
```

### Blocker 5 — обновить live stats test

В `application/test/run.js` обновить тест `stream optionChain emits root instrument payload while preserving chain symbols` или отдельный live stats test:

Проверить, что `stream/chains observed stats` содержит:

```js
minStrike
maxStrike
minStrikeValue
maxStrikeValue
firstStrikes
lastStrikes
```

И что JSON debug logs не содержат:

```text
"Legs"
"Bid"
"Ask"
```

## Constraints

- Не добавлять fan-out throttle/concurrency limit в этой задаче.
- Не добавлять cache/replay/snapshot fallback в `ts_connect`.
- Не переносить ответственность metaterminal в `ts_connect`.
- Не менять request params для TradeStation options chain.
- Не менять `strikeProximity=1000` для `strikeRange=All`.
- Не возвращать `priceCenter` для `strikeRange=All`.
- Не менять публичные Impress API procedures.
- Не менять `application/config/log.js`.
- Не менять symbol parsing/formatting.
- Не собирать OPT symbol вручную.
- Не менять `DomainError` / `Error` semantics публичных API.
- Codex не должен создавать branch, commit, push или PR.

## Acceptance criteria

- Unknown packet errors без bounded retry policy не становятся terminal из-за `maxRetries: 0`.
- Bounded retry exhaustion применяется только к configured packet errors, прежде всего `Failed/Internal server error` для `options/chains`.
- `Failed/Internal server error` для `options/chains` делает максимум initial + 2 reconnect attempts, всего 3 upstream connections.
- После третьей такой ошибки отправляется scoped terminal `stream/error`, managed entry очищается, следующий `touch()` возвращает `active=false/resubscribeRequired=true`.
- `GoAway` отправляет `stream/status recovering`, сохраняет reconnect behavior и не вызывает terminal cleanup.
- `INVALID SYMBOL` остаётся terminal без retry.
- Live `stream/chains observed stats` содержит min/max/first/last strikes и numeric strike values.
- Тесты покрывают реальный `lib.ts.stream` bounded reconnect flow, а не только ручной вызов adapter status handler.
- Debug logs/status/error payloads не содержат полный TradeStation payload.
- `npm test` проходит.
