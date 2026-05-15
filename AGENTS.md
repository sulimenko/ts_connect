# ts_connect

Локальные правила `ts_connect`. Общий процесс, роли, `T-NNN`, tests, review и
архивирование заданы в `/Users/alexey/.codex/AGENTS.md`.

## Документация

- `doc/blueprint.md` — архитектурные правила, слои, контракт процедур, stream lifecycle.
- `doc/task.md` — активные задачи.
- `doc/review.md` — review-checklist.
- `doc/openapi_20260411.md` — компактный индекс и дополнение по snapshot TradeStation OpenAPI от 2026-04-11.
- `doc/changelog.md` — архив закрытых задач и заключений.

## Слои

- `api/` — контракт, access, orchestration; не хранит state, не делает reconnect.
- `domain/` — server-side state, lifecycle, registries, cleanup.
- `lib/` — transport, protocol, parsing внешних систем: TradeStation HTTP/stream, ptfin.
- `config/` — только `process.env` -> конфиг; без бизнес-логики.

## TradeStation

- OAuth lifecycle: `lib.ts.refresh` -> `access_token` + `expires`; auto-refresh за 2 минуты до expiry.
- Stream lifecycle: subscribe -> touch -> unsubscribe; idle cleanup; `client.close` cleanup.
- `domain.ts.clients` — single-flight setup через `connecting[name]` + `waiters[name]`.
- `domain.ts.streams` — multiplex подписчиков, stable `streamKey`.
- `lib.ts.stream` — upstream HTTP stream с reconnect, heartbeat, JSON line parser.
- Defensive guards на shape ответов TradeStation обязательны.

## Impress

- Файлы экспортируют единственную функцию или объект: `({...}) => { ... }` или `({ ... })`.
- Глобальные пространства: `lib.*`, `domain.*`, `config.*`, `application.*`.
- Нельзя делать import-time side effects в файлах, которые загружает общий aggregator.
- Один файл = одна функция в `lib/`: каждый `.js` файл в `application/lib/name/` экспортирует одну функцию и вызывается как `lib.name.fileName(...)`.
- Не помещать несколько функций в один `lib/` файл через object export.
- `domain` файлы экспортируют объект `({...})` с методами и state как registry/singleton.
- Методы `domain` используют `this.*` для доступа к state объекта.

## Ошибки

- `DomainError` — для предсказуемых бизнес-ошибок.
- `Error` — для багов и transport failures.
