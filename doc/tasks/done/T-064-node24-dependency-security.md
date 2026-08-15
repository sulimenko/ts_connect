# Task T-064: Перевести runtime на Node.js 24 и устранить high-severity зависимости

```ai-task-contract
version: 2
task_id: T-064
type: follow_up
human_summary: "Зафиксировать Node.js 24 как единственную поддерживаемую runtime-версию во всех локальных, CI и container entrypoints, обновить lockfile и устранить high/critical npm vulnerabilities без npm audit fix --force и без изменений application-кода."
execution_mode: codex

git:
  base_branch: develop
  queue_branch: ai-task-queue
  parent_branch: ai/T-056-order-stream-recovery
  work_branch_policy: continue_parent_branch
  allow_new_branch: false
  allow_codex_git: false

scope:
  allowed_files:
    - package.json
    - package-lock.json
    - .github/workflows/test.yml
    - Dockerfile
    - .nvmrc
  forbidden_files:
    - application/**
    - config/**
    - types/**
    - doc/**
    - node_modules/**
    - coverage/**
    - dist/**
    - logs/**
    - artifacts/**
    - "*.log"
    - "*.zip"
    - npm-debug.log*

tests:
  phase: implementation
  required: false
  user_acceptance_required: false
  acceptance_reference: none
  cover_behavior: []
  allowed_files: []

pr:
  mode: update_existing_parent_pr
  base: develop
  description_mode: replace_from_task
  comments_allowed: false

validation:
  commands:
    - node --version
    - npm ci
    - npm test
    - npm audit --audit-level=high
    - npm audit --omit=dev --audit-level=high

diff_budget:
  max_files_changed: 5
  max_added_lines: 120
  max_deleted_lines: 120

commit:
  message: "support node 24 and refresh dependencies"
```

## Контекст

Локальная проверка PR #13 выполнена на:

```text
Node.js v24.15.0
npm 11.12.1
```

Результат:

```text
53 test(s) passed
```

При `npm ci` возникает предупреждение:

```text
EBADENGINE
required: node 22
current: node 24.15.0
```

Также npm сообщает:

```text
4 high severity vulnerabilities
```

Код приложения уже проходит полный test suite на Node.js 24, но runtime metadata, CI и Docker всё ещё используют Node.js 22.

## Требуемые изменения

### 1. Зафиксировать Node.js 24

В `package.json` изменить:

```json
"engines": {
  "node": "22"
}
```

на явный диапазон одной major-версии:

```json
"engines": {
  "node": ">=24 <25"
}
```

Эквивалентный корректный semver range для Node.js 24 допустим, но нельзя разрешать Node.js 22, 23 или 25 без отдельной проверки.

Обновить соответствующий root package metadata в `package-lock.json`.

### 2. Добавить локальную версию Node.js

Создать `.nvmrc`:

```text
24
```

После этого локальная подготовка должна работать так:

```bash
nvm use
node --version
npm ci
npm test
```

`node --version` должен показывать `v24.x.x`.

### 3. Перевести CI на Node.js 24

В `.github/workflows/test.yml`:

- заменить matrix Node.js 22 на Node.js 24;
- заменить `actions/setup-node@v3` на `actions/setup-node@v4`;
- сохранить Redis service;
- сохранить `npm ci`;
- сохранить `npm test`;
- не добавлять отдельные Node.js 22 jobs.

CI должен проверять ту же major-версию, которая используется локально и в production container.

### 4. Перевести Docker image на Node.js 24

В `Dockerfile` заменить base image:

```dockerfile
FROM node:22-alpine
```

на:

```dockerfile
FROM node:24-alpine
```

Сохранить production-only установку зависимостей и текущий startup contract.

Не менять порт, working directory или команду запуска.

Если используемый npm сообщает deprecation для `--only=production`, разрешено заменить только этот флаг на актуальный эквивалент:

```bash
npm ci --omit=dev
```

### 5. Зафиксировать dependency baseline

Перед изменением lockfile выполнить:

```bash
npm audit --json
npm audit --omit=dev --json
```

Не коммитить audit JSON или terminal logs.

Определить для каждого high/critical advisory:

- affected package;
- direct или transitive dependency;
- production или development dependency;
- доступную patched version;
- требуется ли major update;
- какой direct dependency приводит уязвимый пакет.

### 6. Обновить зависимости минимально

Разрешены:

- обновления direct dependencies в `package.json`;
- обновления transitive dependencies в `package-lock.json`;
- `npm update`;
- targeted `npm install <package>@<version>`;
- обычный `npm audit fix` без `--force`;
- узкий `overrides`, только если fixed transitive version совместима и не может быть получена обновлением direct dependency.

Запрещены:

```bash
npm audit fix --force
```

