# Task T-056: Исправить HTTP error lifecycle при reconnect matrix stream

```ai-task-contract
version: 1
task_id: T-056
type: follow_up
human_summary: "Исправить два blocker из review PR #10: capacity и permanent HTTP errors во время reconnect должны попадать в корректный domain lifecycle, а rate-limit headers и 5xx должны классифицироваться без ложного перевода в capacity queue."
execution_mode: codex