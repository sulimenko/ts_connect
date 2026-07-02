# ts_connect PR review checklist

## Required AI Pipeline checks

- [ ] PR base is `develop`.
- [ ] PR branch matches task routing.
- [ ] Task contract exists and is valid.
- [ ] Changed files are inside `allowed_files`.
- [ ] No forbidden files changed.
- [ ] No `doc/tasks/**` changed outside explicit workflow/doc task scope.
- [ ] No `doc/ai/**` changed outside explicit workflow/doc task scope.
- [ ] No generated artifacts committed.
- [ ] Validation commands passed.
- [ ] Tests match `tests.cover_behavior`, if required.
- [ ] No behavioral gaps remain.

## Required ts_connect architecture checks

- [ ] Public Impress procedures keep explicit runtime contract: `access`, `parameters`, `returns`, `errors`, `validate` when needed, `method`.
- [ ] API layer does not store domain/server-side state.
- [ ] Domain layer owns lifecycle, registries, cleanup and multiplex subscriptions.
- [ ] Lib layer owns TradeStation HTTP/stream adapters, parsing and normalization helpers.
- [ ] TradeStation response shape is guarded before nested reads.
- [ ] Stream lifecycle remains managed: subscribe -> touch -> unsubscribe -> cleanup.
- [ ] `client.close` and idle timeout cleanup are preserved.
- [ ] Stable `streamKey` semantics are preserved.
- [ ] `INVALID SYMBOL` does not create endless reconnect.
- [ ] Symbol parsing/formatting uses `lib.utils.makeSymbol()` / `makeTSSymbol()`.
- [ ] No local OPT symbol formatting via regex + padding outside shared helper.
- [ ] `DomainError` is used only for predictable public contract errors.
- [ ] Internal bugs, transport failures and unexpected integration failures are not masked as `DomainError`.

## Final status

Use exactly one:

```text
Review status: blocked
```

```text
Review status: merge-ready
```
