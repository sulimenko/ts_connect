# Task T-049: Docs format and task rules

```ai-task-contract
version: 1
task_id: T-049
type: follow_up
human_summary: "Исправить docs formatting и закрепить task rules"
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
    - AGENTS.md
    - doc/ai/chatgpt/project-settings.md
    - doc/ai/chatgpt/task-template.md
  forbidden_files:
    - application/**
    - config/**
    - types/**
    - node_modules/**
    - coverage/**
    - dist/**
    - doc/tasks/**
    - doc/task.md
    - doc/review.md
    - doc/changelog.md
    - doc/ai/runs/**
    - "*.log"
    - "logs/**"
    - "tmp/**"
    - "temp/**"
    - "*.generated.*"

tests:
  required: false
  cover_behavior: []
  allowed_files: []

pr:
  mode: update_existing_parent_pr
  base: develop

validation:
  commands:
    - npm test

diff_budget:
  max_files_changed: 3
  max_added_lines: 120
  max_deleted_lines: 80

commit:
  message: "fix docs format and task rules"
```

## Human summary

Выполнить T-049 как follow-up на той же ветке `ai/T-047-options-chain`, чтобы снять baseline `npm test` blocker и закрепить правила task numbering / branch naming.

## Task

1. Исправить Prettier formatting в docs, из-за которого `npm test` падает на:
   - `AGENTS.md`;
   - `doc/ai/chatgpt/task-template.md`.

2. При необходимости обновить `doc/ai/chatgpt/project-settings.md`, но только для закрепления тех же workflow rules.

3. В `AGENTS.md` и `doc/ai/chatgpt/project-settings.md` закрепить правила:
   - перед draft новой задачи найти максимальный существующий `T-NNN`;
   - следующий task ID = max existing + 1;
   - task title: `# Task T-NNN: <short title>`;
   - `task_id: T-NNN`, без slug;
   - work branch должен начинаться с `ai/T-NNN-`.

4. В `doc/ai/chatgpt/task-template.md` исправить template:
   - `task_id: T-XXX`, без suffix;
   - `work_branch: ai/T-XXX-short-title`;
   - opening fence строго ` ```ai-task-contract `.

5. Добавить compact naming rule:
   - имена функций и переменных лаконичные;
   - 1 слово лучше 2;
   - 2 слова лучше 3;
   - длинное имя допустимо только если короткое теряет смысл.

## Criteria

- Task выполняется на `ai/T-047-options-chain`.
- Production code не изменён.
- `doc/tasks/**` не изменён.
- `npm test` больше не падает на Prettier formatting docs.
- В project instructions есть правило `T-NNN = max existing + 1`.
- В project instructions есть правило branch prefix `ai/T-NNN-`.
- В task template нет `task_id: T-XXX-example`.
- В task template есть `work_branch: ai/T-XXX-short-title`.
- `npm test` проходит.
