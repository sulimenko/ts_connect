# AI Pipeline v8.2.0 contract schema

Each production task contains exactly one fenced block beginning with ` ```ai-task-contract `.

```yaml
version: 8.2.0
task_id: T-XXX
type: primary | follow_up
human_summary: "..."
execution_mode: autonomous | manual
spec_level: concise | standard | strict

research:
  reference: none | R-XXX
  context_path: none | doc/tasks/research/R-XXX-context.md
  bundle_path: none | doc/tasks/research/R-XXX-bundle.zip

routing:
  complexity: low | medium | high
  risk: low | medium | high | critical
  executor: codex | kimi
  executor_effort: low | medium
  plan_critic: none | codex | kimi
  plan_critic_effort: low | medium
  verifier: codex
  verifier_effort: low | medium
  test_author: codex | kimi | same
  test_author_effort: low | medium

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: none | ai/T-XXX-short
  work_branch: ai/T-XXX-short
  work_branch_policy: create_task_branch | continue_parent_branch
  allow_new_branch: true | false
  allow_agent_git: false

scope:
  allowed_files:
    - exact/or/glob/path
  forbidden_files:
    - forbidden/**
  extra_files_percent: 0..10
  extra_roots:
    - optional/neighbor/root
  requirements:
    - "accepted behavior / invariant"

verification:
  required: true | false
  commands:
    - exact task-approved runtime verification command
  db_queries:
    - "SELECT ..."
    - "EXPLAIN SELECT ..."
  assertions:
    - "specific observable condition that must be proven"
  human_gate: true | false
  reverify_after_tests: true | false

tests:
  strategy: none | before | after_verification | both
  required: true | false
  cover_behavior:
    - "specific verified behavior"
  allowed_files:
    - tests/exact/or/glob/path

budget:
  implementation_repair_rounds: 0..2
  verification_fix_rounds: 0..2
  test_repair_rounds: 0..2

pr:
  mode: create_new | update_existing_parent_pr
  base: develop

validation:
  commands:
    - exact command
  require_clean_scope: true
  fail_on_forbidden_files: true

diff_budget:
  max_files_changed: 5
  max_added_lines: 300
  max_deleted_lines: 120

commit:
  message: "fix(ai): ..."
  include_task_artifacts: false
```

## Important semantics

- `routing.executor_effort` for Codex may only be `low` or `medium`.
- Kimi uses the configured K3 alias; pipeline `low` maps to K3 `low`, and pipeline `medium` maps to K3 `high` via `KIMI_MODEL_THINKING_EFFORT`.
- `routing.verifier` is `codex` in v8.2.0 so runtime verification can use OS-enforced read-only Codex sandbox.
- `plan_critic` is read-only and should normally be a different provider from executor.
- `tests.strategy=after_verification` means implementation phase may not modify test files; Test Author runs only after runtime verification passes. When tests are required, this strategy requires `verification.required=true`.
- `tests.strategy=both` permits implementation tests and also permits a post-verification Test Author pass. When tests are required, this strategy requires `verification.required=true`.
- `verification.required=true` requires at least one command or DB query plus at least one explicit `verification.assertions` item.
- `verification.db_queries` are executed only through the project read-only DB command and SQL guard.
- `verification.human_gate=true` stops after agent verification; no automatic test-author/commit progression until acceptance is recorded in a follow-up task.

## Research bundles

Research artifacts live only on `ai-task-queue`:

```text
doc/tasks/research/R-XXX-request.md
doc/tasks/research/R-XXX-summary.md
doc/tasks/research/R-XXX-context.md
doc/tasks/research/R-XXX-manifest.json
doc/tasks/research/R-XXX-bundle.zip
```

The ZIP contains request + raw evidence + Kimi summary. `context.md` is a GPT-readable text pack generated from the same bundle so ChatGPT does not depend on GitHub binary ZIP extraction.
