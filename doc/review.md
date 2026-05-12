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
- параметры принимаются "как есть", хотя реально ожидается нормализация строк в boolean/number;
- новая строгая проверка ломает legacy falsey/string входы, которые раньше осознанно принимались методом;
- новые локальные переменные названы тяжело, многословно, не в `camelCase` или их именование зависит от субъективного "веса" сущности;
- неподдержанный interval, mode или format тихо переводится в дефолт вместо явного domain error;
- одинаковая нормализация action-like полей скопирована по нескольким endpoint-ам вместо общего helper-а.

## 2. Проверка `DomainError` и `.d.ts`

- доменные ошибки используются только для предсказуемых ограничений контракта;
- внутренние дефекты, поломки интеграции и unexpected cases не маскируются под `DomainError`;
- `.d.ts` рядом с `application/api/*` не требуется по умолчанию;
- если рядом есть `.d.ts`, коды ошибок синхронизированы с `errors` в `.js`;
- отсутствие `.d.ts` у публичного метода само по себе не является проблемой.

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
- после unsubscribe subscription исчезает, но upstream stream остается висеть без подписчиков;
- managed stream stop logs должны отличать `idle`, `unsubscribe`, `clear`, `client.close` и `permanent-error`, чтобы эксплуатация не теряла причину остановки;
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
- ошибки transport/read/parse отделены от доменных ошибок сервиса;
- snapshot quote endpoints принимают instruments-only контракт, если это зафиксировано для клиента; перед upstream вызовом internal instruments всегда нормализуются в TS symbol format;
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
- ограничения сервиса отражены в документации, а не только в коде;
- worker не добавляет новый test coverage внутри обычного функционального блока; если review принимает блок, architect при необходимости создаёт отдельный test-block.

Минимум для stream-изменения:

1. `subscribe` поднимает или reuse-ит upstream stream.
2. События приходят в нужный event channel.
3. `touch` продлевает жизнь подписки.
4. `unsubscribe` очищает downstream subscription.
5. После последнего unsubscribe upstream stream остановлен.
6. `client.close` и idle timeout не оставляют висящих подписок.
7. По логам можно восстановить lifecycle `subscribe -> touch -> unsubscribe/clear/client.close/idle -> stop`.

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

Архив review-заключений по закрытым блокам перенесён в `doc/changelog.md`.

### Заключение: Блок 16 — Managed Level II streams for metaterminal

Статус: passed with notes
Проблемы: live TradeStation runtime smoke для `stream/quotes` и `stream/matrix` в этом workspace не запускался.
Задачи:

- `stream/quotes` и `stream/matrix` получили явный contract metadata, action validation, независимые stream keys и stop diagnostics
- lifecycle stop semantics теперь видны по `api.start` / `api.done` с различимым `streamKey` и `status`

### Заключение: Блок 17 — Tickbars contract and diagnostics parity

Статус: passed with notes
Проблемы: live TradeStation runtime smoke для `marketdata/tickbars` в этом workspace не запускался.
Задачи:

- `marketdata/tickbars` теперь валидирует `symbol`, `interval`, `bars`, логирует `api.start` / `ts.request.done` / `api.done` и использует корректный v2 stream path
- endpoint читает JSON-lines stream и возвращает parsed packet array вместо прежнего broken passthrough

### Заключение: Блок 18 — Options API style alignment

Статус: passed with notes
Проблемы: live TradeStation runtime smoke для option snapshot methods в этом workspace не запускался.
Задачи:

- `application/api/options/strikes.js`, `application/api/options/expirations.js`, `application/api/options/riskreward.js` и `application/api/options/spreadtypes.js` получили явные contract fields и predictable domain validation where applicable
- legacy option wrappers приведены к более uniform snapshot style без изменения business meaning endpoint-ов

### Заключение: Блок 19 — Position current normalization for placeorder

Статус: failed
Проблемы:

- [P1] `lib.utils.normalizePositionSymbol()` не идемпотентен для internal OPT symbol. `CRWV 280121C80` нормализуется в `CRWV280121C00080000`, но повторная нормализация `CRWV280121C00080000` даёт `CRWV280121C80000000`, а следующий прогон ещё сильнее портит strike. В `placeorder` symbol нормализуется до lookup, а `domain.ts.positions.getPosition()` нормализует вход ещё раз, поэтому для опционов canonical lookup может промахиваться даже после исправления T-025.
- [P2] Order path всё ещё принимает `current = 0` на `position === null` только по cache miss и `console.info`, без подтверждения verified absence. Это лучше прежнего silent auto-create, но не полностью закрывает invariant из T-025 для критичного определения `TradeAction`.
- Live TradeStation runtime smoke для position snapshot / stream / order placement в этом workspace не запускался.

Задачи:

- Создать следующий блок на исправление idempotent symbol normalization и verified absence semantics для order placement.

### Заключение: Блок 20 — Idempotent position symbol normalization

Статус: failed
Проблемы:

- [P1] `application/lib/ts/placeorder.js` вычисляет `instrumentType`, но всё ещё вызывает `lib.utils.getAction(instrument, qty, current)` с исходным `instrument`. Если caller присылает `{ symbol, asset_category: 'OPT' }`, `getAction()` не видит `instrument.type === 'OPT'` и возвращает stock action. Воспроизведение: `getAction({ symbol: 'CRWV280121C00080000', asset_category: 'OPT' }, -1, 1)` возвращает `Sell`, а должен быть `SELLTOCLOSE`.
- Live TradeStation runtime smoke для option symbol normalization, position registry, order execution и marketdata/request formatting в этом workspace не запускался.

Задачи:

- `lib.utils` теперь держит единый parser/formatter для STK и OPT, а `makeSymbol()` / `makeTSSymbol()` работают idempotently на display и internal OPT form
- `application/lib/ts/readOptionChain.js`, `application/api/marketdata/quotes.js`, `application/api/marketdata/barcharts.js`, `application/api/stream/quotes.js`, `application/api/stream/matrix.js`, `application/api/orderexecution/order.js`, `application/lib/ts/placeorder.js` и `application/domain/ts/positions.js` используют общий symbol contract вместо локальных ручных сборок
- regression coverage в `application/test/run.js` теперь проверяет idempotent normalization, shared canonical option symbol contract и shared formatter usage in order / quotes paths
- Создать T-029 на передачу нормализованного instrument type в `getAction()` и regression coverage для option close actions с `asset_category`.

### Заключение: Блок 21 — Matrix instruments contract parity

Статус: passed with notes
Проблемы: live TradeStation runtime smoke для `stream/matrix` в этом workspace не запускался.
Задачи:

- `application/api/stream/matrix.js` теперь принимает `instruments = []` вместо public `symbol` / `type`
- empty subscribe input возвращает `EINSTRUMENTS`, как `application/api/stream/quotes.js`
- lifecycle `subscribe` / `touch` / `unsubscribe`, `streamKey`, `idleMs`, trace fields и stop reason propagation сохранены
- regression coverage подтверждает instruments-only input и построение matrix stream key из первого валидного инструмента

### Заключение: Блок 22 — Order action type normalization

Статус: passed with notes
Проблемы:

- Live TradeStation runtime smoke для option order placement в этом workspace не запускался.
- [P2] Во время review найден unrelated regression в `application/api/marketdata/barcharts.js`: endpoint читает `instrument.asset_category` до проверки `instrument`, поэтому `{ instrument: null }` даёт `TypeError` вместо `DomainError('EINSTRUMENT')`. Создана T-030.

Задачи:

- `application/lib/ts/placeorder.js` теперь передаёт в `getAction()` instrument с нормализованным `type`, полученным из canonical parse или `asset_category`
- option close / buyback actions корректно определяются для caller-ов, которые присылают только `asset_category`
- `makeTSSymbol()` / `makeSymbol()` contract не изменён, `data.Symbol` остаётся TradeStation upstream format
- regression coverage в `application/test/run.js` подтверждает `SELLTOCLOSE` для OPT close path с `asset_category`

