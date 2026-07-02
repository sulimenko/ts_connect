# Task T-047: Options chain completeness

```ai-task-contract
version: 1
task_id: T-047
type: primary
human_summary: "Диагностировать и исправить incomplete options chain strikes"
execution_mode: codex

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: none
  work_branch_policy: create_task_branch
  work_branch: ai/T-047-options-chain
  allow_new_branch: true
  allow_codex_git: false

scope:
  allowed_files:
    - application/api/options/chain.js
    - application/api/options/strikes.js
    - application/lib/ts/optionChain.js
    - application/lib/ts/readOptionChain.js
    - application/lib/stream/optionChain.js
    - application/lib/utils.js
    - application/test/run.js
  forbidden_files:
    - doc/**
    - doc/tasks/**
    - doc/ai/**
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
    - "options/chain не маскирует partial chain как полный ответ"
    - "range=0 и strikeRange=All не считаются complete только из-за expectedStrikes=0"
    - "valid option rows с missing Bid/Ask/Last/Greeks не отбрасываются"
    - "rows с только call или только put сохраняются"
    - "actual strikes и partial metadata видны в response"
  allowed_files:
    - application/test/run.js

pr:
  mode: create_new
  base: develop

validation:
  commands:
    - npm test

diff_budget:
  max_files_changed: 8
  max_added_lines: 400
  max_deleted_lines: 250

commit:
  message: "fix options chain completeness diagnostics"
```

## Human summary

Нужно исправить `options/chain`, чтобы server-side incomplete chain не выглядел как нормальный полный ответ.

## Контекст

Сейчас `application/api/options/chain.js` для snapshot использует TradeStation stream endpoint:

```text
GET /v3/marketdata/stream/options/chains/{underlying}
```

`application/lib/ts/optionChain.js` собирает snapshot из stream packets и завершает ответ по эвристике:

- `expectedStrikes = strikeProximity * 2`;
- `response.strikes` фактически является expected count, а не actual strikes;
- при `range = 0` и `strikeRange = 'All'` expected count становится `0`;
- timeout запускается только после первого валидного packet;
- partial upstream response возвращается без явного признака `partial`.

## Задача

1. Проверить полный code path:
   - `application/api/options/chain.js`;
   - `application/api/options/strikes.js`;
   - `application/lib/ts/optionChain.js`;
   - `application/lib/ts/readOptionChain.js`;
   - `application/lib/stream/optionChain.js`;
   - `application/lib/utils.js`.

2. Сохранить backward-compatible поля response:
   - `symbol`;
   - `expiration`;
   - `strikes`;
   - `chain`.

3. Добавить diagnostic metadata без breaking change. Минимальный смысл metadata:
   - requested params;
   - expected strikes;
   - actual strikes;
   - expected legs per strike;
   - `partial`;
   - `source`;
   - `reason`.

4. Не добавлять fake strikes в `chain`, если TradeStation их не вернул.

5. Если expected strike universe нужен для `strikeRange = 'All'`, использовать `marketdata/options/strikes/{underlying}` как diagnostic/preflight source, но не заменять им actual chain.

6. Проверить parser:
   - не отбрасывать valid rows только из-за missing Bid/Ask/Last/Delta/Gamma/Theta/Vega;
   - не отбрасывать strike, если есть только call или только put;
   - invalid shape без `Legs`, `Symbol`, `Expiration`, `OptionType` можно отбрасывать, но это должно быть контролируемо.

7. Проверить stream mode:
   - `application/lib/stream/optionChain.js` сейчас emits one-strike delta packet;
   - не превращать stream event в fake full chain;
   - не ломать existing stream payload без отдельного решения.

## Naming rule

При правках использовать лаконичные имена функций и переменных:

- 1 слово лучше 2;
- 2 слова лучше 3;
- длинное имя допустимо только если короткое теряет смысл;
- не вводить helper ради helper-а;
- не добавлять verbose builder names, если локальная компактная сборка читается лучше.

## Критерии готовности

- Найдено и исправлено место, где incomplete chain маскировался как complete.
- `options/chain` явно показывает `actual` vs `expected` и `partial`.
- `range=0` / `strikeRange=All` больше не создаёт ложное ощущение complete response.
- Valid partial rows не теряются из-за отсутствия quote/greeks fields.
- Rows с call-only или put-only не выбрасываются.
- `strikes` и `chain` больше не конфликтуют молча.
- `npm test` проходит.
- Codex не создавал branch, commit, push или PR.
