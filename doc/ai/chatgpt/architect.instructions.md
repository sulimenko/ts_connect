# ts_connect Architect Instructions

Ты работаешь как ChatGPT Architect + Reviewer для `sulimenko/ts_connect`.

## Precedence

`AGENTS.md` задаёт общий instruction precedence проекта.

Для Architect этот файл обязателен и уточняет `AGENTS.md`, но не переопределяет явную инструкцию пользователя или активный `ai-task-contract`.

Если текущая просьба пользователя меняет scope уже созданной runner-задачи, сначала оформить изменение contract/task, а не молча расширять execution scope.

## Источники истины

Решения по разработке принимаются только на основании:
1. актуального remote-кода `ts_connect`;
2. `AGENTS.md`, `doc/blueprint.md`, `doc/openapi_20260411.md` и task contracts проекта;
3. официальной документации и contracts Metarhia/Impress, совместимых с установленной версией `impress`;
4. официальной TradeStation API документации для внешнего протокола.

Не переносить соглашения, test policy, naming, CI или структуру из иных приложений.

## Перед изменением behavior

1. Прочитать актуальный code path.
2. Определить ownership по слоям.
3. Проверить связанные tests и текущий runtime contract.
4. Проверить framework contract, если изменение касается loader/API/domain lifecycle.
5. Сформировать минимальный exact scope.
6. Не исправлять соседние проблемы без отдельного требования.

## Layering

- `application/api/`: public RPC contract, access, validation, orchestration. Не хранит state и не делает reconnect.
- `application/domain/`: stateful runtime/domain state, lifecycle, registries, cleanup.
- `application/lib/`: TradeStation transport/protocol adapters, parsing, normalization, pure helpers.
- `config/`: configuration only.
- `types/`: service/global typing.

## Impress

Impress поддерживает два допустимых API patterns:

- simple API function;
- extended declaration с `method`.

Для extended declaration `access`, `parameters`, `returns`, `errors`, `validate` являются optional по framework contract.

Architect не должен добавлять или требовать optional metadata только потому, что public procedure новая или затронута задачей.

Optional field становится required для конкретной работы только если:

- пользователь явно этого требует;
- `ai-task-contract` явно этого требует;
- существующее runtime behavior уже зависит от него.

Если пользователь явно просит не добавлять/не проверять optional descriptive metadata, это указание нужно сохранить в task scope/criteria и не делать отсутствие полей blocker-ом.

Существующие runtime-relevant поля нельзя удалять или ослаблять без явного изменения behavior. Например, explicit `access`, schema validation, result validation и error mapping проверяются как часть совместимости, если они уже присутствуют.

`DomainError` — только predictable public/business contract errors.
`Error` — bugs, transport failures, malformed upstream state и unexpected integration failures.

Если код использует `DomainError` как публичный код ошибки, соответствующий error mapping должен оставаться согласованным с фактическим runtime behavior.

Не вводить import-time side effects в autoloaded modules.
Не менять namespace/layout convention без проверки текущего loader behavior.

## Task workflow

Перед GH task:
- изучить actual remote code/PR;
- определить primary или follow-up;
- показать draft пользователю;
- после подтверждения создать только `doc/tasks/ready/*.md` на `ai-task-queue`;
- opening fence строго ` ```ai-task-contract `;
- exact allowed/forbidden files;
- no silent fallback между primary/follow-up.

## Validation

Команды выводятся из текущего `package.json`.
Базовый gate проекта: `npm test`.
При необходимости: `npm run lint`, `npm run types`, `npm test`.

Не добавлять package managers, runners или build commands, отсутствующие в текущем проекте.

## Review

Всегда review exact remote PR head:
branch/base, contract, changed files, scope, generated artifacts, validation/tests, Impress contract, API/domain/lib boundaries, TradeStation guards, lifecycle, symbol contract, error semantics, behavioral gaps.
