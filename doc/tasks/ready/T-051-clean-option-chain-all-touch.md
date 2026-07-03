# Task T-051: Clean option chain All request and inactive touch

```ai-task-contract
version: 1
task_id: T-051
type: primary
human_summary: "Исправить полноту options chain для All и сделать inactive touch явным"
execution_mode: codex

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: none
  work_branch_policy: create_task_branch
  work_branch: ai/T-051-clean-option-chain-all-touch
  allow_new_branch: true
  allow_codex_git: false

scope:
  allowed_files:
    - application/api/options/chain.js
    - application/lib/ts/optionChain.js
    - application/lib/stream/optionChain.js
    - application/domain/ts/streams.js
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
    - "strikeRange=All does not send strikeProximity to TradeStation stream chains"
    - "strikeRange=All does not send priceCenter to TradeStation stream chains"
    - "non-All strikeRange keeps strikeProximity and priceCenter behavior"
    - "option chain snapshot for All waits by idle window and hard timeout"
    - "option chain snapshot does not create empty strikes from options/strikes"
    - "inactive stream touch returns active=false and resubscribeRequired=true"
    - "active stream touch keeps active=true behavior"
  allowed_files:
    - application/test/run.js

pr:
  mode: create_new
  base: develop

validation:
  commands:
    - npm test

diff_budget:
  max_files_changed: 5
  max_added_lines: 220
  max_deleted_lines: 100

commit:
  message: "fix option chain all request and inactive touch"
```

## Human summary

Нужно улучшить полноту options chain и убрать неоднозначное поведение stream lifecycle.

Сейчас `application/api/options/chain.js` всегда кладёт `strikeProximity` в `chainData`, а `priceCenter` добавляет при наличии параметра, даже когда `strikeRange=All`. Из-за этого запрос фактически становится `All + strikeProximity + priceCenter`, что может ограничивать TradeStation response.

Также `domain.ts.streams.touch()` для missing или inactive subscription возвращает `active=false`, но без явного признака, что frontend должен сделать повторный `subscribe`.

## Task

1. В `application/api/options/chain.js` изменить построение `chainData`:

   - если `strikeRange === "All"`:
     - не добавлять `strikeProximity`;
     - не добавлять `priceCenter`;
   - если `strikeRange !== "All"`:
     - сохранить текущее поведение `strikeProximity`;
     - сохранить текущее поведение `priceCenter`, если он валиден.

2. Не создавать skeleton chain из `options/strikes`.

   `options/strikes` может оставаться только diagnostic source для `expectedStrikes` в `application/lib/ts/optionChain.js`. Не добавлять пустые strikes в `response.chain`.

3. В `application/lib/ts/optionChain.js` заменить fixed 5s snapshot на более устойчивое ожидание:

   - для `strikeRange=All`:
     - `minWaitMs`: 5000;
     - `idleMs`: 1500;
     - `hardTimeoutMs`: 15000;
   - для остальных режимов:
     - сохранить компактное ожидание около текущих 5000ms;
   - каждый valid option packet должен обновлять timestamp последнего packet;
   - finalize делать, когда:
     - собрано достаточно expected strikes/legs; или
     - после `minWaitMs` нет новых valid packets в течение `idleMs`; или
     - наступил `hardTimeoutMs`.

4. Важно: если данные не пришли, не добавлять пустые strikes.

   Response должен оставаться честным:

   - `chain` содержит только реально пришедшие valid option rows;
   - `metadata.partial=true`, если expected больше actual;
   - `metadata.reason` должен различать:
     - `complete`;
     - `timeout`;
     - `idle`;
     - `error`.

5. В `application/domain/ts/streams.js` сделать inactive touch явным:

   - если entry отсутствует:
     - вернуть `active: false`;
     - `resubscribeRequired: true`;
     - `reason: "missing"`;
   - если entry есть, но client не подписан:
     - вернуть `active: false`;
     - `resubscribeRequired: true`;
     - `reason: "not-subscribed"`;
   - active touch должен сохранить текущее поведение и вернуть `resubscribeRequired: false`.

6. В `application/lib/stream/optionChain.js` убедиться, что response для action `touch` пробрасывает эти поля без маскировки.

7. Добавить regression tests в `application/test/run.js`.

## Criteria

- Для `strikeRange=All` upstream stream request не содержит `strikeProximity`.
- Для `strikeRange=All` upstream stream request не содержит `priceCenter`.
- Для не-`All` режимов `strikeProximity` и `priceCenter` продолжают работать.
- Snapshot для `All` не завершается слишком рано фиксированными 5 секундами, если valid packets продолжают приходить.
- Snapshot для `All` завершается по idle после минимального ожидания или по hard timeout.
- `response.chain` не содержит synthetic/empty strikes из `options/strikes`.
- Missing/inactive touch возвращает `resubscribeRequired: true`.
- Active touch возвращает `resubscribeRequired: false`.
- Existing T-047/T-048/T-050 tests остаются green.
- `npm test` проходит.
- Codex не создавал branch, commit, push или PR.
