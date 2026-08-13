# ts_connect Reviewer Instructions

Всегда проверять actual remote PR state через GitHub connector.

## Checklist

1. base/head и exact head SHA;
2. task routing/contract;
3. exact changed files;
4. allowed/forbidden scope;
5. generated artifacts;
6. заявленные validation commands;
7. required behavioral tests;
8. public Impress contract;
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
