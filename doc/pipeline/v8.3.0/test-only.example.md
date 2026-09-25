# Шаблон — не готовая задача

Замените ID, SHA, разрешение пользователя, пути, команды, сценарии и бюджеты реальными значениями. Не ставьте этот файл в ready без согласования. aaaa... — заполнитель, а не существующий commit. Для новой задачи сначала проверьте занятые номера в очереди и истории. Runtime-команды должны быть безопасными для конкретного окружения. Отсутствие автоматических assertions означает только ручную проверку поведения, не автоматический PASS.
# Пример контракта

```ai-task-contract
version: 8.3.0
task_id: T-002
revision: 1
kind: test_only
type: follow_up
summary: Отдельные regression tests для принятой пользователем реализации T-001
approval:
  by: REPLACE_WITH_HUMAN
  at: '2026-09-25T12:00:00+00:00'
  reference: REPLACE_WITH_EXPLICIT_CHAT_APPROVAL
routing:
  executor: codex
  effort: low
  complexity: low
  risk: medium
git:
  base_branch: develop
  queue_branch: ai-task-queue
  base_sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  work_branch: ai/T-001-short-title
  parent_branch: ai/T-001-short-title
scope:
  allowed_files:
  - tests/ExactTest.php
  forbidden_files:
  - app/**
  - .env
requirements:
- Покрыть принятые бизнес-требования и реальные результаты ручных сценариев автоматическими тестами.
- Не менять production-файлы и не ослаблять assertions ради текущей реализации. Если тест выявил дефект production,
  остановиться и описать отдельный follow-up.
architecture:
  reference: null
  resolutions: []
  skip_reason: Test-only scope принятой реализации; архитектурные решения не пересматриваются. При реальном противоречии
    остановиться и передать findings ChatGPT.
preflight:
  required_tools: []
  commands: []
validation:
- id: regression
  run: vendor/bin/phpunit tests/ExactTest.php
  timeout_seconds: 300
verification:
  commands: []
  db_queries: []
  assertions: []
manual_scenarios: []
tests:
  required_after_acceptance: false
  allowed_files:
  - tests/ExactTest.php
  deferred_expectations: []
budget:
  repair_rounds: 0
diff_budget:
  max_files_changed: 4
  max_added_lines: 100
  max_deleted_lines: 100
commit:
  message: 'test: cover accepted T-001 behavior'
acceptance:
  reference: doc/tasks/acceptance/T-001-r1-aaaaaaaaaaaa.json
```
