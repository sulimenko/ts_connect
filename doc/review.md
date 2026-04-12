# Review

## Назначение документа

Этот документ задает постоянный review-checklist для `ts_connect`. Его задача: проверять качество изменений до merge или деплоя, а не пересказывать историю конкретной задачи.

При review нужно исходить из того, что `ts_connect` опирается на Metarhia/Impress как на реальный механизм исполнения RPC-контрактов. Поэтому review проверяет не только "работает ли метод", но и "остался ли он внутри архитектурной модели проекта": контракт процедуры, границы слоев, stream lifecycle и явные ограничения интеграции с TradeStation.

Review обязателен после любого task. После review нужно синхронно обновить все файлы `doc/*`, чтобы новое правило, найденный риск или новый reference example не оставались только в коде.

## Что считаем архитектурной опорой проекта

- контракт процедуры Impress: `access`, `parameters`, `returns`, `errors`, `validate`;
- разделение ответственности между `application/api`, `application/domain` и `application/lib`;
- server-side lifecycle stream-подписок и cleanup;
- документированные ограничения и совместимость публичного API.

## 1. Проверка контракта Metarhia-процедуры

- у публичного метода явно определен `access`;
- `parameters` описывает реальную форму входа, а не только happy path;
- `returns` описывает фактический shape ответа;
- доменные коды ошибок перечислены в `errors`, если метод использует `DomainError`;
- `validate` используется только для правил, которые нельзя адекватно выразить схемой;
- метод не смешивает нормализацию, transport code и domain policy без необходимости.

Признаки проблем:

- метод бросает `Error` там, где клиент ожидает стабильный код ошибки;
- метод возвращает `DomainError`, но `errors` не содержит его code;
- shape ответа может расходиться с `returns`;
- параметры принимаются "как есть", хотя реально ожидается нормализация строк в boolean/number.
- новая строгая проверка ломает legacy falsey/string входы, которые раньше осознанно принимались методом.
- новые локальные переменные названы тяжело, многословно, не в `camelCase` или их именование зависит от субъективного "веса" сущности.
- неподдержанный interval, mode или format тихо переводится в дефолт вместо явного domain error.
- одинаковая нормализация action-like полей скопирована по нескольким endpoint-ам вместо общего helper-а.

## 2. Проверка `DomainError` и `.d.ts`

- доменные ошибки используются только для предсказуемых ограничений контракта;
- внутренние дефекты, поломки интеграции и unexpected cases не маскируются под `DomainError`;
- если рядом есть `.d.ts`, коды ошибок синхронизированы с `errors` в `.js`;
- если `.d.ts` отсутствует у публичного метода со стабильными доменными кодами ошибок, это должно быть осознанное решение.

Нужно помнить:

- `.d.ts` дает compile-time namespace-контракт и IDE-типизацию;
- `.d.ts` не валидирует runtime;
- сервис сейчас не генерирует такие файлы автоматически.

## 3. Проверка stream lifecycle

- API-слой не хранит stream registry вручную;
- upstream stream lifecycle отделен от downstream subscriptions;
- есть стабильный `streamKey`;
- `subscribe`, `touch`, `unsubscribe` реализованы последовательно;
- `client.close` очищает подписки;
- idle timeout очищает подписки;
- ручной `stop` не приводит к повторному reconnect без новой команды клиента.

Признаки проблем:

- stream restart происходит после осознанного stop;
- ключ подписки зависит от неполного набора параметров;
- повторный subscribe плодит лишние upstream stream-ы;
- после unsubscribe subscription исчезает, но upstream stream остается висеть без подписчиков.
- managed stream stop logs должны отличать `idle`, `unsubscribe`, `clear`, `client.close` и `permanent-error`, чтобы эксплуатация не теряла причину остановки.
- если операция может быть корректно отклонена на уровне контракта, она должна возвращать `DomainError` с явным `errors` block, а не generic `Error`.

## 4. Проверка совместимости публичного API

- старые параметры не удалены без миграции;
- альтернативы для обратной совместимости задокументированы явно;
- ограничения новых режимов выражены явно, а не оставлены неявным behavior;
- клиенты могут понять, как отличить unsupported mode от внутренней аварии.

