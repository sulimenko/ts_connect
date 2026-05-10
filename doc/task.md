# Task

## Правила ведения документа

### Структура и нумерация

- Каждая задача получает ID: `T-NNN` (три цифры, сквозная нумерация без сброса)
- Задачи группируются в **блоки** — логически завершённые наборы изменений
- Один блок = одна единица работы worker-а, после которой проводится review
- После review заключение записывается в `doc/review.md`
- Задачи на исправление ошибок из review получают новые T-NNN и входят в следующий блок

### Статусы задач

- `[ ]` — не начато
- `[~]` — в работе
- `[x]` — завершено
- `[!]` — заблокировано

### Правила блока для worker

- Worker получает весь блок сразу и выполняет задачи последовательно
- Задачи внутри блока описаны подробно: файлы, поведение до, поведение после, ограничения
- Worker не может сам добавлять задачи или менять блок — только выполняет описанное
- После выполнения блока worker сигнализирует завершение — architect проводит review

### Архивирование

**Когда архивировать**: при выполнении любого из условий:

- В документе накопилось >30 задач со статусом `[x]` или `[!]`
- Завершён крупный цикл (major version, переход к новой интеграции, смена архитектурного контракта)
- Файл превысил 400 строк

**Что переносится в архив** (`doc/changelog.md`):

- Все задачи `[x]` и `[!]` из завершённого цикла
- Соответствующие review-заключения по закрытым блокам
- Формат архивной строки: `T-NNN | title | [x] | дата | краткий итог`

**Что остаётся в task.md**:

- Все задачи `[ ]` и `[~]`
- Текущий активный блок целиком
- Правила ведения документа

**Правило архивной строки**: одна строка на задачу, без кода, без деталей реализации. Только факт и результат.

---

## Активные задачи

## Блок 7: Stop reason propagation for managed streams

**Цель блока**: устранить диагностический дефект, найденный по `log/2026-04-13-W1.log`: domain-уровень видит корректную причину остановки stream-а, но низкоуровневый `lib.ts.stream` логирует `reason: unknown`.

**Контекст**: свежий запуск `ts_connect` от 2026-04-13 отработал штатно и завершился через `SIGINT`. При закрытии managed quote streams лог показывает:

```text
Managed stream stop: quotes:CRWV 280121P60 reason=client.close subscribers=0
Stopping stream... marketdata/stream/quotes/CRWV 280121P60 reason: unknown
```

Причина: `application/domain/ts/streams.js` уже вызывает `entry.upstream.stop({ reason })`, но wrappers в `stream/quotes`, `stream/addBarchart`, `stream/matrix` и `lib/stream/optionChain` игнорируют аргумент `reason`, а `application/domain/ts/client.js::stopStoredStream` вызывает `stream.stopStream()` без передачи причины.

**Файлы блока**:

- `application/domain/ts/client.js`
- `application/api/stream/quotes.js`
- `application/api/stream/addBarchart.js`
- `application/api/stream/matrix.js`
- `application/lib/stream/optionChain.js`

**Порядок выполнения**: T-013.

**После блока**: review architect.

---

### T-013: Прокинуть `reason` до `lib.ts.stream.stopStream`

**Статус**: `[x]`

**Поведение до**:

- `domain.ts.streams.stopEntry({ reason: 'client.close' })` логирует корректную причину на managed level.
- Затем вызывает `entry.upstream.stop({ reason })`.
- Upstream wrapper объявлен как `stop: async () => ...` и не принимает аргумент.
- `tsClient.stopStoredStream({ group, key })` вызывает `stream.stopStream()` без reason.
- В результате `lib.ts.stream.abortActiveStream` логирует `reason: unknown`.

**Поведение после**:

- `application/domain/ts/client.js::stopStoredStream` должен принимать `reason = 'unknown'`:

```js
async stopStoredStream({ group, key, reason = 'unknown' }) {
  // ...
  await stream.stopStream(reason);
}
```

