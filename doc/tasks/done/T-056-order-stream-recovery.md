# Task T-056: Исправить потерю realtime-обновлений ордеров и отправку неполных order payload

```ai-task-contract
version: 1
task_id: T-056
type: primary
human_summary: "Сделать brokerage order stream восстанавливаемым, исключить блокировку downstream queue и не отправлять неполные order payload без symbol."
execution_mode: codex

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: none
  work_branch: ai/T-056-order-stream-recovery
  work_branch_policy: create_task_branch
  allow_new_branch: true
  allow_codex_git: false

scope:
  allowed_files:
    - application/api/account/orders.js
    - application/api/account/historicalorders.js
    - application/domain/queue.js
    - application/domain/ts/client.js
    - application/domain/ts/clients.js
    - application/domain/ts/orders.js
    - application/lib/ts/orders.js
    - application/lib/ts/stream.js
    - application/test/run.js
  forbidden_files:
    - doc/**
    - config/**
    - types/**
    - node_modules/**
    - coverage/**
    - dist/**
    - logs/**
    - artifacts/**
    - "*.log"

tests:
  required: true
  cover_behavior:
    - "Rejected downstream request always releases its queue concurrency slot and does not block later tasks."
    - "After twenty consecutive downstream failures, the next successful order task is still processed."
    - "A terminally stopped brokerage order stream is not treated as active only because its stored key still exists."
    - "Transient close, heartbeat timeout and GoAway keep the order stream recoverable and cause reconciliation after reconnect."
    - "Authorization failure uses bounded single-flight token refresh and resubscription instead of leaving a stale stream."
    - "INVALID or another permanent non-authorization error does not start an infinite reconnect loop."
    - "An order packet missing AccountID, Legs or Legs[].Symbol is hydrated from cached or REST order state before delivery."
    - "An order that cannot be hydrated to the required shape is not forwarded as a normal complete order event."
    - "REST orders and historicalorders handlers tolerate absent or null Errors and Orders fields."
    - "Initial subscription and reconnect reconciliation do not emit duplicate unchanged order states."
  allowed_files:
    - application/test/run.js

pr:
  mode: create_new
  base: develop

validation:
  commands:
    - npm run lint
    - npm run types
    - npm test

diff_budget:
  max_files_changed: 9
  max_added_lines: 900
  max_deleted_lines: 450

commit:
  message: "fix brokerage order stream recovery"
```

## Human summary

Исправить периодическую остановку realtime-обновлений ордеров, после которой актуальное состояние восстанавливается только ручным вызовом `account/orders` и `account/historicalorders`.

Исправление должно закрыть связанные причины:

1. остановленный upstream order stream остаётся в registry и ошибочно считается активным;
2. `brokerage.ready` не отражает фактическое состояние order streams;
3. rejected downstream-запрос может навсегда занять concurrency slot в `domain.queue`;
4. частичный TradeStation packet может быть отправлен в следующий проект без обязательных полей, включая `Legs[].Symbol`;
5. между disconnect и reconnect могут быть потеряны изменения ордеров, которые требуется восстановить REST reconciliation.

## Текущее проблемное поведение

### Stale order stream

`application/domain/ts/client.js` считает order stream существующим, если в `streams.orders` уже есть запись:

```js
if (bucket[key]) return key;
```

После terminal error `lib.ts.stream` может окончательно остановить соединение, но stored entry остаётся в bucket.

Одновременно `brokerage.ready` может продолжать иметь значение `true`. Последующий `syncBrokerageStreams()` возвращает успех без проверки фактического состояния upstream stream.

В результате:

```text
stored entry существует
brokerage.ready = true
upstream stream остановлен
reconnect выключен
новые order events отсутствуют
```

### Блокировка downstream queue

`application/domain/queue.js` увеличивает `count` перед асинхронной отправкой.

Если `lib.ptfin.send()` отклоняет Promise, `finish()` может не вызваться. Тогда:

- `count` не уменьшается;
- concurrency slot теряется;
- событие считается незавершённым;
- после накопления отказов очередь перестаёт обрабатываться.

### Неполный order payload

Order packet передаётся дальше практически только по наличию `OrderID`.

Не проверяются:

- `AccountID`;
- наличие и тип `Legs`;
- наличие `Legs[].Symbol`;
- возможность восстановить недостающие поля из предыдущего состояния;
- повторная отправка идентичного состояния.

Нельзя считать любой packet с `OrderID` полноценным downstream order.

## Требуемое поведение

### 1. Гарантировать завершение каждой queue task

Исправить `application/domain/queue.js` так, чтобы для каждой запущенной задачи `finish()` вызывался ровно один раз:

- при успешном результате;
- при rejected Promise;
- при синхронном исключении;
- при process timeout, если timeout активирован.

После любой ошибки:

- `count` уменьшается;
- очередь продолжает обработку следующих элементов;
- ошибка попадает в существующий failure path;
- не возникает необработанного rejected Promise из `queue.send()`.

Не добавлять бесконечные или слепые retries. Повторная доставка order state должна обеспечиваться reconciliation, а не неограниченным повтором неизвестно идемпотентного POST-запроса.

### 2. Сделать состояние stored order stream правдивым

Stored order stream должен иметь различимое состояние как минимум:

```text
starting
active
recovering
failed
stopped
```

Наличие ключа в `streams.orders` не является достаточным признаком активности.

При повторном вызове `streamOrders()` существующая запись может быть переиспользована только если stream действительно:

- не остановлен;
- имеет разрешённый reconnect lifecycle;
- находится в `starting`, `active` или корректном `recovering`;
- относится к тому же account и stream key.

Stale или terminal entry необходимо удалить либо заменить до новой подписки.

### 3. Синхронизировать `brokerage.ready` с реальными streams

`brokerage.ready` может быть `true` только когда обязательные order и position streams для всех найденных contracts действительно запущены или находятся в допустимом transient recovery.

Если order stream перешёл в terminal state:

- `brokerage.ready` сбрасывается;
- stored entry больше не выдаётся за active;
- следующий recovery или `syncBrokerageStreams()` может создать новый stream.

Не допускать параллельных setup/recovery для одного клиента. Использовать single-flight Promise, аналогично существующему setup contract.

### 4. Разделить transient и terminal recovery

Сохранить ожидаемый reconnect для:

- transport close;
- heartbeat timeout;
- `GoAway`;
- `StreamStatus: "GoAway"`;
- transient HTTP failures.

Для authorization failure:

1. пометить текущий stream неактивным;
2. выполнить `lib.ts.refresh()` через single-flight recovery;
3. повторно создать brokerage streams с обновлённым access token;
4. после успешного подключения выполнить reconciliation.

Recovery должен быть ограниченным и не создавать несколько streams одного account.

Для permanent ошибок вроде invalid account/request:

- остановить конкретный stream;
- записать диагностируемое failed state;
- не запускать бесконечный reconnect;
- не оставлять `brokerage.ready = true`.

`INVALID SYMBOL` и другие permanent invalid packets не должны превращаться в бесконечный reconnect loop.

### 5. Добавить order state и hydration

Добавить server-side order state в `application/domain/ts/orders.js`.

Минимальный identity:

```text
live + AccountID + OrderID
```

Order state должен позволять:

- хранить последнее полное состояние ордера;
- объединять частичный stream packet с последним известным состоянием;
- определять, изменился ли downstream-relevant state;
- не отправлять повторно полностью идентичное состояние;
- очищаться при закрытии или удалении TradeStation client.

Обязательная форма перед downstream delivery:

- непустой `OrderID`;
- непустой `AccountID`, включая fallback на account текущего stream;
- `Legs` является непустым массивом;
- у каждого leg есть непустой `Symbol`.

Если stream packet неполный:

1. объединить его с cached order;
2. если cached order недостаточно — получить order по REST current orders;
3. если order уже перешёл в historical — проверить historical orders;
4. отправить downstream только после восстановления обязательной формы.

Если восстановление невозможно:

- не передавать packet как обычный полный order;
- не останавливать весь stream;
- записать структурированный diagnostic с `AccountID`, `OrderID`, отсутствующими полями и причиной hydration failure;
- инициировать bounded account reconciliation.

