# Contract v8.3.0

В Markdown ровно один fence `ai-task-contract`. YAML разбирается SafeLoader с отказом на duplicate keys, anchors, aliases, explicit tags и unknown schema keys. Ограничение task — 256 KiB, глубина — 12, до 5000 событий парсера. Multiline scalars сохраняют YAML-семантику и передаются целой строкой одному bash-процессу, не через while-read/eval.

Смотрите полные примеры implementation.example.md, test-only.example.md, acceptance.example.json в этом каталоге. Примеры с aaaa... SHA не являются готовыми задачами.

Обязательные поля: version, task_id, revision, kind, type, summary, approval, routing, git, scope, requirements, architecture, preflight, validation, verification, manual_scenarios, tests, budget, diff_budget, commit.

kind: implementation | test_only. type: primary | follow_up. Для test_only только follow_up и дополнительное acceptance.reference.

routing: executor codex|kimi, effort low|medium, complexity low|medium|high, risk low|medium|high|critical.
git: base_branch develop, queue_branch ai-task-queue, base_sha полный SHA, work_branch ai/T-XXX-slug, parent_branch null для primary либо та же work_branch для follow_up.

preflight.commands, validation, verification.commands: массив объектов id/run/optional timeout_seconds. run — целая строка shell script. Docker/privileged/git-mutating команды запрещены. Команда может быть многострочной; credentials нельзя включать в текст.

verification: commands, db_queries [{id,sql}], assertions [строки]. Assertion без автоматического наблюдения недопустим: перенесите его в manual_scenarios.
manual_scenarios: [{id,steps,expected,optional commands,optional environment}]. Для implementation минимум один конкретный ручной сценарий.

tests: required_after_acceptance boolean, allowed_files, deferred_expectations [{path,reason}]. В implementation allowed_files всегда []; новые/изменённые test-файлы блокируются независимо от общего scope. В test_only задаются тестовые пути, production остаётся заморожен.

budget.repair_rounds: 0 или 1; для test_only — 0. diff_budget учитывает весь фактический diff задачи от pinned base. Scope не расширяется автоматически.

approval фиксирует явное разрешение человека. Runner не может криптографически удостоверить смысл сообщения; доверенная граница — оператор, создающий approved task в GitHub. Никогда не выдумывать approval или manual outcomes.

v8.2 задачи не конвертируются автоматически. Их можно явно перенести из ready в legacy-v8.2 для сохранения, затем подготовить новый полноценный контракт. Заменить только цифру версии недостаточно.