- Managed stream wrappers должны принимать объект с причиной и прокидывать её дальше:

```js
stop: async ({ reason = 'unknown' } = {}) => {
  await tsClient.stopStoredStream({ group: 'quotes', key: registeredKey, reason });
},
```

- Обновить все wrappers, найденные в текущем коде:
  - `application/api/stream/quotes.js` — group `quotes`;
  - `application/api/stream/addBarchart.js` — group `charts`;
  - `application/api/stream/matrix.js` — group `matrix`;
  - `application/lib/stream/optionChain.js` — group `chains`.

**Ограничения**:

- Не менять public API контракт stream endpoint-ов.
- Не менять `domain.ts.streams.stopEntry` и его current call `entry.upstream.stop({ reason })`, если worker не найдёт фактическую несовместимость.
- Не менять reconnect policy, idle timeout, streamKey generation, event payload и response shape.
- Сохранить backward compatibility для прямых вызовов `stopStoredStream({ group, key })`: без reason должен оставаться fallback `unknown`.
- Не трогать старые direct stops в `application/domain/ts/clients.js`, если они не входят в managed `domain.ts.streams` lifecycle.

**Критерии завершения**:

- При `client.close` в логе обе строки содержат одну причину:

```text
Managed stream stop: quotes:CRWV 280121P60 reason=client.close subscribers=0
Stopping stream... marketdata/stream/quotes/CRWV 280121P60 reason: client.close
```

- При `idle`, `unsubscribe`, `clear` и `permanent-error` причина также доходит до `Stopping stream... reason: <reason>`.
- `rg -n "stop: async \\(\\) =>|stopStoredStream\\(\\{ group: .* key: registeredKey \\}\\)" application/api/stream application/lib/stream application/domain/ts/client.js` не находит старый wrapper pattern для managed streams.
- `npm run lint` проходит.
- `npm run types` проходит.

---

## Блок 8: Chart latency diagnostics

**Цель блока**: добавить точные диагностические логи для ответа на вопрос, где именно возникает задержка отрисовки графика: в `metaterminal`, RPC, snapshot quote, barcharts upstream, Redis cache, stream connect или клиентской отрисовке.

**Контекст**: по `log/2026-04-13-W1.log` видно, что первичные `marketdata/barcharts` snapshot-запросы занимали `3517ms`, `3586ms`, `5662ms`, `1248ms`. При этом quote snapshot и stream connect укладывались примерно в `729ms..971ms`. Текущий лог показывает, что основная задержка на стороне `ts_connect` похожа на TradeStation barcharts upstream, но не даёт полной цепочки `metaterminal request -> ts_connect api start -> TradeStation request -> Redis cache -> ts_connect response -> metaterminal render`.

**Файлы блока**:

- `application/api/marketdata/barcharts.js`
- `application/domain/ts/barcharts.js`
- `application/api/marketdata/quotes.js`
- `application/api/stream/quotes.js`
- при необходимости `application/lib/ts/send.js` и `application/lib/ts/stream.js`
- `doc/review.md`

**Порядок выполнения**: T-014.

**После блока**: контрольный запуск с одним медленным графиком и review architect.

---

### T-014: Добавить correlation-aware latency logs для загрузки графика

**Статус**: `[x]`

**Поведение до**:

- `domain.ts.barcharts` логирует только `cache MISS/HIT/single-flight` и итоговый `barcharts snapshot durationMs`.
- `marketdata/quotes` логирует только generic `Request URL` и RPC `POST ... 200`.
- `stream/quotes` логирует `Connecting to`, `Connection established` и subscribe state, но не duration.
- Нет общего `traceId`, который связывает запросы `marketdata/quotes`, `marketdata/barcharts` и `stream/quotes` в один chart load.
- Нельзя точно отделить задержку TradeStation от Redis, RPC serialization и client-side render в `metaterminal`.

**Поведение после**:

