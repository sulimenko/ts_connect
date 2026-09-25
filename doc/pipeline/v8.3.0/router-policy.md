# Выбор ролей v8.3

Complexity и risk независимы: маленький diff с денежной логикой может быть critical.

Executor:
- локальный точный fix: Codex GPT-6 Astra low;
- обычный backend/client path: Codex medium;
- широкий связанный контекст: Kimi K3, pipeline medium соответствует Kimi high;
- test-only: Codex low/medium или Kimi по согласованному scope.

Модели — локальная конфигурация runner, не произвольные task-provided IDs.
Technical Architect: Kimi K3 high по умолчанию, инструменты Read/Grep/Glob, ограниченный snapshot. Один отчёт со всеми findings A01.., решениями и proposed specification edits. Не бинарный veto-критик.

Для high complexity нужен architecture.reference на опубликованный JSON. ChatGPT указывает решение каждого finding: accepted, alternative или rejected, с причиной. Скрытые нерешённые safety/business вопросы нельзя считать закрытыми. Runner проверяет неизменность исследованных input blobs и корректность структуры; смысл бизнес-решений остаётся за человеком/ChatGPT.

Runtime Verifier: Codex read-only, medium для high/critical, low иначе. Никаких повторных архитектурных вызовов при обычном repair. Нет автоматической подмены провайдера после исчерпания quota.
