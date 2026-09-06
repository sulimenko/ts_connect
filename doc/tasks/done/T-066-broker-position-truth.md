# Task T-066: Передавать broker position truth в back.ptfin и диагностировать position drift

```ai-task-contract
version: 2
task_id: T-066
type: primary
human_summary: "Сделать TradeStation positions stream наблюдаемым и пригодным для downstream reconciliation: фиксировать complete position snapshots и quantity changes, очищать исчезнувшие позиции после EndSnapshot и передавать broker position truth в back.ptfin без классификации assignment/exercise внутри ts_connect."
execution_mode: codex

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: none
  work_branch: ai/T-066-broker-position-truth
  work_branch_policy: create_task_branch
  allow_new_branch: true
  allow_codex_git: false

scope:
  allowed_files:
    - application/domain/ts/client.js
    - application/domain/ts/positions.js
    - application/test/run.js
  forbidden_files:
    - application/api/**
    - application/domain/queue.js
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
  acceptance_reference: none
  cover_behavior:
    - "initial positions stream collects a complete account snapshot and publishes it downstream only after EndSnapshot"
    - "reconnected positions stream starts a new snapshot and replaces stale account position state at EndSnapshot"
    - "a position omitted from a later complete snapshot is removed from domain.ts.positions"
    - "quantity change -100 -> -80 publishes previousQuantity=-100 quantity=-80 delta=20"
    - "quantity change to zero is published before the local position is removed"
    - "position symbols are normalized only through shared lib.utils symbol helpers"
    - "duplicate same-quantity packets do not create duplicate quantity-change events"
    - "StreamStatus packets other than EndSnapshot are not published as business positions"
    - "downstream position delivery failure is handled and logged without unhandled rejection"
    - "existing orders stream, OAuth recovery and TradeAction behavior remain unchanged"
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
  max_files_changed: 3
  max_added_lines: 360
  max_deleted_lines: 160

commit:
  message: "report brokerage position truth downstream"
```

## Human summary

Production incident с TradeStation account `11957784` показал, что `ts_connect` получает broker position state и использует его для определения правильного TradeAction, но не сообщает изменение позиции `back.ptfin`.

Пример:

```text
PINS260904P00022000
internal back position: -100

broker position:
-100 -> -80
```

Вероятная причина — assignment 20 short PUT contracts.

После этого `buy 100` уже не являлся допустимым полным `BUYTOCLOSE`, тогда как `buy 80` был корректно отправлен `ts_connect` как `BUYTOCLOSE` и полностью исполнен TradeStation.

`back.ptfin` не получил broker-side delta `+20`, поэтому применил только обычную сделку:

```text
-100 + 80 = -20
```

и сохранил фантомную option position.

Задача `ts_connect` — не классифицировать это событие как assignment, а надёжно передавать broker position truth в downstream back для reconciliation.

## Текущее поведение

`domain.ts.client.streamPositions()` сейчас:

1. подключается к `brokerage/stream/accounts/{account}/positions`;
2. игнорирует packets с `StreamStatus`;
3. нормализует `message.Symbol` через общий symbol helper;
4. сохраняет position в `domain.ts.positions`;
5. при quantity `0` удаляет position из local registry.

Position packets не отправляются в:

```text
domain.queue
→ /response
→ back.ptfin
```

В отличие от orders stream, где downstream delivery уже существует.

Кроме того, текущий positions stream не использует `EndSnapshot` как authoritative account boundary.

Из этого следует отдельный correctness gap:

```text
old local positions:
A
B

new TradeStation snapshot:
A
EndSnapshot
```

после reconnect position `B` может остаться stale в `domain.ts.positions`, если TradeStation просто не включает отсутствующую позицию в новый snapshot.

## Цель

Ввести единый поток broker position truth:

```text
TradeStation positions stream
        ↓
domain.ts.positions
        ↓
structured diagnostics
        ↓
domain.queue
        ↓
POST /response
        ↓
back.ptfin
        ↓
Balance:omnibus-reconcile / equivalent consumer
```

`ts_connect` сообщает факт broker state.

