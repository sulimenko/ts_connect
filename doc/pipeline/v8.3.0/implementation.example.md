# Шаблон — не готовая задача

Замените ID, SHA, разрешение пользователя, пути, команды, сценарии и бюджеты реальными значениями. Не ставьте этот файл в ready без согласования. aaaa... — заполнитель, а не существующий commit. Для новой задачи сначала проверьте занятые номера в очереди и истории. Runtime-команды должны быть безопасными для конкретного окружения. Отсутствие автоматических assertions означает только ручную проверку поведения, не автоматический PASS.
В примере validation содержит лишь проверку Git diff. Architect обязан добавить реальные безопасные проверки синтаксиса/типов/запуска для выбранного проекта.

# Пример контракта

```ai-task-contract
version: 8.3.0
task_id: T-001
revision: 1
kind: implementation
type: primary
summary: Короткое описание согласованного изменения
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
  parent_branch: null
scope:
  allowed_files:
  - app/ExactFile.php
  forbidden_files:
  - .env
  - tests/**
requirements:
- Конкретный инвариант и ожидаемое поведение; без изменения тестов на этой фазе.
architecture:
  reference: null
  resolutions: []
  skip_reason: Локальный известный code path; отдельный архитектурный проход не требуется. Для high complexity заменить
    на reference и resolutions.
preflight:
  required_tools: []
  commands: []
validation:
- id: diff-check
  run: git diff --check
  timeout_seconds: 30
verification:
  commands: []
  db_queries: []
  assertions: []
manual_scenarios:
- id: M01
  steps: Пользователь выполняет согласованный ручной сценарий. Заменить этот текст точными действиями и командами.
  expected: Конкретный наблюдаемый результат; не общее «всё работает».
  environment: operator-selected non-production
tests:
  required_after_acceptance: true
  allowed_files: []
  deferred_expectations: []
budget:
  repair_rounds: 1
diff_budget:
  max_files_changed: 4
  max_added_lines: 100
  max_deleted_lines: 100
commit:
  message: 'fix: implement approved T-001 behavior'
```