- Поддержать optional `traceId`/`requestId` во входе `marketdata/quotes`, `marketdata/barcharts`, `stream/quotes`; если клиент не прислал id, генерировать локальный короткий id только для текущего RPC.
- Все latency-логи должны включать минимум: `traceId`, endpoint/action, normalized TS symbol or streamKey, period/limit для barcharts, phase, `durationMs`.
- В `marketdata/barcharts` логировать:
  - `api.start` сразу после входа в method;
  - `normalize.done` после `makeTSSymbol` и `normalizeBarPeriod`;
  - `cache.hit`/`cache.miss`/`singleFlight.reuse` из `domain.ts.barcharts`;
  - `ts.request.done` после TradeStation barcharts response;
  - `redis.set.done` или `redis.set.failed`;
  - `api.done` перед return с `totalMs` и количеством bars, если shape ответа позволяет безопасно посчитать.
- В `marketdata/quotes` логировать `api.start`, `ts.request.done`, `api.done`, `symbolCount`, `tsSymbolCount`, `errorCount`, если shape ответа позволяет безопасно посчитать.
- В `stream/quotes` или `lib.ts.stream` логировать `stream.connect.start`, `stream.connect.done`, `stream.subscribe.done` с duration и `streamKey`.
- Не логировать каждый quote packet или bar packet.

**Ограничения**:

- Не менять public response shape.
- Не менять stream event payload.
- Не добавлять обязательный параметр; `traceId`/`requestId` должны быть optional.
- Не логировать токены, полный Authorization header или персональные account данные.
- Не превращать generic `lib.ts.send` в noisy logger для всех endpoint-ов без явного label/trace flag; если worker меняет `lib.ts.send`, добавить optional параметры и сохранить поведение по умолчанию.
- Если точный UI render time нужен, явно указать в review, что metaterminal должен логировать тот же `traceId` на фазах `request.start`, `response.received`, `render.done`.

**Критерии завершения**:

- По одному `traceId` можно собрать цепочку для графика:

```text
chart.load api.start -> quotes api.done -> barcharts cache.* -> barcharts ts.request.done -> barcharts api.done -> stream.connect.done -> stream.subscribe.done
```

- Для повторного одинакового barcharts-запроса в пределах TTL видно `cache.hit` и latency без TradeStation request.
- Для параллельного одинакового barcharts-запроса видно `singleFlight.reuse` и время ожидания общего Promise.
- Для первичного медленного графика видно, какая фаза дала основную задержку.
- `npm run lint` проходит.
- `npm run types` проходит.

---

## Блок 9: TS client prewarm on service start

**Цель блока**: убрать первый лишний cold-start latency на первом chart/quote запросе за счёт фонового прогрева `TradeStation` client/token сразу после старта `ts_connect`.

**Контекст**: по `log/2026-04-13-W1.log` видно, что у первого графика `GLNG 270115C60` между `chart.load api.start` (`08:58:54.632Z`) и первым `Request URL` в `marketdata/barcharts` (`08:58:55.595Z`) есть дополнительный разрыв примерно `963ms`. В этот же момент впервые выполняются `setClient: ptfin` и `POST /v3/oauth/token`, то есть первый клиентский запрос платит за lazy setup TS client/token. Для последующих графиков такого дополнительного warm-up gap уже нет.

**Файлы блока**:

- `application/lib/ts/start.js`
- при необходимости `application/domain/ts/clients.js`
- `doc/review.md`

**Порядок выполнения**: T-015.

**После блока**: контрольный запуск с чистого старта процесса и review architect.

---

### T-015: Прогревать `domain.ts.clients.getClient()` в фоне после старта worker

**Статус**: `[x]`

**Поведение до**:

