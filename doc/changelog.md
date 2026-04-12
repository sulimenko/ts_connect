# Changelog

Архив завершённых блоков, review-заключений и закрытых задач.
Загружается вручную — не входит в автоматический контекст.

---

## Задачи

| ID    | Название                                                               | Статус | Дата       | Итог                                                                                                                                  |
| ----- | ---------------------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| T-001 | Убрать обрезку ведущих нулей в `makeTSSymbol`                          | [x]    | 2026-04-12 | OPT symbol date сохраняет полный YYMMDD, например `CRWV281201C80000` → `CRWV 281201C80`.                                              |
| T-002 | Не reconnect-ить на перманентные ошибки в stream                       | [x]    | 2026-04-12 | `FAILED, INVALID SYMBOL` классифицируется как permanent и останавливает stream без reconnect-цикла.                                   |
| T-003 | Нормализация TS error packet в `onError` и `serializeError`            | [x]    | 2026-04-12 | TS-пакеты `{ Error, Symbol }` сериализуются читаемо, без `[object Object]`.                                                           |
| T-004 | Закрепить metaterminal-owned lifecycle для `stream/quotes`             | [x]    | 2026-04-12 | `ts_connect` хранит подписки на уровне `client + kind + streamKey`, а ownership/ref-count остается в `metaterminal`.                  |
| T-005 | Добавить stop reason diagnostics для managed streams                   | [x]    | 2026-04-12 | Логи stop различают `idle`, `unsubscribe`, `clear`, `client.close`, `permanent-error` и `unknown`.                                    |
| T-006 | Поддержать OPT snapshot quotes через `marketdata/quotes`               | [x]    | 2026-04-12 | Endpoint переведен на instruments-only контракт и нормализует internal OPT/STK symbols в TS format.                                   |
| T-007 | Дедуплицировать повторные `marketdata/barcharts` snapshot-запросы      | [x]    | 2026-04-12 | Добавлены in-flight single-flight и короткий Redis TTL cache для snapshot barcharts.                                                  |
| T-008 | Добавить `errors` block и `DomainError` в `marketdata/quotes`          | [x]    | 2026-04-12 | Пустой instruments-only вход возвращает `DomainError('EINSTRUMENTS')`, а не generic 500.                                              |
| T-009 | Исправить ложный `logStop` при unsubscribe с оставшимися подписчиками  | [x]    | 2026-04-12 | Removal одного подписчика логируется отдельно и больше не выглядит как остановка stream.                                              |
| T-010 | Добавить диагностические логи для контрольного запуска                 | [x]    | 2026-04-12 | Добавлены targeted логи для symbol conversion, stream error classification, subscribe lifecycle, cache hit/miss и serialize fallback. |
| T-011 | Синхронизировать нормализацию `period` для snapshot и stream barcharts | [x]    | 2026-04-12 | Snapshot и stream barcharts используют общий `normalizeBarPeriod`; unsupported periods возвращают `DomainError('EPERIOD')`.           |
| T-012 | Закрыть текущие full-lint errors без изменения бизнес-логики           | [x]    | 2026-04-12 | Full repository lint debt закрыт mechanical fixes; `npm run lint` стал merge gate.                                                    |

---

## Review-заключения

| Дата       | Блок                                                                    | Статус              | Итог                                                                                                                                                   |
| ---------- | ----------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-04-11 | Блок 1 — OPT symbol format + stream error handling                      | passed with notes   | `makeTSSymbol`, permanent stream errors и `serializeError` закрыли исходные `INVALID SYMBOL`/`[object Object]` дефекты; оставался unrelated lint debt. |
| 2026-04-11 | Блок 2 — metaterminal-owned stream lifecycle + snapshots                | passed with notes   | Stream lifecycle закреплен за `metaterminal`, snapshot quotes стали instruments-only, barcharts получил single-flight + Redis TTL cache.               |
| 2026-04-11 | Review Блоков 1–2 — итоговая проверка architect                         | passed with issues  | Найдены follow-up задачи T-008 и T-009 по `DomainError('EINSTRUMENTS')` и ложному `logStop`.                                                           |
| 2026-04-11 | Блок 3 — review fixes — quotes contract + misleading log                | passed              | `marketdata/quotes` возвращает `DomainError('EINSTRUMENTS')`, а `streams.js` различает removal подписчика и реальный stop.                             |
| 2026-04-12 | Текущая проверка architect — domain barcharts + open tasks              | active tasks remain | Подтверждена необходимость `application/domain/ts/barcharts.js`; добавлены T-010, T-011 и T-012 перед финальным закрытием.                             |
| 2026-04-12 | Блок 4 — Диагностическое логирование для контрольного запуска           | passed              | Диагностические логи добавлены без изменения public response/event shape.                                                                              |
| 2026-04-12 | Блок 5 — Barcharts period contract before control run                   | passed              | `normalizeBarPeriod` устранил silent fallback для unsupported `period` в snapshot и stream barcharts.                                                  |
| 2026-04-12 | Блок 6 — Repository lint debt                                           | passed              | Mechanical lint fixes закрыли full-lint debt без изменения бизнес-логики endpoint-ов.                                                                  |
| 2026-04-12 | Финальный review после Блоков 4–6 — corrected instruments-only contract | passed              | Текущий цикл закрыт; `marketdata/quotes` остается instruments-only, legacy `symbols` не поддерживается по уточненному контракту с `metaterminal`.      |
