# Task T-048: Stream close classification

```ai-task-contract
version: 1
task_id: T-048
type: follow_up
human_summary: "Classify terminated stream read as transient close"
execution_mode: codex

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: ai/T-047-options-chain
  work_branch_policy: continue_parent_branch
  work_branch: ai/T-047-options-chain
  allow_new_branch: false
  allow_codex_git: false

scope:
  allowed_files:
    - application/lib/ts/stream.js
    - application/domain/ts/client.js
    - application/domain/ts/streams.js
    - application/test/run.js
  forbidden_files:
    - doc/**
    - doc/tasks/**
    - doc/ai/**
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
    - "terminated read with socket close is transient"
    - "transient close schedules reconnect without Unexpected stream error"
    - "manual stop, idle cleanup and client.close do not reconnect"
    - "GoAway remains transient reconnect"
    - "INVALID SYMBOL remains permanent stop"
  allowed_files:
    - application/test/run.js

pr:
  mode: update_existing_parent_pr
  base: develop

validation:
  commands:
    - npm test

diff_budget:
  max_files_changed: 6
  max_added_lines: 300
  max_deleted_lines: 180

commit:
  message: "classify stream close as transient"
```

## Human summary

Выполнить T-048 как follow-up на той же ветке `ai/T-047-options-chain`, без создания новой ветки.

## Task

1. В `application/lib/ts/stream.js` добавить компактную классификацию stream read errors.
2. Разделить controlled stop, transient close и permanent upstream error.
3. Для transient close не писать `Unexpected stream error`; логировать понятное событие и запускать existing bounded reconnect.
4. Для controlled stop не запускать reconnect и сохранять reason.
5. Сохранить семантику: `GoAway` reconnect, `INVALID SYMBOL` permanent stop, reconnect timer без дублей, backoff bounded.
6. Проверить, что reconnect не создаёт duplicate streams и не теряет subscribers.

## Criteria

- Task выполняется на `ai/T-047-options-chain`.
- Socket close не классифицируется как `Unexpected stream error`.
- Transient close запускает reconnect.
- Manual stop, unsubscribe, idle cleanup и client.close не запускают reconnect.
- `GoAway` остаётся transient reconnect.
- `INVALID SYMBOL` остаётся permanent stop.
- `npm test` проходит.
