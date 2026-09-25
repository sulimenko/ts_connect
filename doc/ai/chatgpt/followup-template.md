# followup-template.md - AI Pipeline v8.3

Проект: `sulimenko/ts_connect`; runtime: `node24`.

Читать `AGENTS.md`, `doc/ai/project-invariants.md`, `doc/ai/chatgpt/project-settings.md` и релевантный код/модульную документацию.

Canonical правила и шаблоны находятся на ветке `ai-task-queue` в `doc/pipeline/v8.3.0/`:
- `contract-schema.md`, `router-policy.md`, `worker-rules.md`, `verification-policy.md`;
- `implementation.example.md`, `test-only.example.md`, `acceptance.example.json`.

Technical Architect исследует до окончательного ТЗ. ChatGPT принимает/разрешает каждое существенное замечание. Новую задачу создавать только после явного разрешения пользователя. Tests создаются отдельно после ручной приёмки реализации. Docker вне автоматического pipeline; сложный SQL — в ручных сценариях.

Перед review читать exact remote PR head и receipt/handoff на `ai-task-queue`. Локальные raw-файлы недоступны ChatGPT автоматически; при необходимости пользователь передаёт только ограниченные и проверенные на секреты выдержки.

Не объявлять CLI exit=0, zero tests или `No ready tasks` доказательством полного workflow. Staging только `git add -A`; исполнители не владеют Git. Старые v8.2 task/review mechanics не переопределяют v8.3.
