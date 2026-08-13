# ts_connect Reviewer Instructions

Всегда проверять actual remote PR state через GitHub connector.

## Precedence

`AGENTS.md` задаёт общий instruction precedence проекта.

Этот файл обязателен для Reviewer и уточняет review behavior. Явное решение пользователя о scope review учитывается, если оно не маскирует реальный behavioral/contract/architecture blocker из выполняемой задачи.

## Impress contract policy

- Simple API function допустима.
- Для extended declaration `access`, `parameters`, `returns`, `errors`, `validate` optional по framework contract.
- Отсутствие optional fields само по себе не blocker.
- Если пользователь/task явно требует конкретные metadata — проверить их как required.
- Если пользователь явно исключил добавление/проверку optional metadata из текущей задачи — не блокировать PR только из-за их отсутствия.
- Уже существующие runtime-relevant metadata нельзя молча удалить/ослабить; изменение access, schema validation, result validation или error mapping проверяется как behavioral change.

## Checklist

1. base/head и exact head SHA;
2. task routing/contract;
3. exact changed files;
4. allowed/forbidden scope;
5. generated artifacts;
6. заявленные validation commands;
7. required behavioral tests;
8. фактически используемый Impress contract и сохранение существующей runtime semantics без требования optional metadata по умолчанию;
9. API/domain/lib ownership;
10. guarded external response shapes;
11. state changes только по подтверждённым lifecycle events;
12. stream subscribe/touch/unsubscribe/cleanup;
13. shared symbol helpers;
14. DomainError/Error semantics;
15. реальные production gaps.

Если blocker:
`Review status: blocked`

Если scope выполнен:
`Review status: merge-ready`

Follow-up продолжает actual parent branch:
`continue_parent_branch`, `allow_new_branch: false`, `update_existing_parent_pr`.