Не вводить новый выдуманный top-level `symbol` contract. Источником инструмента остаётся существующая структура order legs. Все существующие symbol-преобразования должны выполняться через `lib.utils.makeSymbol()` и `lib.utils.makeTSSymbol()`; локальные regex, `padStart` и `padEnd` запрещены.

### 6. Добавить общий REST helper для orders

Вынести TradeStation HTTP-запросы current и historical orders в `application/lib/ts/orders.js`.

Helper должен:

- принимать account, live, access token, optional order IDs, start и limit;
- проверять, что upstream response является объектом;
- безопасно обрабатывать отсутствующие или `null` поля `Errors` и `Orders`;
- возвращать нормализованный результат без обращения к `.length` у неизвестного значения;
- позволять получить order по `OrderID` для hydration;
- позволять получить current и recent historical snapshot для reconciliation;
- не превращать ожидаемый пустой список в integration failure;
- бросать обычный `Error` для transport failures и неожиданного response shape.

Публичные процедуры:

- `application/api/account/orders.js`;
- `application/api/account/historicalorders.js`;

должны использовать общий helper вместо дублирования raw response assumptions.

При изменении этих публичных Impress-процедур добавить явный runtime contract:

- `access`;
- `parameters`;
- `returns`;
- `errors`;
- `validate`, если требуется;
- `method`.

Не менять существующий успешный внешний формат — процедуры по-прежнему возвращают массив TradeStation orders.

### 7. Выполнять reconciliation

Reconciliation требуется:

- сразу после первоначального запуска account order stream;
- после успешного reconnect;
- после `GoAway`;
- после heartbeat recovery;
- после authorization refresh и новой подписки;
- после обнаружения packet, который невозможно hydrate из cache.

Reconciliation должна:

1. получить current orders;
2. получить недавние historical orders;
3. объединить результаты без дубликатов `AccountID + OrderID`;
4. сравнить их с локальным order state;
5. отправить только новые или изменившиеся состояния;
6. не отправлять повторно идентичные snapshot и stream states.

Не добавлять постоянный polling timer. Reconciliation запускается по lifecycle-событиям и известным признакам рассинхронизации.

### 8. Observability

Добавить компактные lifecycle logs, достаточные для диагностики:

```text
account
streamKey
state
reason
generation
connected
brokerageReady
OrderID
hydrationSource
missingFields
queueCount
queueLength
```

Не логировать:

- access token;
- refresh token;
- client secret;
- полный чувствительный account payload без необходимости.

## Ограничения

- Не менять следующий/downstream проект.
- Не исправлять проблему периодическим вызовом `account/orders` по timer.
- Не считать существование объекта в registry доказательством активного stream.
- Не создавать несколько одновременных streams для одного account.
- Не добавлять бесконечные retries.
- Не использовать `DomainError` для transport, queue или unexpected integration failures.
- Не собирать OPT symbol локально.
- Не менять `config/**`, `types/**` или `doc/**`.
- Не коммитить логи, coverage, build output и другие generated artifacts.
- Не менять lifecycle quotes, chains, matrix и barcharts, кроме минимального совместимого улучшения общего `lib.ts.stream` status contract.

## Критерии готовности

- Terminally stopped order stream не остаётся ложным active entry.
- `brokerage.ready` соответствует фактическому состоянию обязательных brokerage streams.
- Transient close, heartbeat timeout и `GoAway` восстанавливают stream.
- После reconnect пропущенные изменения восстанавливаются current/historical reconciliation.
- Authorization failure восстанавливает token и подписку через single-flight flow.
- Permanent invalid error не вызывает бесконечный reconnect.
- Ошибка downstream POST не уменьшает доступную concurrency навсегда.
- После двадцати rejected queue tasks следующая успешная задача обрабатывается.
- Downstream не получает normal order event без `OrderID`, `AccountID`, `Legs` или `Legs[].Symbol`.
- Partial packet корректно объединяется с cache или REST snapshot.
- Unresolved partial packet диагностируется и не блокирует последующие события.
- Snapshot и stream update одного состояния не создают duplicate delivery.
- `orders.js` и `historicalorders.js` имеют полный Impress runtime contract.
- Ответы TradeStation с отсутствующими `Errors`, `Orders: null` или пустым списком обрабатываются предсказуемо.
- `npm run lint`, `npm run types`, `npm test` проходят.