- `ts_connect` поднимается быстро, но первый реальный запрос к `marketdata/quotes`, `marketdata/barcharts` или stream endpoint вызывает lazy `domain.ts.clients.getClient({ name: 'ptfin' })`.
- Внутри первого пользовательского RPC происходит:
  - `setClient: ptfin`;
  - `lib.ts.refresh()` через `POST https://signin.tradestation.com/v3/oauth/token`;
  - только после этого стартует первый upstream request в `api.tradestation.com`.
- Из-за этого первый chart request получает лишние ~`0.9s..1.0s` cold-start latency поверх реального `barcharts` времени.

**Поведение после**:

- После старта worker `W1` запускать best-effort prewarm для `ptfin` в фоне, не блокируя `Listen port`.
- Прогрев должен:
  - вызвать `domain.ts.clients.getClient({ name: 'ptfin' })` один раз после старта процесса;
  - обновить access token заранее;
  - не ломать существующий lazy path: если prewarm не удался, реальный запрос по-прежнему может инициировать setup сам.
- Ошибка prewarm не должна валить процесс и не должна переводить сервис в failed state; достаточно `warn/error` лога и сохранения lazy fallback.
- Не запускать агрессивный цикл прогрева; нужен только единичный фоновый warm-up на startup.

**Ограничения**:

- Не блокировать startup и не задерживать `Listen port`.
- Не менять public API контракт endpoint-ов.
- Не убирать существующий lazy path из `domain.ts.clients.getClient`.
- Не делать прогрев для несуществующих `config.ts[name]`.
- Не добавлять бесконечные retry/reconnect loops в startup path.

**Критерии завершения**:

- На fresh start до первого пользовательского chart request в логах уже видно startup prewarm `setClient: ptfin` / token refresh.
- У первого chart request больше нет отдельного ~`1s` gap между `chart.load api.start` и первым upstream `Request URL`, если TradeStation доступен.
- Если TradeStation auth временно недоступен, сервис всё равно поднимается и принимает запросы; lazy path остаётся рабочим fallback.
- `npm run lint` проходит.
- `npm run types` проходят.

---

## Блок 12: Option chain riskFreeRate suppression

**Цель блока**: убрать `riskFreeRate` из рабочего контракта `ts_connect` для `options/chain`, чтобы connector не прокидывал в TradeStation параметр, который в текущем продукте не нужен и приводит к проблемному upstream request shape.

**Контекст**:

- После расширения логирования выяснилось, что ошибка option chain сохраняется не только из-за reconnect/error handling, но и из-за самого request shape: `riskFreeRate` попадает в `application/api/options/chain.js` и затем в downstream request.
- В проблемных запросах ранее фигурировал query fragment `riskFreeRate=0`, после которого upstream отвечал `Failed / Internal server error`.
- В текущем `application/api/options/chain.js` строки с `riskFreeRate` уже локально закомментированы, но это не считается завершённой фиксацией:
  - остаётся dead code;
  - публичный контракт метода не зафиксирован явно;
  - определено, `riskFreeRate` рпосто удалить из запроса;
  - документация проекта не отделяет upstream-возможность от фактической поддержки в нашем connector.
- Для текущего проекта `riskFreeRate` не является обязательным бизнес-параметром option chain. До появления доказанного кейса безопаснее отключить его полностью, чем продолжать передавать `0` или произвольное значение в upstream.

**Файлы блока**:

- `application/api/options/chain.js`
- при необходимости `application/lib/stream/optionChain.js`
- при необходимости `application/lib/ts/optionChain.js`
- `doc/openapi_20260411.md`
- при необходимости `doc/review.md`

**Порядок выполнения**: T-018.

**После блока**: контрольный прогон `options.chain` без `riskFreeRate` в query string и review architect.

---

### T-018: Отключить `riskFreeRate` в public contract и downstream request `options/chain`

**Статус**: `[x]`

**Поведение до**:

- `options/chain` исторически принимал `riskFreeRate` и мог прокидывать его дальше в `chainData`.
- Даже если код сейчас частично закомментирован, поведение метода не оформлено явно:
  - не определено, поддерживает ли connector `riskFreeRate`;
  - не определено, должен ли он игнорировать этот параметр;
  - в документации нет явной политики поддержки/неподдержки.
