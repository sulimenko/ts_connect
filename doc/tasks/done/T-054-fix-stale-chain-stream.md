# Task T-054: Fix stale active option chain stream after upstream terminal error

```ai-task-contract
version: 1
task_id: T-054
type: primary
human_summary: "Исправить stale active для option chain stream после upstream terminal error и добавить console.debug lifecycle logs"
execution_mode: codex

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: none
  work_branch_policy: create_task_branch
  work_branch: ai/T-054-stale-chain-stream
  allow_new_branch: true
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
    - "option chain upstream terminal error does not leave managed stream touch active=true"
    - "clients receive stream/error before failed managed chain stream cleanup"
    - "next touch after upstream terminal error returns active=false and resubscribeRequired=true"
    - "INVALID SYMBOL remains terminal and does not start infinite reconnect"
    - "GoAway remains transient and keeps reconnect behavior"
    - "network/socket/transient read errors keep reconnect behavior"
    - "console.debug logs option chain subscribe, touch, unsubscribe, upstream error, cleanup and stop actions"
    - "console.debug lifecycle logs do not include full TradeStation payloads"
  allowed_files:
    - application/test/run.js

pr:
  mode: create_new
  base: develop

validation:
  commands:
    - npm test

diff_budget:
  max_files_changed: 5
  max_added_lines: 220
  max_deleted_lines: 80

commit:
  message: "fix stale chain stream after upstream error"
```

## Human summary

После последних проверок основная проблема с weekly/monthly expirations относится к `metaterminal`: он должен решать, когда делать новую подписку, когда отдавать cache/replay второму клиенту или переподключившемуся первому, когда делать snapshot fallback и как управлять timers/unsubscribe.

Но в `ts_connect` остаётся отдельная ошибка lifecycle: upstream TradeStation stream может остановиться из-за terminal/permanent error, а managed stream в `domain.ts.streams` продолжает считаться активным. В результате следующий `touch` может вернуть `active=true`, хотя реальный upstream channel уже умер и новых `stream/chain` событий не будет.

Нужно исправить это в `ts_connect`: terminal upstream error должен переводить managed option chain stream в неактивное состояние, чтобы следующий `touch` вернул `active=false` и `resubscribeRequired=true`.

Дополнительно нужно добавить подробное lifecycle-логирование через `console.debug`, чтобы видеть все действия по option chain stream без шума на обычном log level.

## Problem

Сейчас возможен сценарий:

```text
1. metaterminal делает subscribe на option chain.
2. ts_connect создаёт managed stream entry.
3. TradeStation присылает Error packet, например Failed/Internal server error.
4. lib.ts.stream классифицирует ошибку как terminal/permanent и останавливает upstream stream.
5. managed entry в domain.ts.streams остаётся.
6. metaterminal делает touch.
7. touch видит entry + subscriber и возвращает active=true.
8. metaterminal думает, что канал живой, и не создаёт новый subscribe.
9. Данные по chain больше не приходят.
```

Это неправильное состояние. Если upstream stream terminal-failed, managed stream не должен оставаться `active=true`.

## Task

### 1. Явно маркировать upstream terminal errors в `application/lib/ts/stream.js`

В `application/lib/ts/stream.js` при обработке `packet.Error` нужно вычислять classification до вызова `onError`.

Для error object добавить признаки:

```js
error.permanent = permanent;
error.reconnectable = !permanent;
error.streamStopped = permanent;
```

Где `permanent` остаётся совместимым с текущей логикой:

- `INVALID SYMBOL` / invalid symbol errors — terminal/permanent;
- `Failed` + `Internal server error` — terminal для текущего stream channel;
- `GoAway` / `StreamStatus: 'GoAway'` — transient, reconnect ожидаем;
- socket/network/terminated read errors — transient, reconnect ожидаем.

Важно: не запускать бесконечный reconnect для terminal errors.

### 2. Закрывать managed option chain stream после terminal upstream error

В `application/lib/stream/optionChain.js` изменить `onError`.

Сейчас `onError` не должен только логировать и делать `notifyError(error)`. Если ошибка terminal/permanent, нужно после уведомления клиента закрыть managed stream entry.

Ожидаемая логика:

```js
const onError = (error) => {
  clearStats();
  writeStats('error');

  console.debug('stream/chains upstream error', {
    streamKey: key,
    symbol: symbol.toUpperCase(),
    expiration: data.expiration ?? null,
    code: error?.code ?? null,
    message: error?.message ?? String(error),
    permanent: Boolean(error?.permanent || error?.streamStopped),
    reconnectable: error?.reconnectable ?? null,
  });

  console.error('stream chain error:', error);
  notifyError(error);

  if (error?.permanent || error?.streamStopped) {
    void domain.ts.streams
      .stopEntry({
        kind: 'chains',
        key,
        reason: error.code ? `upstream.${error.code}` : 'upstream.permanent-error',
      })
      .catch((cleanupError) => {
        console.error('Failed to stop failed chain managed stream:', key, cleanupError);
      });
  }
};
```

Точная реализация может отличаться, но поведение должно быть таким:

```text
stream/error отправлен клиентам
managed entry удалён/остановлен
следующий touch возвращает active=false + resubscribeRequired=true
```

### 3. Не ломать transient reconnect

Не менять корректное transient-поведение:

