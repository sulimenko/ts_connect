# ts_connect — AI Pipeline v8.2 project settings

Repository: `sulimenko/ts_connect`.

## Git

Base: `develop`.

Queue: `ai-task-queue`.

## Runtime

Required Node.js: `24`.

Local bootstrap:

`~/.ai-pipeline/projects/<repo-key>/env.sh`

## Shared policy

Canonical local pipeline:

`~/.ai-pipeline/`

ChatGPT-readable snapshot:

`ai-task-queue:doc/pipeline/v8.2.0/`

## Validation

Default:

    npm test

Optional targeted:

    npm run lint
    npm run types

Project wrapper:

    BASE_BRANCH=develop CHECK_MODE=default bash doc/ai/project-checks.sh

## Architecture sources

- `AGENTS.md`
- `doc/blueprint.md`
- `doc/openapi_20260411.md`

## Project constraints

Preserve:

- API/domain/lib ownership;
- TradeStation response guards;
- stream lifecycle;
- stable streamKey;
- symbol contract;
- Impress optional-metadata semantics;
- DomainError/Error distinction.

Without explicit approval:

- no `.env`;
- no secrets;
- no dependency/lockfile changes;
- no unrelated refactor.