- В рабочих логах именно presence `riskFreeRate=0` фигурирует как часть проблемного stream request.

**Поведение после**:

- `ts_connect` должен считать `riskFreeRate` отключённым параметром для `application/api/options/chain.js`.
- Входной `riskFreeRate`, если его прислал клиент, не должен попадать в downstream request и не должен участвовать в `streamKey`.
- В `application/api/options/chain.js` не должно остаться закомментированного dead code вокруг `riskFreeRate`; поведение должно быть оформлено явно:
  - параметр убрать из destructuring совсем;
- В логах `Connecting to: .../marketdata/stream/options/chains/...` больше не должно быть `riskFreeRate=...` для этого endpoint-а.
- Документация проекта должна явно различать:
  - что поддерживает upstream TradeStation API;
  - что реально поддерживает наш connector contract сейчас.

**Ограничения**:

- Не менять другие option endpoints без необходимости, в частности не трогать legacy `stream/options/quotes`, где `riskFreeRate` относится к другому upstream endpoint.
- Не подменять проблему временным `riskFreeRate = null` при сохранении неясного контракта.
- Не вводить новый `DomainError` только за наличие `riskFreeRate`, если можно безопасно игнорировать параметр и сохранить backward compatibility входного payload.
- Не смешивать эту задачу с автоматическим урезанием `range`/`strikeProximity`; это отдельный request-shaping concern.

**Критерии завершения**:

- `options.chain` больше не отправляет `riskFreeRate` в upstream query string.
- `streamKey` для managed chain stream не содержит `riskFreeRate=...`.
- В `application/api/options/chain.js` нет закомментированного dead code вокруг `riskFreeRate`.
- `doc/openapi_20260411.md` явно фиксирует, что `riskFreeRate` существует в upstream `TradeStation`, но отключён в текущем connector contract.
- `npm run lint` проходит.
- `npm run types` проходят.

---

## Блок 10: marketdata quotes response contract for metaterminal

**Цель блока**: привести ответ `application/api/marketdata/quotes.js` к нормализованному per-instrument контракту, который ожидает `metaterminal`, и перестать возвращать raw TradeStation callback envelope.

**Файлы блока**:

- `application/api/marketdata/quotes.js`
- `application/lib/ts/readQuote.js`
- `application/lib/utils.js`
- при необходимости `doc/review.md`

**Порядок выполнения**: T-016.

**После блока**: контрольный вызов `marketdata/quotes` для пакета OPT instruments и review architect.

---

### T-016: Возвращать normalized per-instrument quote rows вместо raw TS envelope

**Статус**: `[x]`

**Поведение до**:

- `marketdata/quotes` принимает `instruments`, преобразует их в TS symbols и делает GET `/v3/marketdata/quotes/{symbols}`.
- Endpoint возвращает raw upstream shape вида `{ type, id, result: { Quotes: [...] } }` или merged object из таких ответов.
- `Quotes[*].Symbol` приходит в TS display-format:
  - `CRWV 280121C80`
  - `CRWV 280121C175`
  - `GLNG 270115C55`
- `metaterminal` ожидает per-instrument normalized row с internal symbol:
  - `CRWV280121C00080000`
  - `CRWV280121C00175000`
  - `GLNG270115C00055000`
- Из-за этого `metaterminal` не может корректно матчить ответ по `symbol` и получает `null`/`TS_OFFLINE` при валидном upstream response.

**Поведение после**:

- `marketdata/quotes` не возвращает raw callback envelope.
- Endpoint разбирает `response.result.Quotes` или `response.Quotes`.
- Каждый upstream `Quote` преобразуется в normalized row через существующие helper-ы:
  - TS symbol -> internal symbol через `lib.utils.makeSymbol(...)`
  - quote/data fields через `application/lib/ts/readQuote.js`
