# Task T-048: Stream close classification

```ai-task-contract
version: 1
task_id: T-048
type: primary
human_summary: "Классифицировать terminated stream read как transient close"
execution_mode: codex

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: none
  work_branch_policy: create_task_branch
  work_branch: ai/T-048-stream-close
  allow_new_branch: true
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
    - "terminated read with UND_ERR_SOCKET is transient"
    - "transient close schedules reconnect without Unexpected stream error"
    - "manual stop, idle cleanup and client.close do not reconnect"
    - "GoAway remains transient reconnect"
    - "INVALID SYMBOL remains permanent stop"
  allowed_files:
    - application/test/run.js

pr:
  mode: create_new
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

Нужно исправить generic stream reader, чтобы remote socket close в brokerage orders stream не логировался как unexpected internal error.

## Контекст

Brokerage orders stream создаётся в `application/domain/ts/client.js` через `streamOrders()` и читает upstream через `application/lib/ts/stream.js`.

Сейчас ошибка чтения stream body с `name/message = terminated` и `cause.code = UND_ERR_SOCKET` попадает в ветку `Unexpected stream error`, хотя для активного stream это transient transport close.

## Задача

1. В `application/lib/ts/stream.js` добавить компактную классификацию stream read errors.
2. Разделить controlled stop, transient close и permanent upstream error.
3. Для transient close не писать `Unexpected stream error`; логировать понятное событие и запускать existing bounded reconnect.
4. Для controlled stop не запускать reconnect и сохранять reason.
5. Сохранить текущую семантику: `GoAway` reconnect, `INVALID SYMBOL` permanent stop, reconnect timer без дублей, backoff bounded.
6. Проверить, что reconnect не создаёт duplicate streams и не теряет subscribers.

## Naming rule

При правках использовать лаконичные имена функций и переменных:

- 1 слово лучше 2;
- 2 слова лучше 3;
- длинное имя допустимо только если короткое теряет смысл;
- не вводить отдельный verbose abstraction layer;
- classification helper должен быть коротким и иметь узкую ответственность.

## Критерии готовности

- Terminated stream read с socket close больше не классифицируется как `Unexpected stream error`.
- Transient close запускает controlled reconnect.
- Manual stop, unsubscribe, idle cleanup и client.close не запускают reconnect.
- `GoAway` остаётся transient reconnect.
- `INVALID SYMBOL` и permanent upstream errors не запускают reconnect loop.
- Логи различают transient close, reconnect scheduled, controlled stop и permanent error.
- `npm test` проходит.
- Codex не создавал branch, commit, push или PR.
