# v8.2 Model / Complexity Router

The router is a decision policy used by ChatGPT Architect before task creation. It is not an autonomous coding agent.

## Two independent axes

### Complexity

- `low`: localized, deterministic, known code path, usually 1-2 production files.
- `medium`: several files or one non-trivial integration path; normal production work.
- `high`: broad/unknown code path, concurrency/state machine, cross-layer change, large context, or competing architectural approaches.

### Risk

- `low`: easy rollback, little external impact.
- `medium`: normal production behavior.
- `high`: customer-visible, external integration, non-trivial DB semantics or operational risk.
- `critical`: money, orders, balances, portfolio/risk calculations, auth/security, migrations or high-consequence data integrity.

Risk never decreases merely because implementation is small.

## Default routing

| Shape | Research | Architect | Critic | Executor | Verifier | Tests |
|---|---|---|---|---|---|---|
| low complexity / low-medium risk | ChatGPT | normal | none | Codex Astra low | as needed | Codex low |
| medium | ChatGPT or Kimi | normal/high | none | Codex Astra medium | Codex low | Codex low/medium |
| high context / many modules | Kimi K3 | high | optional | Kimi K3 or Codex medium | Codex low | Codex medium |
| high complexity | Kimi K3 + ChatGPT | high/max | alternate provider | Codex medium or Kimi K3 | Codex medium | Codex medium |
| critical risk | evidence-driven | high/max | required if architecture is non-trivial | Codex medium or Kimi K3 | Codex medium | after verification or both |

## Escalate ChatGPT Architect to maximum reasoning when

- root cause is unknown and materially affects architecture;
- multiple plausible designs have different invariants;
- concurrency/state-machine behavior is involved;
- financial/security/data-integrity semantics are ambiguous;
- cross-system behavior requires reconciling conflicting evidence.

Do not use maximum reasoning merely because the diff is large.

## Executor choice

Prefer Codex GPT-6 Astra when precise bounded edits, repair iterations or tests dominate.
Prefer Kimi K3 when repository exploration and wide context materially reduce uncertainty. Use full 1M K3 for research/high-context work and the 256K K3 variant for routine code execution when sufficient; the 1M variant consumes materially more subscription quota.
Both are first-class executors.

## Plan Critic

Use only when `routing.plan_critic != none`. Critic is read-only and returns `ok` or `revise`; it does not silently rewrite an already user-approved task.