- Ответ endpoint-а должен быть совместим с `metaterminal`:
  - либо `Array<Row>`
  - либо `{ result: Row[] }`
- Каждый `Row` должен содержать:
  - `symbol`
  - `instrument`
  - `data`
  - `quote`
- `row.symbol` и `row.data.symbol` должны быть в internal symbol format `metaterminal`.
- `quote` должен быть в lowercase contract:
  - `bid`
  - `bid_size`
  - `ask`
  - `ask_size`
- `data` должен быть уже normalized:
  - `symbol`
  - `lp`
  - `lp_time`
  - `prev_close_price`
  - `date`
  - `listed_exchange`
  - `currency`
  - `currency_id`
  - `currency_code`
  - `underlying`
  - `source`
- Один входной instrument должен давать максимум один normalized row на этот instrument.
- Порядок rows желательно сохранять стабильным относительно входного списка `instruments`.

**Ограничения**:

- Не менять входной контракт endpoint-а: только `instruments`, legacy `symbols` не возвращать.
- Не возвращать TS display symbol в `row.symbol`.
- Не перекладывать адаптацию raw envelope на `metaterminal`.
- Не ломать batching >100 symbols.
- Не менять public contract других endpoint-ов.
- Если для части instruments upstream не вернул quote, это должно быть явно отражено предсказуемо и не должно приводить к подмене symbol чужим row.

**Критерии завершения**:

- Ответ `marketdata/quotes` больше не имеет shape `{ type, id, result: { Quotes: [...] } }`.
- `metaterminal` может матчить rows по `row.symbol === requested instrument.symbol` без дополнительных адаптеров.
- Для примеров ниже ответ приходит с internal symbols:
  - `CRWV 280121C80` -> `CRWV280121C00080000`
  - `CRWV 280121C175` -> `CRWV280121C00175000`
  - `CRWV 280121P35` -> `CRWV280121P00035000`
  - `CRWV 280121P60` -> `CRWV280121P00060000`
  - `GLNG 270115C55` -> `GLNG270115C00055000`
  - `GLNG 270115C60` -> `GLNG270115C00060000`
  - `PFE 280121C30` -> `PFE280121C00030000`
  - `PFE 280121C40` -> `PFE280121C00040000`
- `readQuote()` реально используется для формирования normalized `data`/`quote`, а не остаётся мёртвым helper-ом.
- `npm run lint` проходит.
- `npm run types` проходит.

---

## Блок 11: Option chain upstream error handling

**Цель блока**: прекратить бесконечный reconnect loop для `marketdata/stream/options/chains`, если TradeStation сразу после подключения отдаёт детерминированный error packet, и сохранить полное сообщение ошибки для клиента и логов.

**Контекст**:

- По `log/2026-05-09-W1.log` и `log/2026-05-10-W1.log` видно устойчивый сценарий для `TSLA`:
  - TCP/HTTP stream подключение успешно устанавливается;
  - сразу после `Connection established` upstream присылает JSON packet `{ "Error": "Failed", "Message": "Internal server error" }`;
  - это повторяется для нескольких expiration и request widths:
    - `expiration=2026-05-15`, `strikeProximity=94`;
    - `expiration=2026-06-18`, `strikeProximity=78`;
    - `expiration=2026-09-18`, `strikeProximity=67`.
- Текущий `application/lib/ts/stream.js` считает permanent только `INVALID*`, поэтому пакет `Failed / Internal server error` классифицируется как transient и запускает бесконечный reconnect `5s -> 10s -> ...`, хотя запрос детерминированно отвергается upstream.
- `application/domain/ts/streams.js::serializeError()` для object-packet сейчас берёт только `error.Error` и теряет `error.Message`.
- Snapshot helper `application/lib/ts/optionChain.js` при object-error делает `new Error(String(err))`, что даёт `[object Object]` вместо читаемого текста.
- Вероятная продуктовая причина rejection находится выше по стеку: `metaterminal` запрашивает почти полный expiration chain (`range = ceil(strikes.length / 2)` -> `strikeProximity=67/78/94`). Но в рамках `ts_connect` нельзя маскировать это бесконечными reconnect-ами или немыми `[object Object]`.

