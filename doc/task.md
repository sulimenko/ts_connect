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

### Общие правила реализации

- Избегать overengineering: проверки и преобразования добавлять только там, где они защищают реальный публичный контракт, external input или known failure mode.
- Предпочитать компактный читаемый код во всём методе, если он не скрывает domain error, lifecycle state или внешний формат данных.
- Конкретные примеры в задаче не являются обязательным implementation recipe: worker может заменить их более простой формой, если сохраняет поведение и критерии приёмки.
- Console statements и закомментированные console statements не входят в scope задачи и review, если конкретная задача явно не про logging/observability.

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

Архив текущего цикла перенесён в `doc/changelog.md`.
Сейчас открыт один блок для worker.

## Блок 19: Position current normalization for placeorder

### T-025: Нормализовать lookup позиции и значение current перед определением TradeAction

- [x] Проверить и исправить цепочку хранения/чтения текущей позиции для `application/lib/ts/placeorder.js`, `application/domain/ts/positions.js`, `application/api/account/positions.js`, `application/domain/ts/client.js`, при необходимости `application/lib/utils.js`.
- [x] До исправления `placeorder` определяет `current` через `domain.ts.positions.getPosition({ account, symbol: instrument.symbol })`, затем делает `parseFloat(position.get('Quantity')) || 0.0`. При этом snapshot и stream positions сохраняют запись по `position.Symbol` / `message.Symbol`, то есть по raw symbol из TradeStation. Если raw symbol не совпадает с internal `instrument.symbol`, lookup тихо промахивается, `getPosition()` создаёт пустой `Map`, и `current` становится `0.0`.
- [x] Такой silent miss меняет смысл `lib.utils.getAction()`:
      `close` / `cover` ордер может быть ошибочно собран как `open`, потому что логика ветвится от `current === 0.0`.
- [x] Аналогичная проблема есть в `domain.ts.positions.clearPosition({ account, symbol: instrument.symbol })` после полного закрытия позиции: сейчас очищается ключ internal symbol, а реально сохранённая позиция может лежать под другим ключом.
- [x] Worker должен ввести единый canonical key для позиции и использовать его одинаково в `setPosition`, `getPosition`, `clearPosition` и в `placeorder`. Если TradeStation возвращает symbol в другом формате, нормализация должна происходить на ingest path или должен храниться явный canonical alias, но не допускается silent mismatch.
- [x] Отдельно проверить семантику `Quantity`, из которого собирается `current`: storage сейчас просто сохраняет raw `Quantity` из TradeStation без нормализации знака и без документированного инварианта. Если входные payload уже гарантированно signed, это надо явно закрепить в коде/комментарии. Если нет, нужно нормализовать `current` из фактического payload shape, а не из предположения.
- [x] `getPosition()` не должен скрывать miss при критичном lookup для order placement. Для order path нужен явный, диагностируемый результат: либо найдена позиция, либо код осознанно принимает `current = 0` как verified absence, а не как побочный эффект auto-create.
- [x] При необходимости добавить точечные диагностические логи только вокруг ingest/lookups positions, чтобы можно было сравнить raw TradeStation symbol, canonical key и вычисленный `current`. Не добавлять шумные глобальные логи на каждый packet без фильтра.

Файлы:

- `application/lib/ts/placeorder.js`
- `application/domain/ts/positions.js`
- `application/api/account/positions.js`
- `application/domain/ts/client.js`
- `application/lib/utils.js` (если потребуется минимальная коррекция contract around `current`)

Ограничения:

- Не менять публичный contract процедуры выставления ордера.
- Не делать guess-based mapping для symbol без явной общей нормализации.
- Не вводить новые тесты в рамках этого блока; architect выдаст test-block отдельно после review, если блок будет принят.

Критерии приёмки:

- Существующая позиция по инструменту корректно находится в order path и даёт правильный `current`.
- `TradeAction` для частичного/полного закрытия определяется от реальной позиции, а не от ложного `0.0`.
- После полного закрытия очищается та же canonical entry, которая использовалась для lookup.
- Поведение одинаково корректно для `STK` и `OPT`.
- `npm run lint`, `npm run types`, `npm test` проходят.

## Блок 20: Idempotent position symbol normalization

### T-026: Исправить повторную нормализацию OPT symbol и semantics отсутствующей позиции

- [x] Исправить `lib.utils.normalizePositionSymbol()` так, чтобы нормализация была идемпотентной для всех поддержанных форматов symbol:
      `CRWV 280121C80 -> CRWV280121C00080000`,
      `CRWV280121C00080000 -> CRWV280121C00080000`,
      `MSFT -> MSFT`.
