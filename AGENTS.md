# ts_connect — AI Pipeline v8.2

Repository: `sulimenko/ts_connect`.

Все tasks, review, follow-up и acceptance criteria писать на русском языке.

## Instruction precedence

1. Direct user instruction.
2. Active `ai-task-contract`.
3. This `AGENTS.md`.
4. `doc/ai/chatgpt/project-settings.md`.
5. Shared AI Pipeline v8.2 policy.
6. `doc/blueprint.md` and project-specific documentation.

## Shared pipeline

Version: `8.2.0`.

Local runtime:

`~/.ai-pipeline/`

ChatGPT-readable policy:

`ai-task-queue:doc/pipeline/v8.2.0/`

## Roles

- ChatGPT = Architect + Final Reviewer.
- Kimi K3 = Researcher and optional Executor.
- GPT-6 Astra = default Executor.
- Runner owns queue/git/scope/validation/runtime verification/commit/push/PR.
- Codex read-only = Runtime Verifier.
- Codex/Kimi = Test Author.

## Repository

Base: `develop`.

Queue: `ai-task-queue`.

Contract:

`version: 8.2.0`

## Runtime

Node.js 24 required.

Bootstrap:

`~/.ai-pipeline/projects/<repo-key>/env.sh`

## Sources of truth

- `doc/blueprint.md`
- `doc/openapi_20260411.md`
- relevant current production code
- official compatible Impress contract
- official TradeStation API contract

## Layers

- `application/api/` — RPC contract, access, validation, orchestration.
- `application/domain/` — state, lifecycle, registries, cleanup, multiplex subscriptions.
- `application/lib/` — TradeStation transport/protocol/parsing/normalization.
- `config/` — configuration only.
- `types/` — typing.

API layer does not own reconnect/state registries.

## TradeStation

- OAuth lifecycle: refresh -> `access_token` + `expires`.
- Stream lifecycle: subscribe -> touch -> unsubscribe -> cleanup.
- `domain.ts.clients` uses single-flight `connecting[name]` + `waiters[name]`.
- `domain.ts.streams` owns multiplex subscribers and stable `streamKey`.
- `lib.ts.stream` owns upstream HTTP stream/reconnect/heartbeat/parser.
- External response shape must be guarded.
- `INVALID SYMBOL` must not create infinite reconnect.
- `GoAway` / `StreamStatus: GoAway` remain transient reconnect events.

## Symbols

All parsing/formatting goes through `lib.utils`.

Public helpers:

- `makeSymbol()`
- `makeTSSymbol()`

Do not manually construct OPT symbols in endpoints/parsers/mappers.

## Impress

Both simple API function and extended declaration with `method` are valid.

`access`, `parameters`, `returns`, `errors`, `validate` are optional unless:

- user explicitly requires them;
- task contract requires them;
- existing runtime semantics depend on them.

Existing runtime-relevant metadata must not be silently removed or weakened.

No import-time side effects in autoloaded modules.

One `application/lib/<name>/` file exports one function.

Domain objects may hold singleton/registry state using `this.*`.

## Errors

`DomainError` only for predictable public/business contract errors.

`Error` for bugs, transport failures and unexpected integration failures.

## Tests

Use:

`tests.strategy: none | before | after_verification | both`

Validation baseline:

`npm test`

## Evidence

Raw:

`~/.ai-pipeline/runs/...`

Compact:

`ai-task-queue:doc/tasks/evidence/T-XXX-summary.md`

Research:

`ai-task-queue:doc/tasks/research/R-XXX-*`

## Safety

Without explicit approval:

- no `.env` or secrets;
- no dependencies/lockfiles;
- no production config;
- no unrelated refactor;
- no generated artifacts;
- no destructive production actions.
