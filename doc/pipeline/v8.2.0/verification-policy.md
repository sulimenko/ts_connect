# v8.2 Runtime Verification Policy

Static tests are not proof that the running system behaves correctly. Runtime verification is a separate gate between implementation and post-acceptance test creation.

## Evidence flow

1. runner executes only the user-approved `verification.commands` from the task contract;
2. runner validates and executes `verification.db_queries` through the read-only DB wrapper;
3. full raw stdout/stderr stays under `~/.ai-pipeline/runs/.../verification/pass-N/`;
4. compact evidence is built for the verifier;
5. independent Codex verifier evaluates every `verification.assertions` item against the evidence in a read-only sandbox and returns exactly one verdict marker:
   - `AI_PIPELINE_VERDICT=pass`
   - `AI_PIPELINE_VERDICT=fail`
6. a fail may return to the executor within `budget.verification_fix_rounds`;
7. a pass unlocks post-verification test creation.

## DB

Each project may define `~/.ai-pipeline/projects/<repo-key>/config.env` with:

```bash
AI_DB_READONLY_COMMAND='psql "$AI_DB_READONLY_DSN" -X -v ON_ERROR_STOP=1 -P pager=off'
```

or an equivalent MySQL command that reads SQL from stdin.

The database role must be read-only. Never store DB credentials in the repository or task markdown.

## Human acceptance

`verification.human_gate=true` stops after successful agent verification and publishes evidence for a human business decision. Default is false.

## UI

UI/computer-use is intentionally outside the default v8.2 verifier. API/CLI/runtime/log/DB verification is the default. Browser/UI verification can be added later as a separate adapter.
