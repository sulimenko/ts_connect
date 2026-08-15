# Task T-057: Исправить order recovery и validation ошибок TradeStation

```ai-task-contract
version: 1
task_id: T-057
type: primary
human_summary: "Исправить подтверждённые production-дефекты order placement: stale/missing position приводит к неверному TradeAction, существующий bounded retry не срабатывает, обязательные цены некоторых order types не валидируются до upstream; отделить эти дефекты от штатных broker restrictions без изменения omnibus/order-routing логики."
execution_mode: codex

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: none
  work_branch: ai/T-057-order-recovery-hotfix
  work_branch_policy: create_task_branch
  allow_new_branch: true
  allow_codex_git: false

scope:
  allowed_files:
    - application/api/orderexecution/order.js
    - application/api/account/positions.js
    - application/lib/ts/placeorder.js
    - application/domain/ts/positions.js
    - application/domain/ts/client.js
    - application/lib/utils.js
    - application/test/run.js
  forbidden_files:
    - application/domain/ts/orders.js
    - application/api/orderexecution/ordergroups.js
    - application/lib/ts/placegrouporder.js
    - doc/**
    - doc/tasks/**
    - doc/ai/**
    - node_modules/**
    - coverage/**
    - dist/**
    - "*.log"
    - "*.csv"
    - generated artifacts

tests:
  required: true
  cover_behavior:
    - "STK close/cover после stale или missing local position не должен окончательно завершаться ложной boxed-position ошибкой: при подтверждённом position-state conflict выполняется один authoritative positions refresh, TradeAction вычисляется заново и допускается максимум один retry."
    - "OPT close после stale или missing local position после refresh выбирает BUYTOCLOSE/SELLTOCLOSE вместо ложного BUYTOOPEN/SELLTOOPEN."
    - "Исправлена существующая проверка через Array.some(): predicate реально возвращает boolean."
    - "TradeStation response parsing имеет defensive guards и не предполагает без проверки наличие response.Orders или response.Errors."
    - "После успешного authoritative positions refresh отсутствие symbol допускается трактовать как подтверждённый flat; до refresh registry miss не считается доказательством flat в recovery path."
    - "Limit требует LimitPrice, StopMarket требует StopPrice, StopLimit требует и LimitPrice и StopPrice; отсутствующие обязательные поля отклоняются predictable DomainError до upstream request."
    - "Numeric string price не теряется только из-за typeof value !== number, если он является валидным конечным числом."
    - "Position conflict из-за уже существующих working exit orders не считается stale-position ошибкой и не запускает повторную отправку того же standalone order."
    - "Short-locate restriction не запускает position refresh/retry и не обходится заменой SELLSHORT на Sell."
    - "Invalid price increment не запускает position refresh/retry; T-057 не округляет цену молча и не добавляет новый SymbolDetails subsystem."
    - "Ни один recovery path не выполняет более одного повторного order submission для одного входящего запроса."
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
  max_files_changed: 7
  max_added_lines: 450
  max_deleted_lines: 220

commit:
  message: "fix order recovery and validation"
```

## Контекст

По production-логам подтверждены несколько разных классов проблем. Их нельзя лечить одним retry.

### 1. Stale/missing local position

После restart/reconnect brokerage position stream локальный registry может временно не содержать фактическую позицию TradeStation.

Текущий order path при miss получает `current = 0` и может выбрать неверный opening action:

- long STK + sell → `SELLSHORT` вместо `Sell`;
- short STK + buy → `Buy` вместо `BUYTOCOVER`;
- short OPT + buy → `BUYTOOPEN` вместо `BUYTOCLOSE`;
- long OPT + sell → `SELLTOOPEN` вместо `SELLTOCLOSE`.

TradeStation затем отклоняет request как position/boxed conflict.

Для такого конфликта требуется bounded reconciliation:

1. классифицировать ответ как position-state mismatch;
2. один раз получить authoritative positions snapshot;
3. обновить `domain.ts.positions`;
4. заново вычислить TradeAction;
5. выполнить максимум один retry;
6. повторный failure вернуть без нового retry.

