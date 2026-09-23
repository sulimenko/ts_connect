# AI Pipeline v8.2.0 worker rules

## Ownership

- User defines the business goal and approves the task once.
- ChatGPT Architect defines accepted behavior, architecture boundaries, risk/complexity routing, exact scope and verification targets.
- Runner owns queue state, git routing, validation, phase gates, runtime verification orchestration, commit, push and draft PR routing.
- Executor (Codex GPT-6 Astra or Kimi K3) owns production implementation inside the active contract.
- Runtime Verifier is independent from the executor and must not edit production code.
- Test Author converts accepted, verified behavior into regression tests without changing the accepted production implementation.
- ChatGPT performs the final high-level review when the task reaches `review-ready`.

## Compact human loop

Normal task flow requires human input only at:

1. problem description / research request;
2. approval of the final task contract;
3. final merge decision after ChatGPT review.

After task approval the runner continues automatically through implementation, repair, validation, runtime verification, DB checks and test creation. It stops only for a real blocker, exhausted bounded repair budget or explicit human acceptance requirement.

## Execution layout

v8.2 keeps `project-root` execution by default because existing projects may depend on already-installed `node_modules`, `vendor`, local services and local config in the developer checkout. The runner requires a clean checkout before starting and restores the original branch when it can do so safely.

Queue mutations still use temporary detached queue worktrees, so `ai-task-queue` files never enter production branches.

## Model routing

The task stores semantic routing, not arbitrary model IDs.

- Codex executor = `gpt-6-astra`, effort `low` or `medium` only.
- Kimi executor = Kimi K3.
- Kimi K3 is preferred when broad repository context or many related modules materially help.
- Codex Astra is preferred for precise bounded edits, repair iterations and most test-author work.
- Plan Critic is used only for high-complexity/high-risk tasks and should normally be a different provider from the executor.
- Runtime Verifier defaults to Codex Astra in read-only sandbox.

Concrete model IDs live only in `~/.ai-pipeline/config.env`.

## Research vs Architect

Research is evidence collection, not task ownership.

Kimi research is read-only and produces a compact research summary plus an optional evidence bundle. ChatGPT Architect remains responsible for deciding scope, accepted behavior, routing and the task contract.

Research evidence may be published only to `ai-task-queue` under `doc/tasks/research/`. It must never be merged into production branches.

## Autonomy and repair

Executor should continue through ordinary reversible in-scope edit/check/fix work without human handoff.

Repair may not:

- broaden accepted behavior;
- weaken tests, validation or verification assertions;
- change dependencies, secrets, runtime config or schema without task authorization;
- escape the scope envelope;
- reinterpret a failed verifier assertion as success.

Implementation validation failures return to the executor within the bounded implementation repair budget.
Runtime verification failures return to the executor within the bounded verification-fix budget.
Test-author validation failures return to the Test Author within the bounded test-repair budget.

## Phase separation

### Implementation phase

Production implementation follows `scope.allowed_files`.
If `tests.strategy=after_verification`, test files are frozen out of the implementation phase.

### Runtime verification phase

The runner executes declared read-only verification commands and read-only DB queries, stores raw evidence locally, then asks an independent verifier to judge the result against the task and verification contract.

Verifier must not edit files. Codex verifier runs in `read-only` sandbox.

### Test phase

For `after_verification` or `both`, Test Author receives the verified behavior and evidence summary. Production diff is frozen before this phase. Any production-code change by Test Author is a phase-gate failure.

## DB safety

DB verification is read-only. Queries are passed through `sql-guard.py` and then through a project-specific read-only DB command configured outside the repository.

Allowed families: `SELECT`, `SHOW`, `DESCRIBE`, and non-executing `EXPLAIN ... SELECT`.
Disallowed examples: DML/DDL, `SELECT ... FOR UPDATE`, `SELECT ... INTO OUTFILE`, `EXPLAIN ANALYZE`, multiple statements.

The DB account itself must also be read-only. The SQL guard is defense in depth, not the primary security boundary.

## Scope

Read scope may include relevant repository code, documentation and existing tests, except explicitly forbidden/generated/dependency paths.
Write scope is contract-controlled and phase-controlled.

Do not inspect generated/dependency/cache directories unless the task explicitly requires it, including typical paths such as `.git/**`, `vendor/**`, `node_modules/**`, build/cache/storage outputs and credential stores.

## Git

Agents do not create/switch/delete branches, commit, push, merge, rebase, alter queue state or create PRs. Runner owns all git routing.

## Completion

A normal v8.2 task reaches runner-complete queue state `done` (ready for ChatGPT final review) only when:

1. implementation scope gate passed;
2. static/project validation passed;
3. runtime verification passed when required;
4. DB checks passed when declared;
5. post-verification tests were created when required;
6. final validation passed;
7. production diff remained frozen during tests;
8. final scope/diff budget passed;
9. branch was pushed and PR routing succeeded;
10. compact evidence summary was published to the queue branch.