**Файлы блока**:

- `application/lib/ts/stream.js`
- `application/domain/ts/streams.js`
- `application/lib/stream/optionChain.js`
- `application/lib/ts/optionChain.js`
- при необходимости `doc/review.md`

**Порядок выполнения**: T-017.

**После блока**: контрольный прогон `options.chain({ symbol: 'TSLA', expiration: '2026-05-15', range: 94, stream: true })` и review architect.

---

### T-017: Остановить reconnect loop и нормализовать `Failed / Internal server error` для option chain

**Статус**: `[x]`

**Поведение до**:

- `lib.ts.stream.handlePacket()` на packet `{ Error: 'Failed', Message: 'Internal server error' }` вызывает `onError(packet)` и затем `scheduleReconnect()`.
- Managed chain stream продолжает жить как active entry и бесконечно переподключается к тому же endpoint-у:
  - `marketdata/stream/options/chains/TSLA?...strikeProximity=94...`;
  - `marketdata/stream/options/chains/TSLA?...strikeProximity=78...`;
  - `marketdata/stream/options/chains/TSLA?...strikeProximity=67...`.
- `stream/error` payload теряет `Message` и клиент получает только `Failed`.
- Snapshot helper `lib.ts.optionChain()` при таком object-error может вернуть reject с текстом `[object Object]`.

**Поведение после**:

- Для option chain stream packet-а `{ Error: 'Failed', Message: 'Internal server error' }` не запускать reconnect loop.
- Такой packet должен считаться permanent request failure для текущего stream key:
  - `stopStream('permanent-error')`;
  - managed entry должен завершиться;
  - downstream client должен получить structured error с обоими полями: `Error` и `Message`.
- `serializeError()` должен сохранять как минимум:
  - `message` в читабельном виде, например `Failed: Internal server error` или эквивалентно;
  - `code`/`error` из upstream `Error`;
  - `details`/`upstreamMessage` из upstream `Message`;
  - `symbol`, если есть в packet.
- `lib.ts.optionChain()` snapshot path при таком reject должен завершаться с осмысленным `Error`, а не `[object Object]`.
- Логи должны позволять отличить:
  - transport failure (`fetch failed`, `EPIPE`, timeout);
  - upstream packet rejection (`Failed / Internal server error`);
  - permanent user/data issue (`INVALID SYMBOL`).

**Ограничения**:

- Не менять transport/reconnect поведение для реально transient ошибок вроде `fetch failed`, connection reset, heartbeat timeout.
- Не маскировать upstream rejection под успешный пустой chain.
- Не добавлять silent fallback на другой endpoint без явного описания и review.
- Не пытаться автоматически урезать `strikeProximity` внутри `ts_connect`; request shaping — отдельная задача выше по стеку.
- Не терять backward compatibility события `stream/error`: можно расширить payload, но нельзя убирать существующие поля.

**Критерии завершения**:

- При воспроизведении `options.chain({ symbol: 'TSLA', expiration: '2026-05-15', range: 94, stream: true })` после первого packet-а `Failed / Internal server error` нет бесконечного reconnect loop.
- В логах видно permanent classification и stop reason вместо `TRANSIENT -> reconnect`.
- `stream/error` payload содержит и `Failed`, и `Internal server error`, а не только `Failed`.
- Snapshot path `lib.ts.optionChain()` больше не выдаёт `[object Object]` для object-error packet-а.
- `fetch failed`/`EPIPE` по-прежнему остаются reconnectable transport errors.
- `npm run lint` проходит.
- `npm run types` проходит.