Особенно внимательно проверять:

- deprecated-флаги и совместимость старых имен параметров;
- fallback-поведение на старые сценарии клиента;
- стабильность event payload у stream endpoint-ов.

## 5. Проверка ответов TradeStation

- код не доверяет shape внешнего ответа без defensive guards;
- массивы и поля ошибок проверяются до чтения `.length`, индексации и доступа к вложенным полям;
- parser-ы устойчивы к неполным numeric fields, нестандартным symbol format и неожиданным timestamp;
- ошибки transport/read/parse отделены от доменных ошибок сервиса.
- snapshot quote endpoints принимают instruments-only контракт, если это зафиксировано для клиента; перед upstream вызовом internal instruments всегда нормализуются в TS symbol format.
- stream errors нормализуются из `{ Error, Message }` и `{ Symbol, Error }`, а не через `String(object)`;
- `INVALID SYMBOL` не должен запускать бесконечный reconnect к тому же upstream symbol;
- `GoAway` и `StreamStatus: 'GoAway'` остаются транзиентными stream-событиями, для которых reconnect ожидаем.

Постоянные зоны риска для проекта:

- части `account/*` и `orderexecution/*`, где легко предположить shape ответа без guard-ов;
- option chain parser и snapshot collection;
- market data stream-ы с частично реализованным lifecycle.

## 6. Проверка диагностики и эксплуатации

- изменение оставляет способ увидеть текущее server-side состояние;
- при необходимости обновлены info/introspection методы;
- есть ручной сценарий smoke-проверки до деплоя;
- ограничения сервиса отражены в документации, а не только в коде.

Минимум для stream-изменения:

1. `subscribe` поднимает или reuse-ит upstream stream.
2. События приходят в нужный event channel.
3. `touch` продлевает жизнь подписки.
4. `unsubscribe` очищает downstream subscription.
5. После последнего unsubscribe upstream stream остановлен.
6. `client.close` и idle timeout не оставляют висящих подписок.

## 7. Постоянные review-вопросы для `ts_connect`

- Не обещает ли код поддержку того, что сервис реально не умеет?
- Не утекает ли server-side state в `application/api/*`?
- Не скрыта ли важная часть контракта только в комментарии или тексте ошибки?
- Можно ли по коду и документации понять, где domain error, а где internal failure?
- Сможет ли следующий инженер обновить этот endpoint без чтения всей истории проекта?
- Обновлены ли после review все файлы `doc/*`, а не только локально затронутый документ?

Если хотя бы на один из этих вопросов ответ "нет", изменение требует доработки до merge.

---

## Заключения по блокам

### Заключение: Блок 1 — OPT symbol format + stream error handling

passed with notes

Проверка по блоку показала, что:

- `makeTSSymbol` больше не обрезает ведущие нули в дате опциона;
- `handlePacket` перестал уходить в бесконечный reconnect на перманентные `INVALID`-ошибки;
- `serializeError` и `quotes.onError` теперь сохраняют читаемое сообщение TradeStation вместо `[object Object]`.

Проверка инструментами:

- `npm run types` проходит;
- `eslint` для изменённых файлов проходит;
- полный `npm run lint` в репозитории не проходит из-за существующего старого lint-debt в других файлах, не затронутых этим блоком.

Вывод: блок можно считать закрытым по целям, но в репозитории остаются отдельные unrelated lint issues, которые надо разбирать отдельным блоком.

### Заключение: Блок 2 — metaterminal-owned stream lifecycle + snapshots

passed with notes

Проверка по блоку показала, что:

- `stream/quotes` явно документирует ownership на уровне `client + kind + streamKey` без добавления ref-count внутри `ts_connect`;
- managed streams теперь логируют причину остановки для `idle`, `unsubscribe`, `clear`, `client.close` и `permanent-error`;
- `marketdata/quotes` нормализует instruments-only вход, а `marketdata/barcharts` принимает singular `instrument` и использует local single-flight с коротким Redis TTL cache.

Проверка инструментами:

- `npm run types` проходит;
- `eslint` и `prettier` для изменённых файлов проходят.

Вывод: блок закрыт по целям, новые правила закреплены в checklist для будущих review.

Дополнительная проверка `log/2026-04-11-W1.log`:

- после фикса OPT symbols выглядят корректно, `INVALID SYMBOL` reconnect в логе не повторяется;
- несколько quote streams остаются активными параллельно до idle cleanup на 2 минуты, если клиент не делает явный `unsubscribe` или `stream/clear`;
- `Stream stopped gracefully` в этом логе соответствует остановке upstream stream после abort при cleanup, а не новой upstream-ошибке;
- управляющий lifecycle принадлежит `metaterminal`, поэтому `ts_connect` не должен автоматически закрывать старые quote streams при новом subscribe; `metaterminal` должен слать `touch`, `unsubscribe` или `stream/clear`;
- `marketdata/barcharts` snapshot-запросы местами занимали 3-6s и повторялись по одинаковым ключам; это закрыто single-flight + Redis TTL cache для snapshot barcharts.

### Заключение: Review Блоков 1–2 — итоговая проверка architect

**Статус**: passed with issues → Блок 3

**Дата**: 2026-04-11

**Проверенные файлы**:

- `application/lib/utils.js` — T-001
- `application/lib/ts/stream.js` — T-002, T-005
- `application/domain/ts/streams.js` — T-003, T-004, T-005
- `application/api/stream/quotes.js` — T-003, T-004
- `application/api/marketdata/quotes.js` — T-006
- `application/api/marketdata/barcharts.js` — T-007
- `application/domain/ts/barcharts.js` — T-007 (new file)
- `doc/blueprint.md`, `doc/review.md`, `doc/openapi_20260411.md`

**Результат**:

- `makeTSSymbol` сохраняет полный YYMMDD. ✅
- `handlePacket` разделяет permanent/transient ошибки. ✅
- `serializeError` обрабатывает `{ Error, Symbol }` TS-пакеты. ✅
- `stream/quotes` документирует metaterminal-owned lifecycle. ✅
- `streams.js` логирует reason при stop через всю цепочку. ✅
- `quotes.js` принимает instruments-only вход с batch по 100. ✅
- `barcharts.js` — полный контракт, single-flight + Redis TTL cache. ✅
- `domain/ts/barcharts.js` обоснованно размещён в domain (in-memory state + cache policy). ✅
- `doc/*` обновлены: blueprint (OpenAPI ref, doc rules), review (checklist additions), openapi index. ✅

**Найденные проблемы** → Блок 3:

1. ❌ `marketdata/quotes.js:23`: `throw Error('Symbols are required')` — должно быть `DomainError('EINSTRUMENTS')` с `errors` block → **T-008**
2. ❌ `streams.js:136`: `logStop()` вызывается при `unsubscribe` когда подписчики остаются — ложное сообщение `Managed stream stop:` → **T-009**

### Заключение: Блок 3 — review fixes — quotes contract + misleading log

passed

Проверка по блоку показала, что:

- `marketdata/quotes` теперь возвращает `DomainError('EINSTRUMENTS')` и документирует его в `errors`;
- `streams.js` различает реальный stop и removal одного подписчика, поэтому лог `Managed stream stop:` больше не появляется при `unsubscribe` с оставшимися подписчиками;
- эксплуатационный лог стал точнее, без ложного сигнала о полной остановке stream.

Проверка инструментами:

- `npm run types` проходит;
- `eslint` и `prettier` для изменённых файлов проходят.

**Перекрёстная проверка с metaterminal task.md**:

- T-018 (metaterminal): нормализация ошибки stream/quotes → покрыта T-003 (serializeError + onError). ✅
- T-019 (metaterminal): streamKey lifecycle contract → покрыта T-004 (ownership comments, no replace, idle cleanup). ✅

Задачи по итогам: Блок 4 (T-010) — диагностическое логирование для контрольного запуска.

### Заключение: Текущая проверка architect — domain barcharts + open tasks

**Статус**: active tasks remain

**Дата**: 2026-04-12

