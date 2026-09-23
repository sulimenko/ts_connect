# AI Pipeline v8.2 project addendum

Use this as a migration checklist when updating a repository's existing `AGENTS.md` and `doc/ai/chatgpt/*`. Merge it with project-specific architecture rules; do not replace them blindly.

## Global orchestration

- Global runner home: `~/.ai-pipeline`.
- Codex/Kimi user homes contain vendor configuration and credentials only.
- ChatGPT = Architect + final Reviewer.
- Runner = queue/git/validation/runtime-verification/commit/PR orchestration.
- Executor = Codex GPT-6 Astra low|medium or Kimi K3 according to routing.
- Runtime Verifier = independent Codex read-only agent.
- Test Author may run after verified behavior and must not change frozen production code.

## Human loop

Normal flow: user describes problem -> research if needed -> ChatGPT shows task draft -> user explicitly approves GH task -> runner completes autonomously -> ChatGPT final review -> human merge decision.

## Research

Deep research may be published on `ai-task-queue` as:

- `doc/tasks/research/R-XXX-request.md`
- `doc/tasks/research/R-XXX-summary.md`
- `doc/tasks/research/R-XXX-context.md`
- `doc/tasks/research/R-XXX-manifest.json`
- `doc/tasks/research/R-XXX-bundle.zip`

Prefer `context.md` for GitHub-based ChatGPT reading; use the ZIP when raw/binary evidence is actually needed.

## Contract

New tasks use `version: 8.2.0` and include `research`, `routing`, `verification`, `tests`, `budget`, `validation`, scope and git/PR routing. Use the canonical schema/template from the global v8.2 distribution when drafting.

Runtime verification assertions describe observable proof, not implementation details. Critical-risk tasks require runtime verification. High-complexity + critical-risk tasks require an independent Plan Critic.

For verified-business-behavior workflows prefer `tests.strategy: after_verification` or `both`; the post-verification Test Author may only change authorized test files.

## Review

Final review must inspect exact remote PR head, task contract, changed-file scope, validation evidence, runtime verifier evidence, DB evidence when declared, post-verification tests and project-specific architecture invariants.

Runner publishes compact evidence to `doc/tasks/evidence/T-XXX-summary.md` on `ai-task-queue`. Full raw evidence remains local under `~/.ai-pipeline/runs/...`.