- `GoAway` должен оставаться transient event, после которого reconnect ожидаем.
- socket/network/terminated close должен продолжать reconnect.
- controlled stop/unsubscribe/client.close не должен превращаться в error.
- `INVALID SYMBOL` не должен запускать бесконечный reconnect.

### 4. Добавить `console.debug` lifecycle logs для option chain stream

Добавить debug logs для всех важных действий option chain stream lifecycle.

Логи должны быть через:

```js
console.debug(...)
```

Не использовать `console.info` для нового verbose lifecycle logging.

Не добавлять новый env flag.

Не менять `application/config/log.js`: admin может включить debug-level через существующий механизм логирования.

Минимальные debug events:

```text
stream/chains action start
stream/chains action done
stream/chains subscribe requested
stream/chains subscribe result
stream/chains touch requested
stream/chains touch result
stream/chains unsubscribe requested
stream/chains unsubscribe result
stream/chains upstream start
stream/chains upstream ready
stream/chains upstream error
stream/chains terminal cleanup start
stream/chains terminal cleanup done
stream/chains stop requested
stream/chains stop done
stream/chains observed stats
```

Допустимые поля:

```text
phase
streamKey
symbol
expiration
expiration2
strikeRange
strikeProximity
optionType
strikeInterval
action
active
created
subscribed
subscribers
resubscribeRequired
reason
code
message
permanent
reconnectable
durationMs
observedStrikes
observedLegs
```

Нельзя логировать полный TradeStation payload.

### 5. Добавить/уточнить debug logs в `domain.ts.streams`

В `application/domain/ts/streams.js` добавить `console.debug` для managed stream lifecycle:

```text
managed stream subscribe requested
managed stream subscribe existing
managed stream subscribe created
managed stream touch missing
managed stream touch not-subscribed
managed stream touch active
managed stream unsubscribe
managed stream stop start
managed stream stop done
managed stream dropped event
```

Логи должны помогать понять:

```text
почему touch вернул active=true/false
сколько subscribers
какой reason
был ли upstreamReady
какое состояние entry
```

Не менять публичный API без необходимости.

### 6. Добавить/уточнить debug logs в `domain.ts.client`

В `application/domain/ts/client.js` добавить `console.debug` вокруг stored upstream streams:

```text
stored stream set
stored stream stop requested
stored stream stop done
stored stream stop missing
```

Для group `chains` это особенно важно, чтобы видеть, был ли реально остановлен underlying TS stream.

### 7. Regression tests

Добавить тесты в `application/test/run.js`.

Обязательные сценарии:

#### Scenario A — terminal upstream error closes managed chain entry

1. Создать managed chain subscribe.
2. Смоделировать upstream error:

```js
const error = new Error('Failed: Internal server error');
error.code = 'Failed';
error.upstreamMessage = 'Internal server error';
error.permanent = true;
error.streamStopped = true;
error.reconnectable = false;
```

3. Проверить, что subscriber получил `stream/error`.
4. Проверить, что managed entry удалён.
5. Проверить, что следующий `touch` возвращает:

```js
active: false;
resubscribeRequired: true;
```

#### Scenario B — transient error does not remove managed entry

1. Смоделировать transient reconnectable error:

```js
error.permanent = false;
error.reconnectable = true;
```

2. Проверить, что managed entry не удаляется только из-за transient error.
3. Проверить, что `touch` остаётся active, если subscriber ещё есть.

#### Scenario C — `lib.ts.stream` error metadata

Проверить, что `packet.Error` создаёт error object с полями:

```js
permanent;
reconnectable;
streamStopped;
code;
upstreamMessage;
details;
symbol;
```

Для `INVALID SYMBOL`:

```js
permanent === true;
reconnectable === false;
streamStopped === true;
```

Для `GoAway` не должно быть terminal error path.

#### Scenario D — debug logs

Проверить, что lifecycle logs пишутся через `console.debug`, а не через `console.info/warn/error`, кроме реальных ошибок.

Не нужно проверять `application/config/log.js`.

## Important constraints

- Не добавлять cache/replay/snapshot fallback в `ts_connect`.
- Не переносить ответственность `metaterminal` в `ts_connect`.
- Не решать weekly/monthly expiration routing в `ts_connect`.
- Не менять request params для TradeStation options chain.
- Не менять `strikeProximity=1000` для `strikeRange=All`.
- Не возвращать `priceCenter` для `strikeRange=All`.
- Не создавать бесконечный reconnect для terminal errors.
- Не логировать полный TradeStation payload.
- Не менять symbol parsing/formatting.
- Не собирать OPT symbol вручную.
- Не менять `DomainError` / `Error` semantics публичных API.
- Codex не должен создавать branch, commit, push или PR.

## Acceptance criteria

- После terminal upstream error managed option chain stream не остаётся `active=true`.
- Клиенты получают `stream/error` до cleanup failed stream.
- Следующий `touch` после terminal upstream error возвращает `active=false` и `resubscribeRequired=true`.
- `INVALID SYMBOL` не запускает бесконечный reconnect.
- `Failed/Internal server error` не оставляет stale active managed stream.
- `GoAway` остаётся transient и не удаляет managed entry как terminal error.
- socket/network transient close сохраняет reconnect behavior.
- `console.debug` покрывает все важные lifecycle actions для option chain stream.
- Debug logs не содержат полный TradeStation payload.
- `ts_connect` не добавляет cache/replay/snapshot fallback.
- `npm test` проходит.