### Заключение: Блок 23 — Barcharts invalid instrument guard

Статус: passed with notes
Проблемы: live TradeStation runtime smoke для `marketdata/barcharts` в этом workspace не запускался.
Задачи:

- `application/api/marketdata/barcharts.js` теперь проверяет `instrument` до чтения `asset_category`, поэтому null/empty input стабильно возвращает `DomainError('EINSTRUMENT')`
- symbol contract сохранён: `makeSymbol()` остаётся canonical back/metaterminal parser, `makeTSSymbol()` остаётся TradeStation upstream formatter
- regression coverage в `application/test/run.js` подтверждает `DomainError('EINSTRUMENT')` для `instrument: null` и пустого `symbol`

Новые заключения добавляются сюда только для текущего активного цикла.

### Заключение: Блок 24 — Matrix compact symbol parsing guard

Статус: passed with notes
Проблемы: live TradeStation runtime smoke для `stream/matrix` в этом workspace не запускался.
Задачи:

- `application/api/stream/matrix.js` больше не читает `instruments[0].symbol` до contract guard-а и сохраняет компактный lifecycle без лишних промежуточных сущностей
- пустой, malformed или частично invalid `instruments` теперь возвращает `DomainError('EINSTRUMENTS')`; первый валидный инструмент wins
- upstream matrix routing и `streamKey` используют `tsSymbol`, а downstream `stream/levelII` packet остаётся на canonical `symbol`
- regression coverage в `application/test/run.js` подтверждает empty, malformed и first-invalid/second-valid cases, а также canonical payload formatting

### Заключение: Блок 25 — Stream API compact contract alignment

Статус: failed
Проблемы:

- [P2] `application/api/stream/addBarchart.js` маршрутизирует upstream по TradeStation `tsSymbol`, но downstream `stream/barchart` event тоже отдаёт `symbol: chartSymbol`. Для OPT это будет `CRWV 280121C80`, а audit-критерий T-035 требует canonical back symbol в downstream metaterminal events. Regression coverage сейчас проверяет только upstream endpoint/key и не ловит event payload.
- Live TradeStation runtime smoke для `stream/quotes`, `stream/addBarchart` и `stream/clear` в этом workspace не запускался.

Задачи:

- `application/api/stream/quotes.js` стал compact contract-first batch API: `instruments = null` и пустые/invalid subscribe inputs возвращают `DomainError('EINSTRUMENTS')`, а `unsubscribe` / `touch` продолжают работать по `streamKey`
- `application/api/stream/quotes.js` продолжает batch-capable flow с общим symbol contract и стабильным TS key из нескольких instruments
- `application/api/stream/addBarchart.js` сохраняет public `symbol` contract как явный API shape и нормализует его в TradeStation `tsSymbol` через общий parser before routing
- `application/api/stream/clear.js` получил явные `parameters` / `returns` metadata без усложнения lifecycle и по-прежнему очищает подписки через `unsubscribeAll({ reason: 'clear' })`
- `application/test/run.js` покрывает empty subscribe, invalid action, key-based unsubscribe/touch, stable batch key, normalized barchart symbol, and clear return shape
- Создать T-036 на canonical `stream/barchart` event payload и соответствующий regression test.

### Заключение: Блок 26 — Barchart stream canonical event symbol

Статус: passed with notes
Проблемы: live TradeStation runtime smoke для `stream/addBarchart` в этом workspace не запускался.
Задачи:

- `application/api/stream/addBarchart.js` теперь маршрутизирует upstream по `tsSymbol`, но downstream `stream/barchart` event отдаёт canonical back/metaterminal symbol
- public `symbol` contract сохранён: canonical back input и TS-style input оба нормализуются в один и тот же downstream canonical payload
- regression coverage в `application/test/run.js` подтверждает canonical `stream/barchart` payload для TS-style input и TS upstream routing для canonical input
