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

## Safety

Without explicit approval:

- no `.env` or secrets;
- no dependencies/lockfiles;
- no production config;
- no unrelated refactor;
- no generated artifacts;
- no destructive production actions.
