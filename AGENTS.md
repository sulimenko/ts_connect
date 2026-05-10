# ts_connect

Metarhia/Impress сервис — connector к TradeStation API. Документация в `doc/`:

- `doc/blueprint.md` — архитектурные правила, слои, контракт процедур, stream lifecycle
- `doc/task.md` — активные задачи (блоки для worker)
- `doc/review.md` — постоянный review-checklist (разделы 1–7)
- `doc/openapi_20260411.md` — компактный индекс и дополнение по snapshot TradeStation OpenAPI от 2026-04-11
- `doc/changelog.md` — архив закрытых задач и заключений (не загружается автоматически)

---

## Роли

**Architect — этот чат (senior-модель: claude-sonnet/opus max, GPT-4o/o3 high reasoning)**

- пишет и обновляет `doc/*`
- формирует блоки задач в `task.md`
- после анализа проблемы — сразу формирует блок задач без отдельного подтверждения
- проводит review после каждого блока
- **не пишет код, не выполняет задачи**

**Worker — более простая модель (claude-haiku medium, GPT-4o-mini medium)**

- получает блок задач из `task.md`
- выполняет код строго по описанию
- не добавляет задачи, не меняет блок
- не создаёт и не расширяет тесты по собственной инициативе; новые тесты даются только отдельным блоком architect после принятия рабочего блока
- при выполнении обычных задач ориентируется на уже существующие тесты и smoke-проверки проекта, но не считает создание нового test coverage частью блока без явного `T-NNN`
- сигнализирует завершение → architect проводит review

---

## Правила task.md

- Задачи группируются в **блоки**: один блок = одна итерация worker → review
- ID: `T-NNN`, сквозная нумерация, никогда не сбрасывается
- Статусы: `[ ]` не начато / `[~]` в работе / `[x]` завершено / `[!]` заблокировано
- Каждая задача описана подробно: файлы, поведение до/после, ограничения, критерии
- После review — заключение в `review.md`; проблемы из review → новые T-NNN в следующем блоке

**Архивирование** (`doc/changelog.md`):

- > 30 задач `[x]`/`[!]` в файле, или файл >400 строк, или крупный цикл завершён
- Переносятся все `[x]`/`[!]` старше последнего завершённого блока
- Архивная строка: `T-NNN | название | [x] | дата | краткий итог` — одна строка, без кода
- В `task.md` остаются только `[ ]`, `[~]` и правила

---

## Правила review

- Review проводится после каждого блока задач по checklist `doc/review.md` разделы 1–7
- Заключение добавляется в конец раздела «Заключения по блокам» в `review.md`
- Формат: `### Заключение: Блок N — название`, затем статус (passed / passed with notes / failed), проблемы, задачи
- При архивировании — соответствующие заключения переносятся в `changelog.md`

---

## Порядок закрытия блока

1. Worker выполняет задачи → сигнализирует завершение
2. Architect читает изменённые файлы
3. Проверяет по checklist `doc/review.md`
4. Пишет заключение в `review.md`
5. При `passed`: при необходимости создаёт отдельный test-block для worker и обновляет `doc/*`, если появились новые устойчивые правила
6. При `failed`: создаёт новый блок с задачами на исправление

---

## Ключевые архитектурные правила

Детали в `doc/blueprint.md`. Обязательный минимум:

**Слои:**

- `api/` — контракт, access, orchestration; не хранит state, не делает reconnect
- `domain/` — server-side state, lifecycle, registries, cleanup
- `lib/` — transport, protocol, parsing внешних систем (TradeStation HTTP/stream, ptfin)
- `config/` — только `process.env` → конфиг; без бизнес-логики

**TradeStation интеграция:**

- OAuth lifecycle: `lib.ts.refresh` → access_token + expires; auto-refresh 2min до expiry
- Stream lifecycle: subscribe → touch → unsubscribe; idle cleanup; `client.close` cleanup
- `domain.ts.clients` — single-flight setup: `connecting[name]` + `waiters[name]`
- `domain.ts.streams` — multiplex подписчиков, stable `streamKey`
- `lib.ts.stream` — upstream HTTP stream с reconnect, heartbeat, JSON line parser
- Defensive guards на shape ответов TradeStation обязательны

**Impress-специфика:**

- Файлы экспортируют единственную функцию или объект: `({...}) => { ... }` или `({ ... })`
- Глобальные пространства: `lib.*`, `domain.*`, `config.*`, `application.*`
- Нельзя делать import-time side effects в файлах, которые загружает общий aggregator

**Общее:**

- Имена: 1 слово лучше 2, 2 лучше 3 — только если короткое теряет смысл
- После любого значимого изменения: обновить `doc/*`
- `DomainError` — для предсказуемых бизнес-ошибок; `Error` — для багов и transport failures
