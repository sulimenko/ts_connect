# ts_connect — AI Pipeline v8.3

Репозиторий: `sulimenko/ts_connect`. Язык задач, объяснений, архитектурных отчётов и review — русский.

## Источники и приоритет

Явная инструкция пользователя → согласованный контракт → этот файл → `doc/ai/project-invariants.md` и project settings → shared policy.
Перед новой работой читать этот файл, `doc/ai/chatgpt/project-settings.md`, соответствующие инструкции роли и релевантную архитектуру проекта. Не переносить архитектурные правила из другого проекта.

Shared policy: ветка `ai-task-queue`, каталог `doc/pipeline/v8.3.0/`. Читать `contract-schema.md`, `worker-rules.md`, `verification-policy.md`, `router-policy.md` и подходящий шаблон. Старые v8.2 контракты не исполняются автоматически.

## Роли и цикл

ChatGPT — владелец бизнес-цели, окончательного ТЗ и Final Review. Локальный Technical Architect — один исследовательский проход и единый handoff со всеми рекомендациями, а не критик на каждом повторе. Исполнители: Codex GPT-6 Astra low/medium либо Kimi K3. Runner владеет Git, очередью, командами и отчётами; агент не управляет Git.

Цикл: цель → Technical Architect при необходимости → отчёт пользователем в ChatGPT → окончательный draft → явное разрешение пользователя → implementation → автоматические наблюдения → checkpoint/Draft PR → ручная проверка → явное принятие конкретной реализации → отдельная test-only задача → Final Review → решение пользователя о merge.

## Git

Base: `develop`. Queue: `ai-task-queue`. Work: `ai/T-XXX-*`. Контракт: `version: 8.3.0`.
Staging только `git add -A` без списка файлов; guards до и после staging. Посторонние изменения блокируют commit, а не включаются молча. Нельзя force-push, автоматический reset --hard или git clean. Очередь не сливается в production-ветку.

## Тесты и принятие

В implementation нельзя создавать/изменять regression tests, fixtures или test setup, включая скрытый test harness в другой папке. Существующие релевантные проверки можно запускать без изменения. Заранее известные устаревшие expectations перечисляются как deferred; неизвестное падение не считается устаревшим автоматически.

Test-only допускается только по acceptance-записи с ручными результатами и отдельным разрешением тестов. Принятие фиксирует SHA, revision и contract hash. Изменение только разрешённых тестов не отменяет принятие production; изменение защищённых файлов — отменяет. Test Author не исправляет production и не ослабляет assertions.

## Runtime и проверка

Runtime профиля: `node24`. Machine-specific bootstrap: `~/.ai-pipeline/projects/<repo-key>/env.sh`.
Docker не проверяется и не запускается автоматически. SQL только минимальный SELECT/неисполняющий EXPLAIN через подтверждённые readonly-права, с лимитами. Сложные сценарии и миграции пользователь выполняет вручную по согласованным командам. Успешный CLI, ноль выполненных тестов или пустая очередь не доказывают бизнес-корректность.

## Безопасность и сохранение работы

Scope задаётся явно. Без разрешения нельзя менять secrets, credentials, зависимости/lockfiles, runtime/production config, схемы и несвязанный код. Raw-логи/DB-данные не публикуются автоматически. Один executor на репозиторий; другой компьютер не перехватывает зависший claim автоматически.

## Evidence

Локально: `~/.ai-pipeline/runs/`. Shared handoff/receipts: `ai-task-queue:doc/tasks/evidence/`. Architecture: `doc/tasks/research/`. Acceptance: `doc/tasks/acceptance/`.
Review проверяет exact remote head, контракт, scope, фактические автоматические результаты, ручные результаты и оставшиеся ограничения. Ответ: `Merge ready` либо `Blocked` с конкретной причиной. Не делать заявление о проверках, которых не было.
