# Task T-052: Restore strikeProximity for option chain All

```ai-task-contract
version: 1
task_id: T-052
type: follow_up
human_summary: "Вернуть strikeProximity для strikeRange=All, но не возвращать priceCenter"
execution_mode: codex

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: ai/T-051-clean-option-chain-all-touch
  work_branch_policy: continue_parent_branch
  work_branch: ai/T-051-clean-option-chain-all-touch
  allow_new_branch: false
  allow_codex_git: false

scope:
  allowed_files:
    - application/api/options/chain.js
    - application/test/run.js
  forbidden_files:
    - doc/**
    - doc/tasks/**
    - doc/ai/**
    - AGENTS.md
    - application/lib/**
    - application/domain/**
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
    - "strikeRange=All keeps strikeProximity when range is positive"
    - "strikeRange=All still does not send priceCenter"
    - "strikeRange=All with range=0 does not send strikeProximity"
    - "non-All strikeRange keeps existing strikeProximity and priceCenter behavior"
    - "existing touch resubscribeRequired behavior remains unchanged"
  allowed_files:
    - application/test/run.js

pr:
  mode: update_existing_parent_pr
  base: develop

validation:
  commands:
    - npm test

diff_budget:
  max_files_changed: 2
  max_added_lines: 60
  max_deleted_lines: 40

commit:
  message: "restore strike proximity for all option chains"
```

## Human summary

После T-051 для `strikeRange=All` из TradeStation stream request были удалены и `strikeProximity`, и `priceCenter`.

По runtime behavior это ухудшило полноту chain: TradeStation stream, похоже, использует `strikeProximity` как ширину выборки даже при `strikeRange=All`. Поэтому нужно вернуть `strikeProximity` для `All`, но **не возвращать `priceCenter`**, потому что именно `priceCenter=0` остаётся подозрительным параметром, который может сдвигать/ограничивать выборку.

## Task

В `application/api/options/chain.js` изменить построение `chainData`:

1. Если `strikeRange === "All"`:
   - если `range/proximity > 0`, добавлять `chainData.strikeProximity = proximity`;
   - не добавлять `priceCenter` ни при каких условиях.

2. Если `strikeRange !== "All"`:
   - сохранить текущее поведение:
     - добавлять `strikeProximity`;
     - добавлять `priceCenter`, если он валиден.

Ожидаемая логика:

```js
if (strikeRange === 'All') {
  if (proximity > 0) chainData.strikeProximity = proximity;
} else {
  chainData.strikeProximity = proximity;
  if (centerPrice !== null) chainData.priceCenter = centerPrice;
}
```

## Important constraints

- Не создавать synthetic/empty strikes.
- Не менять `application/lib/ts/optionChain.js`.
- Не менять stream lifecycle в `application/domain/ts/streams.js`.
- Не делать auto-resubscribe на backend-е.
- `touch active=false/resubscribeRequired=true` должен остаться как в T-051.
- Codex не должен создавать branch, commit, push или PR.

## Acceptance criteria

- `strikeRange=All` и `range > 0` отправляет `strikeProximity`.
- `strikeRange=All` не отправляет `priceCenter`.
- `strikeRange=All` и `range=0` не отправляет `strikeProximity`.
- Non-`All` режимы не ломаются.
- Existing T-051 tests остаются green после обновления ожиданий.
- `npm test` проходит.