- [x] Не использовать текущий `makeSymbol()` напрямую для уже internal OPT symbol со strike в scaled OCC-like формате, потому что `00080000` сейчас интерпретируется как display strike `80000` и превращается в `80000000`.
- [x] Убедиться, что `domain.ts.positions.setPosition()`, `getPosition()`, `clearPosition()` и `application/lib/ts/placeorder.js` применяют normalization ровно в одном canonical contract и не портят key при повторном вызове.
- [x] Доработать order path semantics для `position === null`: код должен явно различать подтверждённое отсутствие позиции и отсутствие записи в локальном registry. Если локальный registry не загружен/неизвестен, нельзя молча считать `current = 0` для определения close/open action без диагностируемого fallback.
- [x] Добавить regression coverage в существующий test entrypoint, потому что текущий `npm test` не ловит этот дефект. Минимальный набор: display OPT symbol, internal OPT symbol, repeated normalization, position lookup after ingest by TradeStation display symbol and lookup by internal symbol.

Файлы:

- `application/lib/utils.js`
- `application/domain/ts/positions.js`
- `application/lib/ts/placeorder.js`
- `application/api/account/positions.js`
- `application/domain/ts/client.js`
- `application/test/run.js`

Критерии приёмки:

- `normalizePositionSymbol(normalizePositionSymbol(symbol)) === normalizePositionSymbol(symbol)` для `STK`, display OPT и internal OPT.
- Position stored from `Symbol = "CRWV 280121C80"` is found by lookup for `CRWV280121C00080000`.
- Position stored from `Symbol = "CRWV280121C00080000"` is found by lookup for `CRWV 280121C80`.
- `placeorder` no longer computes `TradeAction` from a corrupted option key.
- `npm run lint`, `npm run types`, `npm test` проходят.

### T-027: Вынести parsing/formatting symbol в единую функцию и убрать локальные сборки

- [x] Проверить все места, где symbol сейчас парсится или собирается вручную: `application/lib/utils.js`, `application/lib/ts/readOptionChain.js`, `application/lib/ts/readQuote.js`, `application/api/marketdata/quotes.js`, `application/api/marketdata/barcharts.js`, `application/api/stream/quotes.js`, `application/api/stream/matrix.js`, `application/api/orderexecution/order.js`, `application/lib/ts/placeorder.js`, `application/domain/ts/positions.js`.
- [x] В `application/lib/utils.js` оставить один общий symbol contract/helper для всех преобразований. Он должен покрывать минимум:
      canonical internal OPT symbol (`CRWV280121C00080000`),
      TradeStation/display OPT symbol (`CRWV 280121C80`),
      STK symbol (`MSFT`),
      parsed parts (`underlying`, `expCode`, `optType`, `strike`), если они нужны response parsers.
- [x] Сохранить явное разделение контрактов: `makeSymbol()` формирует canonical symbol back-системы и является правильным контрактом `metaterminal` / `ts_connect`; `makeTSSymbol()` формирует symbol, который ожидает TradeStation upstream.
- [x] Публичными именами для symbol conversion должны остаться `makeSymbol()` и `makeTSSymbol()`: `makeSymbol()` возвращает back/metaterminal canonical format, `makeTSSymbol()` возвращает TradeStation upstream format. Лишние helpers `convertSymbol`, `normalizePositionSymbol` и любые новые промежуточные wrappers нужно удалить, если по `rg` нет внешнего call site, которому они реально нужны. Если wrapper всё же оставлен для совместимости, в задаче/review надо явно указать caller и причину.
- [x] Убрать локальную сборку strike через `toFixed(3).split('.')`, `padStart`, `padEnd` вне единого helper. В первую очередь проверить `application/lib/ts/readOptionChain.js`, где сейчас формируется `symbol_raw` независимо от `lib.utils`.
- [x] При формировании request symbol и response symbol всегда выбирать формат через общий helper, а не через повторный regex. Это касается snapshot quotes, stream quotes, matrix, barcharts, positions и order placement.
- [x] Обновить regression coverage: тест должен падать, если один call site формирует другой canonical symbol для того же опциона, чем остальные.

Критерии приёмки:

- В проекте нет новой ручной сборки OPT symbol вне общего helper.
- `readOptionChain`, `marketdata/quotes`, `stream/quotes`, `stream/matrix`, `positions` и `placeorder` используют один contract для canonical/display formats.
- В `application/lib/utils.js` нет лишних symbol conversion helpers без caller-а; основная точка входа для back format — `makeSymbol()`, для TS format — `makeTSSymbol()`.
- `npm run lint`, `npm run types`, `npm test` проходят.

## Блок 21: Matrix instruments contract parity

### T-028: Привести `stream/matrix` к `instruments` input как у `stream/quotes`

- [x] Обновить `application/api/stream/matrix.js`, чтобы endpoint принимал `instruments = []` вместо отдельных `symbol` и `type`.
- [x] Убрать public contract `symbol` / `type` из входа `stream/matrix`; symbol и тип инструмента должны приходить только внутри `instruments`, как в `application/api/stream/quotes.js`.
- [x] Для subscribe выбирать первый валидный instrument из массива и нормализовать symbol через общий `lib.utils.makeSymbol()`.
- [x] Сменить пустой input error с `ESYMBOL` на `EINSTRUMENTS`, чтобы contract совпадал с `stream/quotes`.
- [x] Сохранить существующий lifecycle `subscribe` / `touch` / `unsubscribe`, `streamKey`, `idleMs`, `traceId` / `requestId` и stop reason propagation.
- [x] Обновить regression coverage для `stream/matrix`, чтобы тест подтверждал instruments-only input и построение matrix stream key из первого валидного инструмента.

Критерии приёмки:

- `stream/matrix` не деструктурирует `symbol` и `type` из public input.
- `stream/matrix` принимает такой же high-level input shape, как `stream/quotes`: `{ instruments, action, stop, idleMs, streamKey, traceId, requestId }`.
- При пустом subscribe input возвращается `DomainError('EINSTRUMENTS')`.
- `npm run lint`, `npm run types`, `npm test` проходят.

## Блок 22: Order action type normalization

### T-029: Передавать нормализованный instrument type в `getAction()` при выставлении ордера

- [x] Исправить `application/lib/ts/placeorder.js`: `lib.utils.getAction()` должен получать instrument с нормализованным `type`, полученным из `lib.utils.makeSymbol(instrument.symbol)`, `instrument.type` или `instrument.asset_category`.
- [x] Сейчас `placeorder` вычисляет `instrumentType`, но вызывает `lib.utils.getAction(instrument, qty, current)`. Если caller присылает `{ symbol, asset_category: 'OPT' }`, `getAction()` не видит `instrument.type === 'OPT'` и для закрытия long option возвращает stock action `Sell` вместо `SELLTOCLOSE`.
- [x] Не ломать `makeTSSymbol()` contract: `data.Symbol` должен оставаться TradeStation upstream format, а `makeSymbol()` должен оставаться canonical back/metaterminal format.
- [x] Добавить regression coverage: для OPT instrument с `asset_category: 'OPT'`, `qty < 0`, `current > 0` action должен быть `SELLTOCLOSE`; для short option buyback должен быть `BUYTOCLOSE`.

Критерии приёмки:

- `lib.utils.getAction()` больше не получает instrument без нормализованного `type` в order path.
- Option close/cover actions корректны для входа с `asset_category`, а не только с `type`.
- `npm run lint`, `npm run types`, `npm test` проходят.

## Блок 23: Barcharts invalid instrument guard

### T-030: Вернуть `DomainError('EINSTRUMENT')` для пустого `marketdata/barcharts` input

- [x] Исправить `application/api/marketdata/barcharts.js`: endpoint не должен читать `instrument.asset_category` до проверки, что `instrument` существует и `instrument.symbol` является непустой строкой.
- [x] Сейчас после symbol refactor код вычисляет `const instrumentType = parsedInstrument?.type ?? instrument.asset_category` до guard-а. Для `{ instrument: null }` это даёт `TypeError: Cannot read properties of null`, хотя contract endpoint-а обещает `DomainError('EINSTRUMENT')`.
- [x] Сохранить текущий symbol contract: `makeSymbol()` формирует canonical back/metaterminal symbol, `makeTSSymbol()` формирует TradeStation upstream symbol.
- [x] Добавить regression coverage в `application/test/run.js`: `marketdata/barcharts.method({ instrument: null })` и пустой symbol должны возвращать `DomainError('EINSTRUMENT')`, а не бросать `TypeError`.

Критерии приёмки:

- Invalid/empty instrument input в `marketdata/barcharts` стабильно возвращает `DomainError('EINSTRUMENT')`.
- Happy path barcharts по valid STK/OPT instrument продолжает строить TradeStation symbol через `makeTSSymbol()`.
- `npm run lint`, `npm run types`, `npm test` проходят.

## Блок 24: Matrix compact symbol parsing guard

### T-031: Сохранить компактность `stream/matrix` без потери contract guards

- [x] Исправить `application/api/stream/matrix.js`: текущую строку `makeSymbol(instruments[0].symbol)` можно менять. Важно не сохранить конкретную форму, а оставить метод коротким и читаемым без лишних промежуточных сущностей.
- [x] Проверки и преобразования делать только при необходимости: минимально защитить случаи, где public input может быть пустым/некорректным и должен дать `DomainError('EINSTRUMENTS')`, а не `TypeError`.
- [x] Сейчас `const { symbol, tsSymbol } = lib.utils.makeSymbol(instruments[0].symbol);` выполняется до contract validation. Для `{ instruments: [] }`, `{ instruments: [{}] }` или invalid symbol это может дать `TypeError` вместо `DomainError('EINSTRUMENTS')`.
- [x] Компактность нужна на уровне всего метода, а не только одной строки. Если более короткая запись сохраняет понятный lifecycle `subscribe/touch/unsubscribe`, `streamKey` и symbol formats, её нужно предпочесть развернутому over-defensive коду.
- [x] Явно проверить формат symbol для upstream matrix endpoint и downstream event payload: TradeStation matrix routing и `streamKey` используют `tsSymbol`, а downstream `metaterminal` packet остаётся на canonical back symbol `symbol`.
- [x] Добавить regression coverage: empty instruments, malformed first instrument и first invalid / second valid instrument не должны падать `TypeError`; ожидаемый результат должен соответствовать contract `EINSTRUMENTS` или выбранной стратегии first valid instrument.

Критерии приёмки:

- [x] `stream/matrix` не падает до `try/finally` при пустом или некорректном `instruments`.
- [x] Invalid input возвращает `DomainError('EINSTRUMENTS')`.
- [x] `npm run lint`, `npm run types`, `npm test` проходят.

## Блок 25: Stream API compact contract alignment

### T-032: Привести `application/api/stream/quotes.js` к compact contract style

- [x] Проверить и упростить `application/api/stream/quotes.js` по правилам `task.md`: без overengineering, минимальные проверки только для public input, компактный читаемый метод целиком.
- [x] Сохранить текущий public input shape: `{ instruments, action, stop, idleMs, streamKey, traceId, requestId }`.
- [x] Сохранить поддержку нескольких instruments: quotes stream может подписываться на batch symbols, поэтому нельзя превращать его в single-instrument flow как `matrix`.
- [x] Нормализацию symbol делать через общий contract `makeSymbol()` / `makeTSSymbol()`. Не возвращать к локальным regex или ручной сборке option symbol.
- [x] Проверить invalid input behavior: empty/invalid instruments для `subscribe` должны возвращать `DomainError('EINSTRUMENTS')`, а `unsubscribe` / `touch` должны работать по `streamKey`, если он передан.
- [x] Добавить или уточнить regression coverage только там, где это реально защищает public contract: empty subscribe, invalid action, touch/unsubscribe by key, multiple instruments into stable TS symbol key.

Критерии приёмки:

- [x] `stream/quotes` остаётся batch-capable и использует общий symbol formatter.
- [x] Public input errors остаются domain errors, без `TypeError` на пустом/битом input.
- [x] Метод короче/чище без потери lifecycle semantics.
- [x] `npm run lint`, `npm run types`, `npm test` проходят.

### T-033: Привести `application/api/stream/addBarchart.js` к stream API contract style

- [x] Проверить `application/api/stream/addBarchart.js` и привести его к тем же правилам компактного contract-first кода.
- [x] Определить и явно закрепить public input shape для chart stream. Если текущий `symbol` остаётся осознанным contract для chart stream, описать это в review notes. Если нужно выровнять с `instrument`, сделать это без поддержки лишних legacy вариантов.
- [x] Сохранить `action` / `stop` / `idleMs` / `streamKey` / `traceId` / `requestId` lifecycle и stop reason propagation.
- [x] Проверки `period`, `limit`, `symbol/instrument` должны быть минимальными, но достаточными, чтобы invalid public input возвращал `DomainError`, а не падал internal error.
- [x] Символы для upstream TradeStation должны формироваться через `makeSymbol()` / `makeTSSymbol()` там, где endpoint принимает metaterminal/back symbol.
- [x] Добавить regression coverage для invalid input и для выбранного public contract shape.

