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

Архив текущего цикла перенесён в `doc/changelog.md`.
Сейчас открытых блоков нет.

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
