# Task T-065: Исправить zero-position recovery и validation количества ордера

```ai-task-contract
version: 1
task_id: T-065
type: primary
human_summary: "Закрыть два production-дефекта order placement: bare TradeStation response `You are short/long 0 shares!` должен запускать bounded authoritative position recovery, а нулевое или невалидное qty должно отклоняться до TradeStation как predictable DomainError вместо upstream HTTP 400 и наружного RPC 500."
execution_mode: codex

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: none
  work_branch: ai/T-065-order-zero-state-validation
  work_branch_policy: create_task_branch
  allow_new_branch: true
  allow_codex_git: false

scope:
  allowed_files:
    - application/api/orderexecution/order.js
    - application/test/run.js
  forbidden_files:
    - application/api/orderexecution/ordergroups.js
    - application/lib/ts/placeorder.js
    - application/lib/ts/send.js
    - application/lib/utils.js
    - application/domain/**
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
    - "*.csv"
    - generated artifacts
  requirements:
    - "Production response `You are short 0 shares!` должен классифицироваться как stale broker-position mismatch и запускать существующий bounded authoritative positions recovery."
    - "Добавить симметричную обработку `You are long 0 shares!`."
    - "Bare zero-position wording должен распознаваться как в response.Orders, так и в response.Errors."
    - "После zero-position mismatch выполнить максимум один api.account.positions authoritative refresh, заново вычислить TradeAction через существующий placeorder path и выполнить максимум один повторный submission."
    - "Повторный failure после recovery возвращается вызывающему коду без второго refresh или третьего submission."
    - "Не ослаблять T-058 exclusions: `remaining on sell orders`, `remaining on buy orders`, working-order/closing-capacity conflicts не являются stale-position mismatch и не запускают refresh/retry."
    - "Short locate / easy-to-borrow / SL0350 и invalid price increment также не должны запускать position recovery."
    - "Проверять qty до вызова lib.ts.placeorder."
    - "Допустимое qty — конечное ненулевое целое число; integer numeric strings остаются допустимыми."
    - "Знак qty сохраняет текущую семантику: positive = buy direction, negative = sell direction; upstream Quantity по-прежнему формируется существующим placeorder path."
    - "qty=0, -0, пустое значение, non-numeric, Infinity/NaN и fractional quantity не должны silently проходить через parseInt или попадать в TradeStation."
    - "Невалидное qty возвращает predictable DomainError `EQUANTITY` до upstream request."
    - "Добавить `EQUANTITY` в существующий public error mapping order procedure."
    - "Не менять существующую validation LimitPrice/StopPrice."
    - "Не менять getAction(), position registry, placeorder behavior или TradeStation transport."
    - "Не реализовывать BRK/OCO/ordergroups, working-order reservation или omnibus routing в этой задаче."

tests:
  required: true
  cover_behavior:
    - "`You are short 0 shares!` после первоначального BUYTOCOVER вызывает ровно один authoritative positions refresh, пересчёт TradeAction и максимум один retry."
    - "`You are long 0 shares!` имеет симметричное bounded recovery."
    - "Zero-position wording распознаётся defensively в Orders и Errors collections."
    - "Если retry снова возвращает position mismatch, нового refresh/retry не происходит."
    - "`You are long 200 shares with 200 remaining on sell orders!` по-прежнему вызывает один submission и zero positions refresh."
    - "Симметричный `remaining on buy orders` не запускает recovery."
    - "Short-locate и tick-increment restrictions не запускают recovery."
    - "qty=0 отклоняется как EQUANTITY и lib.ts.placeorder не вызывается."
    - "Пустой, non-numeric, infinite и fractional qty отклоняются до upstream."
    - "Положительные и отрицательные integer numeric strings продолжают проходить validation без изменения направления сделки."
    - "Existing ELIMITPRICE и ESTOPPRICE behavior не изменён."
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
  max_files_changed: 2
  max_added_lines: 160
  max_deleted_lines: 60

commit:
  message: "fix order zero-position recovery and quantity validation"
```

## Контекст

После production работы 13–14 августа обнаружены два отдельных behavioral gap.

### 1. COHU — bare zero-position response

Connector сформировал `BUYTOCOVER`, исходя из локального broker-position state.

TradeStation ответил:

```text
You are short 0 shares!
```

Текущий stale-position classifier умеет распознавать ответы вида:

```text
Order failed. Reason: You are long ...
Order failed. Reason: You are short ...
```

но bare wording `You are short 0 shares!` в текущий regexp не попадает.

В результате authoritative positions refresh и bounded retry не выполняются.

Требуется расширить только classification существующего stale-position recovery, не менять его архитектуру.

Критически важно сохранить T-058 behavior:

```text
You are long 200 shares with 200 remaining on sell orders!
```

является working-order capacity conflict и не должен снова начать position refresh/retry.

### 2. MSTR — Quantity = 0

В production был сформирован order с `Quantity = 0`.

TradeStation отклонил request как invalid quantity через HTTP 400, после чего transport failure surfaced наружу как generic RPC 500.

Текущая процедура использует `parseInt(qty)`, но не валидирует quantity до upstream submission.

Predictable invalid public input должен завершаться локально через `DomainError('EQUANTITY')`.

Transport до TradeStation для такого input не должен происходить.

## Архитектурные ограничения

- Validation и stale-response classification остаются в `application/api/orderexecution/order.js`.
- `application/lib/ts/placeorder.js` не менять.
- `getAction()` не менять.
- `domain.ts.positions` не менять.
- Не добавлять working-order state.
- Не добавлять customer/omnibus ledger.
- Не добавлять BRK/OCO.
- Existing bounded recovery остаётся: максимум один authoritative refresh + максимум один retry.
- `remaining on buy/sell orders` остаётся отдельным broker capacity conflict.
- `DomainError` использовать только для predictable invalid input.
- Transport/unexpected integration failures остаются обычным `Error`.

## Критерии готовности

- [ ] COHU wording `You are short 0 shares!` запускает bounded stale-position reconciliation.
- [ ] `You are long 0 shares!` обрабатывается симметрично.
- [ ] Выполняется максимум один positions refresh и один retry.
- [ ] После refresh TradeAction вычисляется заново от authoritative broker position.
- [ ] `remaining on sell/buy orders` по-прежнему не retry-ится.
- [ ] Short locate и tick increment не retry-ятся.
- [ ] qty=0 не отправляется в TradeStation.
- [ ] Invalid qty возвращает predictable `EQUANTITY`, а не upstream HTTP 400 / RPC 500.
- [ ] Integer numeric strings сохраняют текущую поддержку.
- [ ] Fractional/non-numeric qty не обрезается молча через `parseInt`.
- [ ] ELIMITPRICE/ESTOPPRICE behavior не изменён.
- [ ] BRK/OCO/ordergroups не затронуты.
- [ ] Изменены только два разрешённых файла.
- [ ] `npm run lint` проходит.
- [ ] `npm run types` проходит.
- [ ] `npm test` проходит.