Критерии приёмки:

- [x] `stream/addBarchart` имеет явно понятный public input contract и не смешивает несколько неописанных форматов.
- [x] `period`/`limit`/symbol validation возвращают documented domain errors.
- [x] Lifecycle `subscribe/touch/unsubscribe` сохранён.
- [x] `npm run lint`, `npm run types`, `npm test` проходят.

### T-034: Проверить `application/api/stream/clear.js` на contract metadata и compact lifecycle

- [x] Проверить `application/api/stream/clear.js`: endpoint сейчас простой, но должен соответствовать общему style публичных stream API.
- [x] Если требуется, добавить `parameters`, `returns`, `errors` metadata без усложнения метода.
- [x] Сохранить текущую семантику: очистка всех подписок текущего `context.client` через `domain.ts.streams.unsubscribeAll({ reason: 'clear' })`.
- [x] Проверить, что trace logging остаётся компактным и показывает `removedCount`.
- [x] Добавить regression coverage только если существующие тесты не фиксируют return shape `{ removed, total }`.

Критерии приёмки:

- [x] `stream/clear` остаётся коротким и не получает лишнюю абстракцию.
- [x] Return shape и trace fields понятны из кода и docs.
- [x] `npm run lint`, `npm run types`, `npm test` проходят.

### T-035: Финальный audit всех `application/api/stream/*` после преобразования

- [x] После T-032..T-034 сделать общий audit папки `application/api/stream`.
- [x] Проверить единообразие action handling: `subscribe`, `touch`, `unsubscribe`, legacy `stop` только через `lib.utils.normalizeAction()`.
- [x] Проверить единообразие managed stream lifecycle: API слой не хранит state, upstream stream создаётся через `domain.ts.streams.subscribe`, stop прокидывает reason до `domain.ts.clients.stopStoredStream()`.
- [x] Проверить symbol formats: downstream metaterminal events используют canonical back symbol, upstream TradeStation endpoints используют TS symbol там, где это требуется.
- [x] Не трогать console statements и закомментированные console statements в рамках этой задачи, если они не ломают тесты и задача не про logging.
- [x] Обновить `doc/review.md` заключением по блоку.

Критерии приёмки:

- [x] Все файлы `application/api/stream/*` соответствуют общим правилам `task.md`.
- [x] Нет новых legacy input aliases без явного решения в задаче.
- [x] `npm run lint`, `npm run types`, `npm test` проходят.

## Блок 26: Barchart stream canonical event symbol

### T-036: Отдавать canonical symbol в downstream `stream/barchart` event

- [x] Исправить `application/api/stream/addBarchart.js`: upstream endpoint, `streamKey` и `tsClient.streamCharts()` могут использовать TradeStation `tsSymbol`, но downstream event `stream/barchart` должен отдавать canonical back/metaterminal symbol.
- [x] Сейчас `emit('stream/barchart', { streamKey: key, symbol: chartSymbol, bar: message })` использует `chartSymbol`, который после T-033 является `tsSymbol`. Для OPT это формат `CRWV 280121C80`, а общий stream audit требует canonical back symbol `CRWV280121C00080000`.
- [x] Сохранить public input contract `symbol` для `stream/addBarchart`, если он остаётся осознанным API shape. Не добавлять новые aliases.
- [x] Добавить regression coverage: при subscribe с `symbol: 'CRWV280121C00080000'` или `symbol: 'CRWV 280121C80'` upstream endpoint остаётся `marketdata/stream/barcharts/CRWV 280121C80`, а emitted `stream/barchart` payload содержит `symbol: 'CRWV280121C00080000'`.

Критерии приёмки:

- [x] Upstream barchart routing использует TS symbol.
- [x] Downstream `stream/barchart` event использует canonical back symbol.
- [x] `npm run lint`, `npm run types`, `npm test` проходят.

## Блок 27: Stream outbound instrument payload contract

### T-037: Заменить top-level `symbol` на `instrument` в outbound stream events

- [x] Изменить downstream payload contract для всех бизнес-событий, которые отправляются наружу через managed stream `emit`: `stream/levelII`, `stream/quote`, `stream/barchart`, `stream/chain`.
- [x] Новый обязательный contract вместо top-level `symbol`:
      `instrument: { symbol, asset_category, source, listing_exchange, currency }`.