### 2. Существующий retry фактически сломан

В `application/api/orderexecution/order.js` текущий callback `response.Orders.some(...)` использует block body без `return`.

Из-за этого условие, которое должно инициировать refresh positions, не работает как задумано.

Исправить predicate и одновременно добавить defensive response-shape guards.

### 3. Missing order prices

Подтверждён `StopLimit`, дошедший до TradeStation без `LimitPrice`, после чего upstream вернул `400 Missing limit price`, а connector surfaced generic failure.

Добавить runtime validation:

- `Market`: price fields не обязательны;
- `Limit`: обязателен `LimitPrice`;
- `StopMarket`: обязателен `StopPrice`;
- `StopLimit`: обязательны `LimitPrice` и `StopPrice`.

Предсказуемый invalid input должен завершаться `DomainError`, а не transport 500.

Не менять цену и не подставлять значения автоматически.

### 4. Invalid price increment

TradeStation может отклонить цену, не соответствующую tick increment.

T-057 не должен создавать новый SymbolDetails/tick-cache subsystem и не должен молча округлять customer price.

Требование этой задачи: такая ошибка не должна ошибочно классифицироваться как position-state conflict и не должна запускать retry.

Отдельную pre-validation по TradeStation `PriceFormat` при необходимости оформить следующей задачей.

### 5. Existing working exit orders

Кейс:

```text
broker position: long 200
existing: Sell Limit remaining 200
new: Sell Stop remaining 200
```

TradeStation штатно может отклонить второй независимый order, потому что первый уже потребляет всю closing capacity.

Это **не stale-position defect**.

T-057 не реализует:

- BRK/OCO conversion;
- cancel/recreate;
- held customer orders;
- synthetic Stop/Limit listeners;
- multi-client execution routing.

Такой broker response должен быть распознан как отдельный business/order-capacity conflict и не должен запускать бессмысленный position refresh/retry.

### 6. Short locate

Ошибки вида `SL0350 / Security not easy to borrow / Short Locate` являются broker restriction.

Не обходить их изменением `SELLSHORT` на `Sell`, не retry-ить автоматически и не смешивать с stale-position recovery.

## Public Impress contract

Так как `application/api/orderexecution/order.js` изменяется, привести процедуру к runtime contract проекта без изменения успешного response shape:

- `access`;
- `parameters`;
- `returns`;
- `errors`;
- `validate`, если используется;
- `method`.

`DomainError` использовать только для predictable validation/business input errors.

Transport failures и unexpected TradeStation integration failures остаются `Error`.

## Архитектурные ограничения

- `application/api/` — validation/orchestration, без state и reconnect.
- `application/domain/` — broker position/lifecycle state.
- `application/lib/` — TradeStation adapter/request construction.
- `domain.ts.positions` остаётся только фактическим broker-position registry.
- Не добавлять customer ledger.
- Не добавлять working-order reservation model.
- Не добавлять omnibus routing.
- Не добавлять BRK/OCO.
- Не менять `metaterminal`.
- Symbol conversion только через `lib.utils.makeSymbol()` / `makeTSSymbol()`.

## Критерии готовности

- [ ] `.some()` recovery predicate исправлен.
- [ ] `response.Orders` / `response.Errors` читаются defensively.
- [ ] Stale-position mismatch делает максимум один authoritative refresh + один retry.
- [ ] После refresh TradeAction пересчитывается от фактической позиции.
- [ ] STK и OPT close/cover scenarios покрыты regression tests.
- [ ] Missing required order prices отклоняются до TradeStation как predictable validation error.
- [ ] Numeric string prices корректно валидируются и не теряются из-за текущей проверки `typeof`.
- [ ] Open-order capacity conflict не запускает stale-position retry.
- [ ] Short-locate restriction не retry-ится и не обходится неправильным TradeAction.
- [ ] Invalid tick increment не запускает position retry и не округляется автоматически.
- [ ] Omnibus/router/BRK логика не добавлена.
- [ ] `npm run lint` проходит.
- [ ] `npm run types` проходит.
- [ ] `npm test` проходит.