`back.ptfin` определяет accounting meaning.

## 1. Не классифицировать assignment внутри ts_connect

Запрещено в этой задаче:

- создавать synthetic order;
- создавать synthetic trade;
- вычислять option exercise/assignment accounting;
- создавать underlying leg;
- создавать cash leg;
- определять, кому внутри omnibus account принадлежит assignment;
- автоматически называть любой position drift `assignment`;
- изменять back portfolio semantics.

`ts_connect` должен сообщать только наблюдаемое состояние TradeStation.

Допустимые диагностические термины:

```text
position snapshot
position change
position drift
broker position truth
```

Не использовать `assignment` как установленный факт без отдельного upstream evidence.

## 2. Complete positions snapshot

Для каждого account positions stream вести lifecycle snapshot.

При первоначальном подключении:

```text
snapshotReason = initial
snapshotActive = true
```

Business position packets до:

```text
StreamStatus: EndSnapshot
```

должны собираться в отдельный per-stream snapshot collection.

Collection должна быть keyed по canonical symbol.

Raw TradeStation symbol не использовать как registry key.

### EndSnapshot

Когда приходит:

```json
{
  "StreamStatus": "EndSnapshot"
}
```

не игнорировать его полностью.

Он является lifecycle marker complete snapshot.

На `EndSnapshot` необходимо:

1. считать собранный snapshot authoritative для account;
2. привести `domain.ts.positions` к snapshot;
3. удалить local positions, отсутствующие в complete snapshot;
4. сохранить все позиции snapshot в canonical registry;
5. отправить downstream один complete snapshot event;
6. завершить snapshot phase;
7. очистить временный collector.

Replacement account state должен происходить синхронно без `await` между clear и repopulation, чтобы не оставлять observable partially replaced state между event-loop turns.

## 3. Не ухудшить startup behavior

Во время initial snapshot разрешено продолжать обновлять текущий local registry business packets по мере их поступления, если это необходимо для сохранения существующего behavior.

Но на `EndSnapshot` authoritative account state обязательно должен быть пересобран из полного collector.

Цель:

- не увеличивать окно `position miss` при initial startup;
- при этом гарантированно удалять stale positions после complete snapshot.

## 4. Snapshot после reconnect

`application/lib/ts/stream.js` уже сообщает lifecycle через `onStatus`.

При новом upstream connection positions stream должен начать новый snapshot collection.

Минимум обработать:

```text
state = active
reason = reconnected
```

до ingest нового snapshot.

Новый reconnect snapshot не должен смешиваться с предыдущим snapshot или incremental packets.

После нового `EndSnapshot` downstream должен получить новый complete snapshot с `reason: reconnected` или эквивалентным стабильным значением.

Не изменять `application/lib/ts/stream.js` в этой задаче.

Если существующего `onStatus` недостаточно для корректного snapshot lifecycle без изменения stream adapter, task должна fail с диагностикой вместо скрытого архитектурного workaround.

## 5. Downstream contract

Использовать существующий transport:

```js
domain.queue.addTask({
  endpoint: ['response'],
  data: {
    type: 'position',
    data: event,
  },
});
```

Не вызывать `lib.ptfin.send()` напрямую из positions lifecycle.

### Version

Каждый новый payload должен содержать:

```text
version: 1
```

для возможности дальнейшего расширения back contract.

## 6. Snapshot event

Форма должна быть эквивалентна:

```json
{
  "version": 1,
  "event": "snapshot",
  "source": "tradestation",
  "account": "11957784",
  "live": true,
  "complete": true,
  "reason": "initial",
  "streamGeneration": 1,
  "positions": [
    {
      "symbol": "PINS260904P00022000",
      "upstreamSymbol": "PINS 260904P22",
      "positionId": "123",
      "assetType": "OPT",
      "quantity": -80,
      "averagePrice": 0.37,
      "upstreamTimestamp": "2026-09-04T..."
    }
  ]
}
```

Названия optional upstream fields могут быть адаптированы к реальному TradeStation payload, но обязательными для stable downstream reconciliation являются:

```text
version
event
source
account
live
complete
reason
positions[].symbol
positions[].upstreamSymbol
positions[].quantity
```

Если upstream содержит `PositionID`, сохранить его.

Если upstream содержит timestamp, сохранить его.

Не генерировать fake upstream timestamp.

`symbol` — canonical symbol проекта.

`upstreamSymbol` — исходный TradeStation symbol для диагностики.

## 7. Incremental position change

После завершения snapshot phase для каждого business position packet:

1. получить current local position ДО mutation;
2. прочитать signed previous quantity;
3. нормализовать incoming symbol;
4. применить incoming position;
5. прочитать новое signed quantity;
6. вычислить `delta = quantity - previousQuantity`;
7. при реальном quantity change отправить downstream `change` event.

Пример:

```json
{
  "version": 1,
  "event": "change",
  "source": "tradestation",
  "account": "11957784",
  "live": true,
  "complete": false,
  "reason": "stream",
  "streamGeneration": 1,
  "symbol": "PINS260904P00022000",
  "upstreamSymbol": "PINS 260904P22",
  "positionId": "123",
  "assetType": "OPT",
  "previousQuantity": -100,
  "quantity": -80,
  "delta": 20,
  "averagePrice": 0.37,
  "upstreamTimestamp": "2026-09-04T..."
}
```

Для production incident обязательный behavioral case:

```text
previousQuantity = -100
quantity = -80
delta = +20
```

## 8. Zero quantity

Если TradeStation прислал:

```text
previousQuantity = -80
quantity = 0
```

сначала сформировать диагностический/downstream event:

```text
previousQuantity: -80
quantity: 0
delta: +80
```

и только затем удалить local position из registry.

Нельзя удалить запись до получения previous quantity.

После обработки `domain.ts.positions.getPosition(...)` должен возвращать отсутствие позиции.

## 9. Полное исчезновение из snapshot

Если предыдущий registry содержит:

```text
PINS260904P00022000 = -100
```

а новый complete snapshot после reconnect не содержит этот symbol вообще, после `EndSnapshot` local registry не должен продолжать хранить `-100`.

Downstream complete snapshot должен позволять back сделать вывод:

```text
symbol отсутствует в complete broker snapshot
→ broker position = 0
```

Не требуется синтезировать fake TradeStation packet с `Quantity=0`.

Допустимо дополнительно вычислить diagnostics `removedCount`, но complete snapshot остаётся source of truth.

## 10. Duplicate packets

TradeStation stream может повторять одинаковое состояние.

Если:

```text
previousQuantity = -80
incomingQuantity = -80
```

не создавать новый quantity-change downstream event только из-за повторного packet.

Допускается debug log.

Изменение других полей не должно ошибочно выглядеть как quantity drift.

Не добавлять сложную generic position versioning state machine в этой задаче.

## 11. Symbol contract

Все normalization выполнять только через существующие общие helpers:

```text
lib.utils.makeSymbol()
lib.utils.normalizePositionSymbol()
```

или их существующий canonical path.

Запрещено:

- локально разбирать OPT symbol regex;
- вручную собирать OCC-like symbol;
- использовать `padStart` / `padEnd` в positions lifecycle;
- создавать вторую symbol normalization implementation.

При невозможности нормализовать `message.Symbol`:

- не мутировать canonical position registry неправильным key;
- не отправлять malformed downstream position;
- вывести structured warning.

Warning должен содержать минимум:

```text
account
upstreamSymbol
positionId, если есть
streamKey
```

и не содержать secrets.

## 12. Diagnostic logging

Добавить компактные structured logs.

### Snapshot

Пример семантики:

```text
brokerage position snapshot
account=11957784
reason=initial|reconnected
streamKey=11957784
generation=<n>
positionsCount=<n>
removedCount=<n>
changedCount=<n>
state=completed
```

### Change

```text
brokerage position change
account=11957784
symbol=PINS260904P00022000
positionId=<id>
previousQuantity=-100
quantity=-80
delta=20
generation=<n>
```

### Downstream

Должна быть возможность увидеть:

```text
event=brokerage.position.downstream
account
kind=snapshot|change
symbol, если change
state=queued|delivered|failed
```

Названия могут быть адаптированы к существующему log style.

Не логировать:

- access token;
- refresh token;
- client secret;
- Authorization header;
- полный contract;
- полный config.

## 13. Downstream failure

Использовать callback существующей `domain.queue.addTask()` для диагностики delivery.

Failure:

- логируется;
- не создаёт `unhandledRejection`;
- не ломает positions stream;
- не запускает tight retry;
- не запускает OAuth recovery;
- не создаёт второй upstream positions stream.

Не менять `application/domain/queue.js`.

Новый persistent outbox/retry mechanism не входит в scope T-066.

Complete snapshot после initial/reconnect остаётся recovery boundary.

## 14. StreamStatus

`EndSnapshot` теперь имеет lifecycle semantics.

Остальные service packets без business position не отправлять в back как position events.

Сохранить существующее поведение для:

```text
GoAway
StreamStatus: GoAway
heartbeat
authorization failure
transient reconnect
```

Не переносить их в accounting contract.

## 15. Domain helpers

Разрешено добавить минимальные helpers в `application/domain/ts/positions.js`, например для:

- получения plain canonical position record;
- получения account snapshot;
- authoritative replace account snapshot;
- безопасного чтения previous state.

Не переносить downstream transport в `domain.ts.positions`.

`domain.ts.positions` остаётся position state registry.

Отправка в queue и stream lifecycle должны оставаться orchestration уровня client/domain lifecycle.

## 16. Не использовать changes=true

В рамках T-066 не переключать TradeStation positions stream на partial-change mode `changes=true`, если текущий stream получает full position messages.

Причина: partial TradeStation packet может не содержать `Symbol`, тогда текущий canonical symbol contract потребует отдельного `PositionID -> full position` merge lifecycle.

Такой переход является отдельной задачей.

T-066 должна работать с текущим upstream positions stream contract.

## 17. Не менять order behavior

Не регрессировать:

- `domain.ts.orders`;
- order hydration;
- order delivery;
- order generation barrier;
- order reconciliation;
- `BUYTOOPEN/BUYTOCLOSE`;
- `SELLTOOPEN/SELLTOCLOSE`;
- stale-position order recovery;
- capacity conflict handling.

Position downstream events не являются Orders.

## 18. Не менять OAuth/stream recovery

Сохранить:

- unified orders/positions authorization recovery;
- per-client single-flight OAuth refresh;
- `brokerageHealthy()`;
- `recoverBrokerage()`;
- stream reuse;
- reconnect lifecycle;
- `client.close` cleanup.

T-066 использует существующий lifecycle, а не создаёт новый reconnect/polling механизм.

## Тесты

Добавить regression tests минимум для следующих сценариев.

### Initial snapshot

Packets:

```text
position A
position B
EndSnapshot
```

Ожидание:

```text
registry A,B
1 downstream snapshot
complete=true
positions=[A,B]
reason=initial
```

`EndSnapshot` отдельно downstream не отправляется.

### Quantity change

Initial:

```text
PINS = -100
EndSnapshot
```

затем:

```text
PINS = -80
```

Ожидание:

```text
previousQuantity=-100
quantity=-80
delta=20
```

и один downstream `change`.

### Zero

```text
PINS = -80
→ PINS = 0
```

Ожидание:

```text
change:
previous=-80
quantity=0
delta=80
```

после чего local registry не содержит PINS.

### Reconnect complete snapshot

Первый snapshot:

```text
PINS=-100
LI=100
EndSnapshot
```

Reconnect.

Второй snapshot:

```text
LI=100
EndSnapshot
```

Ожидание:

```text
PINS отсутствует в local registry
complete downstream snapshot содержит только LI
reason=reconnected
```

Это обязательный regression test против stale disappeared positions.

### Duplicate quantity

```text
PINS=-80
PINS=-80
```

не создаёт второй quantity-change event.

### Invalid symbol

Ненормализуемый upstream option symbol:

- не создаёт malformed registry entry;
- не публикуется downstream;
- обрабатывается без падения stream callback.

### Downstream failure

Имитировать rejected downstream delivery callback.

Ожидание:

- handled failure;
- stream остаётся active;
- нет `unhandledRejection`;
- нет duplicate stream;
- нет OAuth refresh.

## Ограничения

- Изменять только разрешённые файлы.
- Не менять `application/domain/queue.js`.
- Не менять `application/lib/ts/stream.js`.
- Не менять public API procedures.
- Не добавлять новый REST endpoint.
- Не добавлять polling.
- Не добавлять database/outbox.
- Не классифицировать assignment/exercise.
- Не создавать synthetic order/trade.
- Не менять symbol helpers.
- Не добавлять локальные option regex.
- Не добавлять новые dependencies.
- Не коммитить production logs, `streams.zip`, `laravel_small.log`, archives, coverage или generated artifacts.
- Codex не создаёт branch, commit, push или PR.
- Runner выполняет git/validation/commit/PR lifecycle.

## Критерии готовности

- `ts_connect` публикует complete broker position snapshot после initial `EndSnapshot`.
- `ts_connect` публикует новый complete snapshot после reconnect.
- Complete snapshot имеет `complete=true`.
- Account и canonical symbol передаются явно.
- Signed TradeStation quantity сохраняется без изменения знака.
- Quantity transition `-100 -> -80` даёт `delta=20`.
- Zero transition публикуется до удаления local position.
- Позиция, отсутствующая в новом complete snapshot, удаляется из local registry.
- Back может отличить complete snapshot от incremental change.
- Back получает payload через существующий `/response` queue path.
- Duplicate same-quantity packet не создаёт duplicate quantity-change event.
- Position normalization использует только общие symbol helpers.
- Ненормализуемый symbol диагностируется и не портит registry.
- `EndSnapshot` не рассматривается как business position.
- Остальные `StreamStatus` не отправляются как accounting events.
- Downstream failure не останавливает upstream positions stream.
- Downstream failure не создаёт unhandled rejection.
- Нового polling/retry loop нет.
- Orders behavior не изменён.
- OAuth/recovery behavior не изменён.
- `client.close` cleanup не регрессировал.
- Изменены только разрешённые файлы.
- Generated artifacts отсутствуют.
- `npm run lint` проходит.
- `npm run types` проходит.
- `npm test` проходит.

## Ручная production/staging диагностика

После deploy на staging или controlled production проверить account `11957784`.

В логах должно быть видно создание initial complete snapshot.

Для позиции `PINS260904P00022000` при broker transition `-100 -> -80` должна появиться диагностика:

```text
previousQuantity=-100
quantity=-80
delta=20
```

и соответствующий downstream `type=position`.

После reconnect должен появиться:

```text
event=snapshot
complete=true
reason=reconnected
```

Если symbol исчез из broker snapshot полностью, он должен исчезнуть и из `domain.ts.positions`.

## PR body

<!-- ai-pr-body:start -->

# Цель

Передавать фактическое состояние TradeStation brokerage positions в `back.ptfin`, чтобы back мог обнаруживать broker-side position changes, которые не представлены обычным order fill: assignment/exercise, expiration, transfer, corporate action, broker adjustment и другие reconciliation cases.

`ts_connect` не классифицирует экономический смысл изменения и не создаёт synthetic transactions.

# Изменения

- positions stream использует `EndSnapshot` как complete account boundary;
- initial и reconnect snapshots становятся authoritative для local position registry;
- stale positions, отсутствующие в новом snapshot, удаляются;
- quantity changes получают structured previous/current/delta diagnostics;
- complete snapshot и incremental quantity changes отправляются в `/response` как `type=position`;
- canonical symbols формируются существующими shared helpers;
- downstream failure не нарушает upstream stream lifecycle.

# Не входит в задачу

- accounting assignment/exercise;
- synthetic trades;
- omnibus allocation;
- back balance correction;
- новый polling;
- новый outbox;
- изменение TradeStation stream adapter;
- изменение order lifecycle.

<!-- ai-pr-body:end -->