Проверка по текущему состоянию показала, что `application/domain/ts/barcharts.js` нужен и расположен корректно:

- `api/marketdata/barcharts.js` должен оставаться слоем контракта и orchestration, без server-side state;
- `domain.ts.barcharts` держит in-flight `pending` Map для single-flight, то есть состояние между RPC-вызовами;
- `domain.ts.barcharts` держит Redis TTL cache policy для snapshot barcharts, что также является server-side lifecycle/cache policy;
- перенос этого helper-а в `lib` был бы неправильным, потому что `lib` в проекте отвечает за transport/parser, а не за cache policy;
- перенос обратно в `api` нарушил бы правило `CLAUDE.md`: `api/` не хранит state.

Проверка инструментами:

- `npm run types` проходит;
- targeted eslint для изменённых JS-файлов проходит;
- prettier-check для изменённых JS и `doc/*` проходит после форматирования `doc/task.md`.

Найденные задачи:

- T-010 остаётся открытой задачей на диагностические логи для контрольного запуска;
- T-011 добавлена как обязательная задача перед контрольным запуском: синхронизировать `period -> interval/unit` для snapshot и stream barcharts, чтобы unsupported `period` возвращал `DomainError('EPERIOD')`, а не молча уходил в некорректный TradeStation request.
- T-012 добавлена как отдельная задача на unrelated repository lint debt: полный `npm run lint` сейчас падает на 46 старых eslint errors вне текущего `barcharts/streams` изменения.

Вывод: финальный review проекта пока не закрывается, потому что есть активные задачи T-010, T-011 и T-012.

### Заключение: Блок 4 — Диагностическое логирование для контрольного запуска

passed

Проверка по блоку показала, что:

- `makeTSSymbol` логирует исходный symbol, TS symbol, дату и длину даты, что позволяет сразу увидеть расхождение формата;
- `handlePacket` явно классифицирует error packets на `PERMANENT -> stop` и `TRANSIENT -> reconnect`;
- `streams.js` логирует subscribe lifecycle с `created`, `subscribed`, `total` и `idleMs`;
- `barcharts.js` логирует `cache HIT`, `cache MISS` и `single-flight REUSE`;
- `serializeError` предупреждает, если попал в fallback без распознанного shape.

Проверка инструментами:

- `npm run lint` проходит;
- `npm run types` проходит.

### Заключение: Блок 5 — Barcharts period contract before control run

passed

Проверка по блоку показала, что:

- `normalizeBarPeriod` стал общим helper-ом для snapshot и stream barcharts;
- `marketdata/barcharts` и `stream/addBarchart` используют одинаковую нормализацию периода;
- unsupported periods больше не превращаются в silent fallback, а возвращают `DomainError('EPERIOD')`.

Проверка инструментами:

- `npm run lint` проходит;
- `npm run types` проходит.

### Заключение: Блок 6 — Repository lint debt

passed

Проверка по блоку показала, что:

- текущий repository lint debt закрыт без изменения бизнес-логики endpoint-ов;
- mechanical fixes в перечисленных файлах не изменили public contract или response shape;
- полный `npm run lint` теперь проходит.

Проверка инструментами:

- `npm run lint` проходит;
- `npm run types` проходит.

### Заключение: Финальный review после Блоков 4–6 — corrected instruments-only contract

passed

Проверка по staged diff показала, что:

- `npm run lint` проходит;
- `npm run types` проходит;
- `marketdata/barcharts` больше не делает silent fallback для unsupported `period` и использует общий `normalizeBarPeriod`;
- `domain.ts.barcharts` оставлен в domain корректно: там живут in-flight single-flight state и Redis TTL cache policy;
- `marketdata/quotes` соответствует уточнённому контракту: вход только `instruments`, без legacy `symbols`, ошибка пустого входа `DomainError('EINSTRUMENTS')`;
- full-lint debt закрыт mechanical fixes;
- предыдущий finding о необходимости вернуть `symbols` признан ошибочным, потому что управляющий клиент `metaterminal` всегда присылает `instruments`.

Вывод: блоки можно считать закрытыми; новых задач по текущему review нет.
