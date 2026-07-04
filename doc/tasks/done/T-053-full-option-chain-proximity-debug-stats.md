# Task T-053: Force full option chain proximity and add debug stats logs

```ai-task-contract
version: 1
task_id: T-053
type: follow_up
human_summary: "Для strikeRange=All всегда запрашивать широкий strikeProximity и добавить console.debug статистику chain"
execution_mode: codex

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: ai/T-051-clean-option-chain-all-touch
  work_branch_policy: continue_parent_branch
  work_branch: ai/T-051-clean-option-chain-all-touch
  allow_new_branch: false
  allow_codex_git: false

scope:
  allowed_files:
    - application/api/options/chain.js
    - application/lib/ts/optionChain.js
    - application/lib/stream/optionChain.js
    - config/log.js
    - application/test/run.js
  forbidden_files:
    - doc/**
    - doc/tasks/**
    - doc/ai/**
    - AGENTS.md
    - application/domain/**
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
    - "strikeRange=All always sends strikeProximity=1000"
    - "strikeRange=All ignores user-provided range for upstream strikeProximity"
    - "strikeRange=All still does not send priceCenter"
    - "non-All strikeRange keeps user-provided range and priceCenter behavior"
    - "chain stats are written with console.debug, not console.info/warn/error"
    - "snapshot debug stats include actualStrikes, expectedStrikes, minStrike, maxStrike and sample strikes"
    - "live stream debug stats include observedStrikes, observedLegs, minStrike, maxStrike and sample strikes"
    - "log visibility is controlled by existing metalog/config log level rules, not by custom TS_CHAIN_DEBUG env flags"
  allowed_files:
    - application/test/run.js

pr:
  mode: update_existing_parent_pr
  base: develop

validation:
  commands:
    - npm test

diff_budget:
  max_files_changed: 5
  max_added_lines: 180
  max_deleted_lines: 60

commit:
  message: "force full option chain proximity and add debug stats"
```

## Human summary

Runtime-тесты показали, что `strikeProximity` ограничивает полноту `stream/options/chains`.

Для SOXL `2026-07-17` значения меньше примерно `200` давали неполный диапазон страйков. Большие значения давали полный наблюдаемый набор. Поэтому для `strikeRange=All` нужно перестать зависеть от frontend `range` и всегда отправлять широкий `strikeProximity=1000`.

Также нужны диагностические chain stats, но не через отдельный env flag и не через `console.info`. В проекте уже используется metalog/log-level control. Поэтому статистику нужно писать через `console.debug`, а отображение debug-логов должно регулироваться существующими правилами metalog и `config/log.js`.

## Task

### 1. Исправить upstream request для `strikeRange=All`

В `application/api/options/chain.js` изменить построение `chainData`.

Для `strikeRange === "All"`:

- всегда отправлять `strikeProximity: 1000`;
- игнорировать user/frontend `range` для upstream request;
- не отправлять `priceCenter`.

Для `strikeRange !== "All"`:

- сохранить текущую логику:
  - `strikeProximity` берётся из `range`;
  - `priceCenter` отправляется, если он валиден.

Ожидаемая логика:

```js
const requestedProximity = Math.max(0, Number(range) || 0);
const allStrikeProximity = 1000;
const proximity = strikeRange === 'All' ? allStrikeProximity : requestedProximity;
```

Дальше:

```js
if (strikeRange === 'All') {
  chainData.strikeProximity = proximity;
} else {
  chainData.strikeProximity = proximity;
  if (centerPrice !== null) chainData.priceCenter = centerPrice;
}
```

### 2. Добавить snapshot chain stats через `console.debug`

В `application/lib/ts/optionChain.js` добавить логирование финальной статистики snapshot через:

```js
console.debug(...)
```

Не использовать:

```js
process.env.TS_CHAIN_DEBUG
```

Не добавлять отдельный debug flag в application/lib.

Название сообщения:

```text
options/chain snapshot stats
```

