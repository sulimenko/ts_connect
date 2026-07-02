# Task T-XXX: <title>

```ai-task-contract
version: 1
task_id: T-XXX-example
type: primary
human_summary: "<short summary>"
execution_mode: codex

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: none
  work_branch_policy: create_task_branch
  allow_new_branch: true
  allow_codex_git: false

scope:
  allowed_files:
    - application/**
    - application/test/run.js
  forbidden_files:
    - doc/tasks/**
    - doc/ai/**
    - node_modules/**
    - coverage/**
    - dist/**
    - "*.log"

tests:
  required: true
  cover_behavior:
    - "<specific behavior to cover>"
  allowed_files:
    - application/test/run.js

pr:
  mode: create_new
  base: develop

validation:
  commands:
    - npm test

diff_budget:
  max_files_changed: 8
  max_added_lines: 400
  max_deleted_lines: 400

commit:
  message: "<commit message>"
```

## Human summary

<Короткое человекочитаемое описание. Runner читает machine contract выше.>

## Notes

- Не менять файлы вне `allowed_files`.
- Не трогать `doc/tasks/**` и `doc/ai/**`, если задача явно не workflow/documentation.
- Не коммитить generated artifacts.
- Если задача меняет behavior, tests должны покрывать `tests.cover_behavior`.
