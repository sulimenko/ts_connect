# Task T-058: Исправить position cache и capacity-conflict recovery

```ai-task-contract
version: 1
task_id: T-058
type: follow_up
human_summary: "Закрыть два blocker-а review PR #14: не retry-ить реальный working-order capacity conflict и не очищать broker position optimistically после submit full-close order."
execution_mode: codex

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: ai/T-057-order-recovery-hotfix
  work_branch: ai/T-057-order-recovery-hotfix
  work_branch_policy: continue_parent_branch
  allow_new_branch: false
  allow_codex_git: false

scope:
  allowed_files:
    - application/api/orderexecution/order.js
    - application/lib/ts/placeorder.js
    - application/test/run.js
  forbidden_files:
    - application/api/account/positions.js
    - application/domain/**
    - application/lib/utils.js
    - doc/**
    - doc/tasks/**
    - doc/ai/**
    - config/**
    - types/**
    - node_modules/**
    - coverage/**
    - dist/**
    - "*.log"
    - "*.csv"
    - generated artifacts
  requirements:
    - "Классифицировать TradeStation response вида 'You are long <N> shares with <M> remaining on sell orders' как working-order capacity conflict, а не stale-position mismatch."
    - "Добавить симметричный defensive handling для эквивалентного buy-orders/short capacity wording, если он приходит в Orders или Errors."
    - "Capacity conflict не выполняет api.account.positions refresh и не делает повторную отправку standalone order."
    - "Сохранить bounded stale-position recovery для настоящего mismatch: максимум один authoritative positions refresh и максимум один повторный submission."
    - "Удалить optimistic domain.ts.positions.clearPosition из placeorder submit path: accepted working Limit/Stop и rejected full-close order не являются подтверждённым fill."
    - "domain.ts.positions остаётся broker-position truth и изменяется position stream / authoritative reconciliation, а не предположением current + qty === 0 после submit."
    - "Не добавлять BRK/OCO, working-order reservation, omnibus/customer ledger или новый routing behavior."

tests:
  required: true
  cover_behavior:
    - "Production wording 'You are long 200 shares with 200 remaining on sell orders!' вызывает ровно один placeorder call и zero position refresh."
    - "Эквивалентный working buy-orders capacity conflict также не запускает stale-position retry."
    - "Accepted full-close Limit/Stop order не очищает local broker position до фактического position update/fill."
    - "Rejected full-close order не очищает local broker position."
    - "Настоящий stale-position mismatch по-прежнему делает один refresh и один retry, затем останавливается."
  allowed_files:
    - application/test/run.js

pr:
  mode: update_existing_parent_pr
  base: develop

validation:
  commands:
    - npm run lint
    - npm run types
    - npm test

diff_budget:
  max_files_changed: 3
  max_added_lines: 180
  max_deleted_lines: 80

commit:
  message: "fix order recovery review blockers"
```

## Что исправить

### Blocker 1 — capacity conflict

Реальный production response:

```text
Order failed. Reason: You are long 200 shares with 200 remaining on sell orders!
```

не является stale-position mismatch.

Такой response должен возвращаться без positions refresh и retry.

При этом настоящий stale-position mismatch продолжает делать максимум один refresh и один retry.

### Blocker 2 — optimistic position clear

`application/lib/ts/placeorder.js` не должен удалять position после submit только потому, что `current + qty === 0`.

Submit не означает fill. Это особенно критично для accepted working Limit/Stop и rejected full-close order.

Источник broker position truth — TradeStation position stream или authoritative reconciliation, но не предположение `placeorder()`.

## Вне scope

Не реализовывать:

- BRK/OCO;
- omnibus router;
- held customer orders;
- customer gross ledger;
- working-order reservation;
- synthetic Limit/Stop;
- short-locate redesign;
- изменение общего reversal behavior `getAction()`.

## Критерии готовности

- [ ] `remaining on sell orders` не вызывает refresh/retry.
- [ ] Симметричный buy-orders capacity conflict не вызывает refresh/retry.
- [ ] Accepted working full-close order не очищает broker position.
- [ ] Rejected full-close order не очищает broker position.
- [ ] Настоящий stale mismatch сохраняет bounded recovery.
- [ ] Изменены только 3 разрешённых файла.
- [ ] `npm run lint` проходит.
- [ ] `npm run types` проходит.
- [ ] `npm test` проходит.
