# Task T-XXX: short title

```ai-task-contract
version: 8.2.0
task_id: T-XXX
type: primary
human_summary: "Короткое описание принятого результата"
execution_mode: autonomous
spec_level: standard

research:
  reference: none
  context_path: none
  bundle_path: none

routing:
  complexity: medium
  risk: medium
  executor: codex
  executor_effort: medium
  plan_critic: none
  plan_critic_effort: low
  verifier: codex
  verifier_effort: low
  test_author: codex
  test_author_effort: low

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: none
  work_branch: ai/T-XXX-short
  work_branch_policy: create_task_branch
  allow_new_branch: true
  allow_agent_git: false

scope:
  allowed_files:
    - app/Exact/File.php
  forbidden_files:
    - doc/tasks/**
    - doc/ai/**
    - .env
    - node_modules/**
    - vendor/**
  extra_files_percent: 10
  extra_roots:
    - app/Exact
  requirements:
    - "Реализовать только указанное принятое behavior."

verification:
  required: true
  commands:
    - curl -fsS http://127.0.0.1:3000/health
  db_queries:
    - "SELECT id, status FROM orders ORDER BY id DESC LIMIT 5"
  assertions:
    - "Health endpoint returns HTTP 200 and the target behavior matches the accepted task semantics."
    - "Read-only DB evidence is consistent with the expected post-scenario state."
  human_gate: false
  reverify_after_tests: false

tests:
  strategy: after_verification
  required: true
  cover_behavior:
    - "Зафиксировать regression test на подтвержденное verifier-ом поведение."
  allowed_files:
    - tests/ExactTest.php

budget:
  implementation_repair_rounds: 1
  verification_fix_rounds: 1
  test_repair_rounds: 1

pr:
  mode: create_new
  base: develop

validation:
  commands:
    - bash doc/ai/project-checks.sh
  require_clean_scope: true
  fail_on_forbidden_files: true

diff_budget:
  max_files_changed: 4
  max_added_lines: 300
  max_deleted_lines: 120

commit:
  message: "fix(ai): implement T-XXX short"
  include_task_artifacts: false
```

## Goal

Describe accepted behavior, architecture invariants and observable success criteria.

## Runtime verification notes

Explain what should be observed in API/log/DB output. Do not put credentials or secrets here.