и любые неконтролируемые major upgrades.

Major update direct dependency допустим только если одновременно:

- он необходим для устранения high/critical advisory;
- не требует изменения файлов `application/**`;
- Impress public/runtime contracts не меняются;
- `npm test` полностью проходит;
- итоговый dependency tree не содержит peer dependency conflicts.

Если vulnerability нельзя устранить без изменения application-кода или контракта framework, задача должна завершиться ошибкой и не перемещаться в `done`.

### 7. Требуемый audit результат

После обновления обязательно должны проходить:

```bash
npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
```

Итог должен содержать:

```text
0 high severity vulnerabilities
0 critical severity vulnerabilities
```

Нельзя считать задачу выполненной, если high/critical vulnerabilities остались только потому, что они находятся в devDependencies.

Low и moderate advisories допустимы только при отсутствии безопасного compatible update и должны быть перечислены в PR body с названием пакета и причиной.

### 8. Сохранить application behavior

Не менять:

- TradeStation OAuth lifecycle;
- brokerage recovery;
- orders/positions streams;
- option capacity queue;
- invalid-symbol classifier;
- API procedures;
- symbol helpers;
- domain/lib boundaries;
- application tests.

Это runtime/toolchain follow-up, а не production behavior change.

## Критерии готовности

- `.nvmrc` содержит Node.js 24.
- `package.json` разрешает Node.js 24 и не разрешает Node.js 22.
- `package-lock.json` синхронизирован с `package.json`.
- `npm ci` на Node.js 24 не показывает `EBADENGINE`.
- CI использует Node.js 24.
- CI использует `actions/setup-node@v4`.
- Docker image основан на `node:24-alpine`.
- Production install не устанавливает devDependencies.
- `npm test` проходит на Node.js 24.
- Количество успешно прошедших существующих тестов не уменьшилось.
- `npm audit --audit-level=high` проходит.
- `npm audit --omit=dev --audit-level=high` проходит.
- High и critical vulnerabilities отсутствуют.
- `npm audit fix --force` не использовался.
- Нет peer dependency conflicts.
- Нет изменений в `application/**`, `config/**`, `types/**` или tests.
- Generated audit reports, logs, coverage и `node_modules` не закоммичены.
- Изменено не более пяти разрешённых файлов.
- PR body обновлён до T-064.

## Локальная проверка

```bash
nvm use
node --version
npm ci
npm test
npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
```

Ожидается:

```text
Node.js v24.x.x
53 test(s) passed
0 high severity vulnerabilities
0 critical severity vulnerabilities
```

Дополнительно:

```bash
docker build -t ts-connect:node24 .
docker run --rm ts-connect:node24 node --version
```

Ожидается Node.js `v24.x.x`.

## PR body

<!-- ai-pr-body:start -->

# Цель

Повысить устойчивость TradeStation integration и согласовать production runtime с Node.js 24.

## Реализованные изменения

- T-056–T-058: brokerage orders lifecycle, delivery state, hydration, reconciliation и authorization recovery.
- T-059–T-060: общая managed FIFO capacity queue для option chains и matrix.
- T-061–T-062: OAuth single-flight, безопасные HTTP metadata и production invalid-symbol classification.
- T-063: восстановление unhealthy brokerage streams после успешного lifetime OAuth refresh без второго OAuth request.
- T-064: Node.js 24 зафиксирован для local development, CI и Docker; dependency tree обновлён и проверен npm audit.

## Runtime baseline

Поддерживаемая runtime-версия:

```text
Node.js >=24 <25
```

Локальная версия задаётся через `.nvmrc`.

GitHub Actions и production Docker image используют Node.js 24.

## Dependency security

- `npm ci` выполняется без `EBADENGINE`.
- `npm audit --audit-level=high` проходит.
- `npm audit --omit=dev --audit-level=high` проходит.
- High и critical vulnerabilities отсутствуют.
- `npm audit fix --force` не использовался.
- Application-код не изменялся в T-064.

## Validation

```bash
node --version
npm ci
npm test
npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
```

Existing test suite должен завершиться успешно на Node.js 24.

## Пользовательская приёмка

Status: pending.

Необходимы staging-проверки OAuth recovery, brokerage streams, option capacity и invalid-symbol contract.

## Task history

- T-056 — brokerage order stream recovery.
- T-058 — delivery, hydration и authorization recovery.
- T-059 — option-chain managed capacity queue.
- T-060 — capacity queue continuation.
- T-061 — OAuth refresh и invalid-symbol contract.
- T-062 — production invalid-symbol classifier.
- T-063 — brokerage recovery после lifetime refresh.
- T-064 — Node.js 24 и dependency security refresh.
<!-- ai-pr-body:end -->
