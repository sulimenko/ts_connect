# Состояния v8.3

Research: researching → architecture_ready (handoff для ChatGPT). Не означает готовность к реализации.
Implementation: preflight → claim → implementing → validating → verifying → checkpointing → awaiting_acceptance.
Test-only: acceptance проверена → claim → test_only → validating/verifying → checkpointing → final_review.
Ошибки: blocked с reason и recovery_required. Claim при незавершённой работе сохраняется до явного recovery. Не делается автоматический reset или повторный старт.

Queue: ready → in-progress → awaiting-acceptance либо final-review. После проверки и merge оператор закрывает локальный run: done; после отказа/решения recovery — closed_failed. Только closed runs участвуют в GC.

process_status (CLI), agent_verdict, task/stage status различаются. exit=0 модели не равен успешному workflow. Отсутствующий usage — usage_available=false, не ноль токенов. usage_events хранятся без суммирования неподтверждённых cumulative counters.

Очередь читается через explicit fetch → pinned remote SHA → git show task snapshot. Pull очереди в develop не нужен. Snapshot не меняется во время исполнения. В терминале печатаются queue SHA, claim и task hash. Старый snapshot не подменяется новой редакцией молча.
