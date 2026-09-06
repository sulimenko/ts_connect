# Task T-068: Защитить broker position truth от malformed TradeStation position packets

```ai-task-contract
version: 2
task_id: T-068
type: follow_up
human_summary: "Не допускать, чтобы malformed TradeStation position packet превращался в false zero-close или делал неполный snapshot authoritative; добавить defensive packet guards и исправить PR body T-066."
execution_mode: codex

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: ai/T-066-broker-position-truth
  work_branch_policy: continue_parent_branch
  allow_new_branch: false
  allow_codex_git: false

scope:
  allowed_files:
    - application/domain/ts/client.js
    - application/test/run.js
  forbidden_files:
    - application/api/**
    - application/domain/queue.js
    - application/domain/ts/positions.js
    - application/domain/ts/orders.js
    - application/domain/ts/streams.js
    - application/lib/**
    - config/**
    - types/**
    - doc/**
    - doc/tasks/**
    - doc/ai/**
    - node_modules/**
    - coverage/**
    - dist/**
    - logs/**
    - artifacts/**
    - "*.log"
    - "*.zip"
    - "*.generated.*"

tests:
  phase: implementation
  required: true
  user_acceptance_required: false
  acceptance_reference: T-066
  cover_behavior:
    - "malformed or missing Quantity never mutates position state, publishes a change, or becomes a zero close"
    - "real numeric zero remains a valid position close"
    - "invalid business packet during initial or reconnect snapshot prevents that snapshot from being published as complete"
    - "invalid snapshot does not purge positions omitted because of malformed packets"
    - "mismatched AccountID does not mutate another account registry or publish broker truth under the wrong account"
    - "next valid reconnect snapshot restores normal authoritative snapshot behavior"
    - "existing T-066 initial/reconnect/change/zero behavior remains unchanged"
  allowed_files:
    - application/test/run.js

pr:
  mode: update_existing_parent_pr
  base: develop
  description_mode: replace_from_task
  comments_allowed: false

validation:
  commands:
    - npm test

diff_budget:
  max_files_changed: 2
  max_added_lines: 160
  max_deleted_lines: 80

commit:
  message: "guard brokerage position packets"
```

## Human summary

Review PR #18 по T-066 обнаружил два correctness blocker в новом broker-position-truth lifecycle и один обязательный defensive guard для account boundary.

Главный риск: новый downstream `type=position` должен быть broker truth для `back.ptfin`. Поэтому malformed upstream packet нельзя интерпретировать как реальное изменение позиции, особенно как `Quantity=0`, и повреждённый snapshot нельзя объявлять authoritative `complete=true`.

## 1. Strict Quantity guard до mutation

До вызова:

```js
domain.ts.positions.setPosition(...)
```

валидировать raw `message.Quantity`.

Допустимы numeric значения и numeric strings, включая:

```text
-80
"-80"
0
"0"
80
"80"
```

Значение должно быть непустым и после numeric conversion давать finite number.

Недопустимы:

```text
undefined
null
""
" "
"abc"
NaN
Infinity
```

Malformed Quantity:

- не вызывает `setPosition`;
- не изменяет `domain.ts.positions`;
- не создаёт downstream `change`;
- не создаёт synthetic zero;
- не очищает position;
- логируется как malformed upstream position packet.

Не менять `lib.utils.readPositionQuantity()` в этой задаче. Его существующий registry contract сохранить.

## 2. Account guard

Если `message.AccountID` отсутствует или null, допустимо использовать account stream как сейчас.

Если `message.AccountID` присутствует, его нормализованное значение должно совпадать с account, на который открыт positions stream.

Mismatch:

- не мутирует registry исходного account;
- не мутирует registry другого account;
- не отправляется downstream;
- при active snapshot помечает snapshot invalid;
- логируется как malformed upstream position packet.

Не создавать cross-account fallback.

## 3. Snapshot integrity

Добавить per-stream snapshot integrity state, например эквивалент:

```text
snapshotValid = true
invalidPacketCount = 0
```

Состояние сбрасывается при начале:

```text
initial snapshot
reconnected snapshot
```

Если во время `snapshotActive === true` встречается business packet, который нельзя безопасно включить в authoritative broker snapshot, в том числе:

- invalid/unparseable symbol;
- malformed/missing Quantity;
- mismatched AccountID;

то текущий snapshot становится invalid:

```text
snapshotValid = false
```

На последующем `EndSnapshot`, если snapshot invalid:

- НЕ вызывать authoritative `domain.ts.positions.replaceAccount()`;
- НЕ удалять позиции, отсутствующие в collector;
- НЕ публиковать downstream `event=snapshot` с `complete=true`;
- вывести structured diagnostic минимум с account, streamKey, generation, reason, invalidPacketCount и state;
- очистить временный snapshot collector;
- завершить текущую snapshot phase;
- не запускать blind retry, polling или tight loop.

Valid packets, уже обработанные до malformed packet, могут сохранять существующий T-066 incremental local-registry behavior. Критически важно, чтобы повреждённый collector не становился authoritative и не purged позиции из-за отсутствующего/невалидного packet.

## 4. Real zero сохранить

Настоящий zero остаётся валидным broker event:

```text
Quantity: 0
Quantity: "0"
```

После завершённого initial snapshot сохранить T-066 semantics:

```text
previousQuantity=-80
quantity=0
delta=80
```

Downstream change должен быть queued до удаления local position.

Не считать zero malformed только потому, что значение falsy.

## 5. Invalid incremental packet после snapshot

После `snapshotActive === false` malformed business packet также должен быть rejected до mutation.

Пример:

```text
registry: PINS=-80
packet: Symbol=PINS 260904P22, Quantity="broken"
```

Ожидание:

```text
registry остаётся PINS=-80
no downstream change
no position clear
```

Это отдельный обязательный regression case.

## 6. Logging

Добавить компактный structured warning для malformed position packet.

Поля по возможности:

```text
event=brokerage.position.invalid
account
streamKey
generation
reason=invalid_symbol|invalid_quantity|account_mismatch
upstreamSymbol
positionId
snapshotActive
```

Для Quantity не требуется логировать raw произвольный payload целиком.

Не логировать:

- access token;
- refresh token;
- client secret;
- Authorization header;
- полный contract;
- полный TradeStation packet.

## 7. Tests

Добавить regression coverage минимум для следующих сценариев.

### Incremental malformed Quantity

Исходно:

```text
PINS=-80
```

После complete snapshot прислать:

```text
Quantity="broken"
```

Ожидание:

```text
PINS остаётся -80
нет downstream change
нет zero-close
```

Повторить минимум для missing или blank Quantity.

### Real zero

Исходно:

```text
PINS=-80
```

Packet:

```text
Quantity="0"
```

Ожидание:

```text
previousQuantity=-80
quantity=0
delta=80
```

Downstream change существует до `clearPosition()`.

### Malformed reconnect snapshot

Исходный authoritative registry:

```text
PINS=-80
LI=100
```

Reconnect snapshot:

```text
LI=100
PINS packet с malformed Quantity или invalid symbol
EndSnapshot
```

Ожидание:

- snapshot не публикуется с `complete=true`;
- `replaceAccount()` не выполняет authoritative purge;
- PINS не исчезает из registry из-за повреждённого snapshot;
- есть structured invalid-snapshot diagnostic.

### Account mismatch

Для stream account:

```text
11957784
```

packet:

```text
AccountID=OTHER
Symbol=LI
Quantity=100
```

не должен:

- мутировать `11957784`;
- создавать/изменять `OTHER`;
- публиковать downstream broker truth.

Во время active snapshot такой packet делает snapshot invalid.

### Recovery после invalid snapshot

Следующий reconnect с полностью валидными packets и `EndSnapshot` снова должен публиковать:

```text
event=snapshot
complete=true
reason=reconnected
```

и выполнять authoritative account replacement.

### Existing T-066 regression

Сохранить существующие tests:

- initial complete snapshot;
- `-100 -> -80` даёт `delta=20`;
- duplicate same quantity не создаёт duplicate change;
- zero публикуется до cleanup;
- stale position удаляется valid reconnect snapshot;
- downstream delivery failure не ломает positions stream;
- OAuth refresh/recovery не запускается из-за downstream failure.

## 8. PR body contract

Текущий PR #18 создан с placeholder body:

```text
Automated PR from AI Pipeline v8 contract.
```

T-066 требовал `pr.description_mode: replace_from_task`, но runner не заменил body.

Runner для T-068 обязан полностью заменить PR #18 body содержимым раздела `## PR body` этой follow-up task.

Если PR body не заменён, task должна завершиться fail, а не считаться успешно выполненной.

## Ограничения

- Изменять только `application/domain/ts/client.js` и `application/test/run.js`.
- Не менять `application/domain/ts/positions.js`.
- Не менять `application/lib/**`.
- Не менять `application/domain/queue.js`.
- Не менять public API procedures.
- Не менять orders state/lifecycle.
- Не менять OAuth refresh/recovery.
- Не менять stream adapter.
- Не добавлять polling.
- Не добавлять database/outbox.
- Не классифицировать assignment/exercise.
- Не создавать synthetic order/trade.
- Не добавлять локальные option symbol regex.
- Не создавать новый branch.
- Не создавать новый PR.
- Codex не выполняет git/commit/push/PR actions.
- Не коммитить logs, archives, coverage или generated artifacts.

## Критерии готовности

- Malformed или отсутствующий Quantity никогда не превращается в `0`.
- Malformed Quantity не мутирует и не удаляет существующую position.
- Malformed Quantity не создаёт downstream broker-position change.
- Настоящий numeric zero сохраняет T-066 close semantics.
- Invalid symbol во время snapshot делает snapshot non-authoritative.
- AccountID mismatch не загрязняет другой account registry.
- Повреждённый snapshot никогда не публикуется как `complete=true`.
- Повреждённый snapshot не purges позиции из authoritative registry.
- Следующий полностью valid reconnect снова создаёт authoritative complete snapshot.
- Existing T-066 `-100 -> -80 -> delta=20` behavior не регрессировал.
- Orders behavior не изменён.
- OAuth/recovery behavior не изменён.
- Stream reconnect lifecycle не изменён.
- Изменены только разрешённые файлы.
- Generated artifacts отсутствуют.
- `npm test` проходит.
- PR #18 body полностью заменён содержимым этой task.

## PR body

<!-- ai-pr-body:start -->

# Цель

Надёжно передавать фактическое состояние TradeStation positions в `back.ptfin`, не позволяя malformed upstream packet превращаться в ложное закрытие позиции или ложный complete broker snapshot.

# Реализуемое поведение

- initial/reconnect snapshots становятся authoritative только если все business packets пригодны для безопасной обработки;
- malformed или missing Quantity не трактуется как zero;
- invalid snapshot не purges неизвестные позиции и не публикуется как `complete=true`;
- AccountID mismatch не загрязняет position registry;
- valid zero position продолжает публиковаться до local cleanup;
- normal T-066 snapshot/change downstream contract сохраняется;
- следующий valid reconnect восстанавливает authoritative complete snapshot flow.

# Не входит в задачу

- assignment/exercise classification;
- synthetic trades;
- omnibus allocation;
- back accounting;
- новый polling/outbox;
- изменение TradeStation stream adapter;
- изменение order lifecycle.

<!-- ai-pr-body:end -->
