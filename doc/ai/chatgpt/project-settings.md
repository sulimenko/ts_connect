# ts_connect — настройки проекта v8.3

Repository: `sulimenko/ts_connect`.
Base: `develop`. Queue: `ai-task-queue`. Runtime: `node24`.
Local runner: `~/.ai-pipeline/`; profile: `projects/<repo-key>/env.sh`.

## Начальные проверки

    npm run lint
    npm run types

Команды конкретной задачи выводить из актуального package/composer и code path. Не запускать весь npm test автоматически, если он содержит заранее известные несовместимые expectations или внешние side effects. Существующий project-checks.sh сохранён миграцией; его реальные действия нужно учитывать при выборе команды.

## Архитектура

`doc/ai/project-invariants.md` сохраняет проектные разделы прежнего AGENTS.md; проверьте diff миграции. Остальная модульная и продуктовая документация не переписывается.

## Shared policy

`ai-task-queue:doc/pipeline/v8.3.0/`. Implementation без изменения тестов → runtime observations → checkpoint/Draft PR → ручное принятие → отдельный test-only follow-up. Новые задачи имеют версию 8.3.0 и явное разрешение пользователя.
