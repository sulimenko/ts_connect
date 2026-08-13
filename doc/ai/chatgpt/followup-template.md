# Task T-NNN: <follow-up title>

```ai-task-contract
version: 1
task_id: T-NNN
type: follow_up
human_summary: "<конкретный gap открытого PR>"
execution_mode: codex

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: <actual-parent-branch>
  work_branch: <actual-parent-branch>
  work_branch_policy: continue_parent_branch
  allow_new_branch: false
  allow_codex_git: false

scope:
  allowed_files:
    - <exact files>
  forbidden_files:
    - doc/**
    - node_modules/**
    - coverage/**
    - dist/**
    - "*.log"
    - "*.csv"
    - generated artifacts
  requirements:
    - "<review blocker>"
    - "<preserved invariant>"
    - "Не расширять scope за пределы gap."

tests:
  required: true
  cover_behavior:
    - "<regression behavior>"
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
  max_files_changed: 4
  max_added_lines: 220
  max_deleted_lines: 120

commit:
  message: "<short commit message>"
```
