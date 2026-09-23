# Research R-XXX: short problem

## Problem

Describe the observed problem and why research is needed before task creation.

## Questions

- Which code path owns the behavior?
- What are the likely root causes supported by code/evidence?
- Which files and tests are relevant?
- What runtime/DB observations would distinguish the competing causes?
- What is the minimal safe scope for a production task?

## Constraints

- Research is read-only.
- Do not edit repository files.
- Do not perform DB writes or destructive commands.
- Do not invent accepted business behavior; mark unresolved business decisions explicitly.

## Optional local evidence

Pass logs, dumps, screenshots-as-text or query outputs to `research-bundle.sh --attach ...`.