Логировать только агрегаты, не полный TradeStation payload.

Поля:

- `symbol`
- `expiration`
- `reason`
- `durationMs`
- `lastPacketAgeMs`
- `partial`
- `expectedSource`
- `expectedStrikes`
- `actualStrikes`
- `actualLegs`
- `missingStrikes`
- `missingLegs`
- `requested`
- `minStrike`
- `maxStrike`
- `minStrikeValue`
- `maxStrikeValue`
- `firstStrikes`
- `lastStrikes`

`firstStrikes` и `lastStrikes` ограничить максимум 10 значениями.

### 3. Добавить live stream chain stats через `console.debug`

В `application/lib/stream/optionChain.js` добавить агрегирование по active stream:

- `observedStrikes: Set`
- `observedLegs: Map<strike, Set<optionType>>`
- `streamStartedAt`

Писать статистику через:

```js
console.debug(...)
```

Название сообщения:

```text
stream/chains observed stats
```

Логировать:

- один раз через 15 секунд после start;
- при stop/unsubscribe cleanup;
- при startup error.

Поля:

- `phase`
- `streamKey`
- `symbol`
- `expiration`
- `strikeRange`
- `strikeProximity`
- `priceCenter`
- `optionType`
- `strikeInterval`
- `observedStrikes`
- `observedLegs`
- `minStrike`
- `maxStrike`
- `minStrikeValue`
- `maxStrikeValue`
- `firstStrikes`
- `lastStrikes`
- `durationMs`

`firstStrikes` и `lastStrikes` ограничить максимум 10 значениями.

### 4. Настроить видимость debug logs через `config/log.js`

В `config/log.js` настроить только отражаемые уровни логов для metalog, чтобы `console.debug`-сообщения не шумели при обычном уровне логирования и появлялись только когда пользователь включает debug-level по существующим правилам проекта.

Важно:

- не добавлять бизнес-логику в `config/log.js`;
- не добавлять кастомный `TS_CHAIN_DEBUG`;
- использовать существующий механизм metalog/log-level control;
- если `config/log.js` уже существует, внести минимальное изменение только для отражаемых уровней;
- если файла нет, создать минимальный config-файл только для log level mapping, совместимый с существующей конфигурацией проекта.

### 5. Не менять stream lifecycle

В этой задаче нельзя:

- делать auto-resubscribe;
- менять `domain.ts.streams`;
- добавлять replay/cache;
- менять lifecycle subscribe/touch/unsubscribe.

Эта задача только:

```text
All -> strikeProximity=1000
chain stats -> console.debug
visibility -> config/log.js / metalog levels
```

## Important constraints

- Не использовать `process.env.TS_CHAIN_DEBUG`.
- Chain stats писать через `console.debug`.
- Не логировать полный TradeStation payload.
- Не создавать synthetic/empty strikes.
- Не менять symbol parsing rules.
- Не собирать OPT symbol вручную.
- Не менять `DomainError` / `Error` semantics.
- `config/log.js` может содержать только log config / reflected levels, без бизнес-логики.
- Codex не должен создавать branch, commit, push или PR.

## Acceptance criteria

- Для `strikeRange=All` upstream request всегда содержит `strikeProximity=1000`.
- Для `strikeRange=All` upstream request не содержит `priceCenter`.
- Для `strikeRange=All` frontend/user `range` не влияет на upstream `strikeProximity`.
- Для non-`All` режимов `range` и `priceCenter` продолжают работать как раньше.
- Snapshot chain stats пишутся через `console.debug`.
- Live stream chain stats пишутся через `console.debug`.
- Логи содержат только агрегаты и samples, без полного payload.
- Debug stats не видны при обычном log level.
- Debug stats видны при включённом debug-level через существующий metalog/config log mechanism.
- Не добавлен новый env flag `TS_CHAIN_DEBUG`.
- Existing T-051/T-052 tests остаются green.
- `npm test` проходит.
