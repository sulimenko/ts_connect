# Task T-050: Option chain empty snapshot timeout

```ai-task-contract
version: 1
task_id: T-050
type: follow_up
human_summary: "Закрыть hang case для options chain snapshot без валидных packets"
execution_mode: codex

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: ai/T-047-options-chain
  work_branch_policy: continue_parent_branch
  work_branch: ai/T-047-options-chain
  allow_new_branch: false
  allow_codex_git: false

scope:
  allowed_files:
    - application/lib/ts/optionChain.js
    - application/test/run.js
  forbidden_files:
    - doc/**
    - doc/tasks/**
    - doc/ai/**
    - AGENTS.md
    - config/**
    - types/**
    - node_modules/**
    - coverage/**
    - dist/**
    - "*.log"
    - "logs/**"
    - "tmp/**"
    - "temp/**"
    - "*.generated.*"

tests:
  required: true
  cover_behavior:
    - "options chain snapshot resolves on timeout even when no valid option packet arrives"
    - "timeout response has strikes=0, actualStrikes=0, partial=true, reason=timeout"
    - "valid packets still complete by expected count when enough strikes and legs arrive"
    - "invalid packets do not prevent timeout cleanup"
  allowed_files:
    - application/test/run.js

pr:
  mode: update_existing_parent_pr
  base: develop

validation:
  commands:
    - npm test

diff_budget:
  max_files_changed: 2
  max_added_lines: 120
  max_deleted_lines: 60

commit:
  message: "fix empty option chain snapshot timeout"
```

## Human summary

Нужно исправить оставшийся hang case в `application/lib/ts/optionChain.js`.

Сейчас snapshot timeout создаётся только внутри `onData` после первого валидного option packet. Если TradeStation stream открылся, но не прислал ни одного валидного option row, Promise может зависнуть и не вернуть partial response.

## Task

1. В `application/lib/ts/optionChain.js` запускать snapshot timeout независимо от первого валидного packet.

2. Timeout должен стартовать после запуска `client.streamChains(...)` или до него внутри Promise, но так, чтобы:
   - при отсутствии валидных packets response завершался;
   - `finalize()` вызывался с reason `timeout`;
   - stream cleanup через `client.stopStoredStream({ group: 'chains', key: streamKey })` сохранялся, если `streamKey` уже известен.

3. Если timeout сработал до получения `streamKey`, не допускать unhandled state:
   - Promise должен resolve один раз;
   - поздний `.then((key) => ...)` не должен ломать settled state;
   - не создавать double finalize.

4. Response при отсутствии валидных packets:
   - `strikes: 0`;
   - `chain: {}`;
   - `metadata.actualStrikes: 0`;
   - `metadata.actualLegs: 0`;
   - `metadata.partial: true`;
   - `metadata.reason: "timeout"`.

5. Сохранить существующее поведение:
   - valid rows с missing quotes/greeks не отбрасываются;
   - call-only/put-only strikes сохраняются;
   - `strikeRange=All` может использовать `options/strikes` только как diagnostic expected source;
   - не добавлять fake strikes в `chain`;
   - stream mode не менять.

## Naming rule

Имена функций и переменных лаконичные:

- 1 слово лучше 2;
- 2 слова лучше 3;
- длинное имя допустимо только если короткое теряет смысл;
- не вводить helper ради helper-а.

## Criteria

- Empty/invalid options chain snapshot больше не зависает.
- Timeout запускается без ожидания первого валидного packet.
- При отсутствии valid packets возвращается partial response с `strikes=0`, `actualStrikes=0`, `partial=true`, `reason=timeout`.
- Existing T-047/T-048 tests остаются green.
- Добавлен regression test для no valid packets / no onData case.
- `npm test` проходит.
- Codex не создавал branch, commit, push или PR.
