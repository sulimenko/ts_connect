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

- [ ] Public Impress API uses a framework-compatible simple function or extended declaration.
- [ ] Optional extended fields `access`, `parameters`, `returns`, `errors`, `validate` are not required merely because a public procedure was touched.
- [ ] If user/task explicitly requires optional metadata, the required fields are present and correct.
- [ ] If user explicitly excluded optional metadata from current scope, its absence is not treated as a blocker.
- [ ] Existing runtime-relevant access/schema/validation/error mapping semantics are preserved unless the task explicitly changes them.
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