- [x] `instrument.symbol` всегда должен быть canonical back/metaterminal symbol из `lib.utils.makeSymbol()`, не TradeStation display symbol.
- [x] `instrument.asset_category` должен быть нормализованным типом инструмента из общего symbol parser-а: минимум `STK` / `OPT`.
- [x] `instrument.source` для TradeStation данных: `TS`.
- [x] `instrument.listing_exchange` и `instrument.currency` должны заполняться из доступного payload/context. Если TradeStation stream не даёт точного значения, использовать текущий устойчивый default проекта: `listing_exchange: 'TS'`, `currency: 'USD'`. Не добавлять API-запросы для enrichment в рамках этого блока.
- [x] Не оставлять `symbol` на верхнем уровне outbound packet-ов, если задача не указывает явное исключение. Это breaking contract change для metaterminal и должен быть отражён в тестах.

Файлы:

- `application/api/stream/matrix.js`: заменить payload `stream/levelII` с `{ symbol, price, type, size }` на `{ instrument, price, type, size }`. Upstream endpoint и `streamKey` продолжают использовать TS symbol.
- `application/api/stream/quotes.js`: `stream/quote` должен отдавать только `instrument` и связанные с ним данные внутри `instrument`; убрать `symbol`, `source`, `listed_exchange` / `listing_exchange`, `currency` и другие instrument-level поля из верхнего уровня response. Quote market fields (`bid`, `ask`, `lp`, sizes, volume, ch/chp, dates и т.п.) остаются на верхнем уровне.
- `application/lib/ts/readQuote.js`: при необходимости обновить formatter quote packet-а, чтобы он сразу возвращал новый outbound shape. Не дублировать instrument fields в `data`, если этот объект является частью outbound packet-а.
- `application/api/stream/addBarchart.js`: заменить `stream/barchart` payload `{ streamKey, symbol, bar }` на `{ streamKey, instrument, bar }`. `instrument.symbol` canonical, upstream chart routing остаётся на TS symbol.
- `application/lib/stream/optionChain.js`: заменить `stream/chain` payload `{ streamKey, symbol, expiration, chain }` на `{ streamKey, instrument, expiration, chain }`. Для option chain `instrument` описывает underlying/root instrument, если текущий event агрегирует цепочку по underlying; option-level symbols внутри `chain` не менять без отдельной задачи.
- `application/test/run.js`: обновить regression coverage для всех четырёх outbound events.

Ограничения:

- Не менять public input contract subscribe/touch/unsubscribe в рамках этой задачи.
- Не менять lifecycle: API слой не хранит state, managed streams остаются через `domain.ts.streams.subscribe()`.
- Не добавлять legacy compatibility aliases (`symbol` + `instrument`) в outbound payload, если нет отдельного решения architect-а.
- Не делать enrichment через дополнительные snapshot/API calls; использовать уже известные поля и defaults.
- Сохранять compact style: не вводить отдельные большие builders, если достаточно локальной компактной сборки или существующего `makeSymbol()`.

Критерии приёмки:

- `stream/levelII` больше не содержит top-level `symbol`; содержит `instrument.symbol`, `instrument.asset_category`, `instrument.source`, `instrument.listing_exchange`, `instrument.currency`.
- `stream/quote` больше не содержит top-level instrument metadata; содержит quote fields + `instrument`.
- `stream/barchart` больше не содержит top-level `symbol`; содержит `instrument`.
- `stream/chain` больше не содержит top-level `symbol`; содержит `instrument`.
- Все outbound stream tests в `application/test/run.js` проверяют отсутствие top-level `symbol` там, где он удалён.
- `npm run lint`, `npm run types`, `npm test` проходят.

## Блок 28: Stream outbound contract test gap

### T-038: Добавить явную проверку отсутствия top-level `symbol` в `stream/levelII`

- [ ] Доработать только regression coverage в `application/test/run.js`.
- [ ] В тесте `stream matrix emits canonical levelII packets while routing by tsSymbol` добавить явную проверку, что emitted payload `stream/levelII` не содержит top-level `symbol`.
- [ ] Не менять runtime-код, если текущий payload уже соответствует контракту T-037.
- [ ] Сохранить существующие проверки `instrument.symbol`, `instrument.asset_category`, `instrument.source`, `instrument.listing_exchange`, `instrument.currency`, `type`, `size`, upstream endpoint и TS symbol routing.

Критерии приёмки:

- Тест падает, если `stream/levelII` снова начнёт отдавать top-level `symbol`.
- `npm run lint`, `npm run types`, `npm test` проходят.
