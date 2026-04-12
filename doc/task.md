# Task

## Правила ведения документа

### Структура и нумерация

- Каждая задача получает ID: `T-NNN` (три цифры, сквозная нумерация без сброса)
- Задачи группируются в **блоки** — логически завершённые наборы изменений
- Один блок = одна единица работы worker-а, после которой проводится review
- После review в конце блока указывается раздел `### Review`, куда записывается заключение
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

**Что переносится в архив** (`doc/archive/tasks-cycle-N.md`):

- Все задачи `[x]` и `[!]` старше последнего завершённого блока
- Формат архивной строки: `T-NNN | title | [x] | дата | краткий итог`

**Что остаётся в task.md**:

- Все задачи `[ ]` и `[~]`
- Задачи `[x]` из последнего завершённого блока (до следующего review)
- Текущий активный блок целиком

**Правило архивной строки**: одна строка на задачу, без кода, без деталей реализации. Только факт и результат.

---

## Блок 1: OPT symbol format + stream error handling

**Цель блока**: устранить `INVALID SYMBOL` ошибки для опционных символов и прекратить бесконечный reconnect на перманентные ошибки.

**Контекст**: лог `log/2026-04-11-W1.log` показывает, что 9 из 10 OPT-подписок получают `FAILED, INVALID SYMBOL` от TradeStation. Причина — `makeTSSymbol` обрезает ведущие нули в месяце и дне: `CRWV281201C80000` → `CRWV 28121C80` вместо `CRWV 281201C80`. После ошибки stream reconnect-ится бесконечно к заведомо невалидному символу.

**Файлы блока**: `application/lib/utils.js`, `application/lib/ts/stream.js`, `application/domain/ts/streams.js`, `application/api/stream/quotes.js`

**Порядок выполнения**: T-001, затем T-002, затем T-003.

**После блока**: review архитектором.

---

### T-001: Убрать обрезку ведущих нулей в `makeTSSymbol`

**Статус**: `[x]`

**Файл**: `application/lib/utils.js`

**Поведение до**: функция `makeTSSymbol` (строки 133–145) обрезает ведущие нули из месяца и дня при конвертации internal → TS format:

```js
const month = date.slice(2, 4).replace(/^0/, '');
const day = date.slice(4, 6).replace(/^0/, '');
```

Результат: `CRWV281201C80000` → `CRWV 28121C80` (5 символов в дате вместо 6). TradeStation отвечает `FAILED, INVALID SYMBOL`.

**Поведение после**: убрать оба `.replace(/^0/, '')`. Конвертация должна сохранять полный формат YYMMDD:

```js
const month = date.slice(2, 4);
const day = date.slice(4, 6);
```

Результат: `CRWV281201C80000` → `CRWV 281201C80` (корректный TS формат).

**Ограничения**:

- Не менять `makeSymbol`, `convertSymbol` и остальные функции в `utils.js`
- Не менять формат strike (деление на 1000 корректно)
- Не менять обработку STK-символов

**Критерии завершения**:

- `makeTSSymbol('CRWV281201C80000', 'OPT')` возвращает `'CRWV 281201C80'`
- `makeTSSymbol('FSLR260618C270000', 'OPT')` возвращает `'FSLR 260618C270'`
- `makeTSSymbol('GLNG270115C55000', 'OPT')` возвращает `'GLNG 270115C55'`
- `makeTSSymbol('FSLR261218C270000', 'OPT')` возвращает `'FSLR 261218C270'` (без регрессии)
- `npm run lint` и `npm run types` проходят

---

### T-002: Не reconnect-ить на перманентные ошибки в stream

**Статус**: `[x]`

**Файл**: `application/lib/ts/stream.js`

**Поведение до**: метод `handlePacket` (строки 89–94) при любом `packet.Error` вызывает `scheduleReconnect()`. Для `FAILED, INVALID SYMBOL` это создаёт бесконечный reconnect-цикл (5s → 10s → 20s → 60s max) к символу, который никогда не станет валидным.

**Поведение после**: разделить ошибки на перманентные и транзиентные. Для перманентных — `stopStream()` вместо `scheduleReconnect()`.

Перманентные ошибки (не reconnect-ить):

- `Error` содержит `'INVALID SYMBOL'`
- `Error` содержит `'INVALID'` в сочетании с отсутствием `'GoAway'`

Реализация в `handlePacket`:

```js
if (packet.Error) {
  const errorText = packet.Error + ' ' + (packet.Message ?? '');
  console.error('Stream error:', this.endpointName(), errorText);
  if (onError) onError(packet);
  const permanent = /INVALID/i.test(packet.Error);
  if (permanent) {
    this.stopStream();
  } else {
    void this.scheduleReconnect();
  }
  return false;
}
```

**Ограничения**:

- `GoAway` по-прежнему reconnect-ится (это штатное серверное переключение)
- Heartbeat timeout по-прежнему reconnect-ится
- HTTP-ошибки в `initiateStream` (catch block) по-прежнему reconnect-ятся
- Не менять `processStream`, `checkTimeout`, `scheduleReconnect`

**Критерии завершения**:

- При получении `{ Error: 'FAILED, INVALID SYMBOL' }` — поток останавливается, в логе нет `Reconnecting in...`
- При получении `{ StreamStatus: 'GoAway' }` — поток по-прежнему reconnect-ится
- При обрыве соединения — поток по-прежнему reconnect-ится
- `npm run lint` и `npm run types` проходят

---

### T-003: Нормализация TS error packet в `onError` и `serializeError`

**Статус**: `[x]`

**Файлы**: `application/domain/ts/streams.js`, `application/api/stream/quotes.js`

**Поведение до**: TradeStation отправляет ошибку как plain object `{ Symbol: 'CRWV 28121C80', Error: 'FAILED, INVALID SYMBOL' }`. Два места обрабатывают это некорректно:

1. `streams.js` → `serializeError` (строки 26–37): объект не является `Error` и не имеет `.message`. Попадает в `String(error?.message ?? error)` → `"[object Object]"`.
2. `quotes.js` → `onError` (строка 36): передаёт raw packet в `notifyError` без нормализации.

**Поведение после**:

1. В `serializeError` (`streams.js`): добавить проверку на TS-пакет перед финальным fallback:

```js
serializeError(error) {
  if (error instanceof Error) {
    return { message: error.message, name: error.name, stack: error.stack };
  }
  if (typeof error === 'string') return { message: error };
  if (error?.Error) return { message: error.Error, symbol: error.Symbol || null };
  return { message: String(error?.message ?? error) };
},
```

2. В `onError` (`quotes.js`): нормализовать ошибку перед передачей:

```js
const onError = (error) => {
  const message = error?.Error || error?.message || String(error);
  console.error('stream quote error:', message, error?.Symbol || '');
  notifyError(error);
};
```

**Ограничения**:

- Не менять сигнатуру `notifyError` и `serializeError`
- Не менять `emit` и другие методы `streams.js`
- Формат `stream/error` payload должен оставаться `{ kind, streamKey, error: { message, ... } }`

**Критерии завершения**:

- При TS-ошибке `{ Symbol: 'X', Error: 'FAILED, INVALID SYMBOL' }`: в логе — читаемое сообщение, не `[object Object]`
- `serializeError({ Error: 'test', Symbol: 'SYM' })` возвращает `{ message: 'test', symbol: 'SYM' }`
- `serializeError(new Error('test'))` по-прежнему возвращает `{ message: 'test', name: 'Error', stack: ... }`
- `npm run lint` и `npm run types` проходят

---

## Блок 2: metaterminal-owned stream lifecycle + snapshots

**Цель блока**: закрепить контракт, при котором `metaterminal` управляет количеством нужных stream-подписок, а `ts_connect` безопасно держит managed streams, отключает забытые подписки через idle timeout и предоставляет snapshot-альтернативу для опционных котировок.

**Контекст**: лог `log/2026-04-11-W1.log` после выполнения Блока 1 показывает, что OPT symbols стали корректными и `INVALID SYMBOL` reconnect больше не виден. При этом `metaterminal` может открыть несколько отдельных `marketdata/stream/quotes/{symbol}` upstream stream-ов по разным инструментам или повторно запрашивать один инструмент. `ts_connect` не должен сам решать, какие инструменты заменить или закрыть: управляющий модуль здесь сервер `metaterminal`, и именно он должен вести список нужных инструментов/графиков и их количество.

Согласованный safety contract: `defaultIdleMs: 2 * 60 * 1000` остается защитой от забытых подписок. Пока график/инструмент нужен, `metaterminal` обязан слать `touch` по соответствующему `streamKey` до истечения TTL; когда инструмент больше не нужен, он должен отправить `unsubscribe` или `stream/clear`.

В том же логе `marketdata/barcharts` snapshot-запросы занимали от 0.312s до 6.070s. Есть повторные идентичные запросы по `CRWV 280121C175`, `CRWV 280121C80`, `CRWV 280121P35`, `CRWV 280121P60`, поэтому часть задержек можно убрать дедупликацией in-flight запросов и коротким cache TTL. Для опционных котировок, которые не требуют постоянного realtime-потока, нужно использовать snapshot endpoint `GET /v3/marketdata/quotes/{symbols}` через local API `marketdata/quotes`.

**Файлы блока**: `application/api/stream/quotes.js`, `application/domain/ts/streams.js`, `application/api/marketdata/quotes.js`, `application/api/marketdata/barcharts.js`, `application/domain/ts/*` или `application/lib/ts/*` для barcharts cache/diagnostics, `doc/review.md`

**Порядок выполнения**: T-004, затем T-005, затем T-006, затем T-007.

**После блока**: review архитектором.

---

### T-004: Закрепить metaterminal-owned lifecycle для `stream/quotes`

**Статус**: `[x]`

**Файлы**: `application/api/stream/quotes.js`, `application/domain/ts/streams.js`

**Поведение до**: каждый новый `subscribe` с новым `streamKey` создает или переиспользует отдельный quote stream. Повторный `subscribe` с тем же `streamKey` и тем же Metacom client является idempotent и фактически продлевает idle timer, но не ведет ref-count по количеству UI-потребителей внутри `metaterminal`.

**Поведение после**: сохранить multi-subscription поведение и явно зафиксировать контракт в коде/документации метода:

- `ts_connect` хранит подписку на уровне `client + kind + streamKey`, а не на уровне отдельных вкладок/виджетов `metaterminal`;
- `metaterminal` сам ведет ref-count или список потребителей по инструментам;
- если инструмент нужен, `metaterminal` шлет `subscribe`/`touch` до истечения `defaultIdleMs`;
- если инструмент больше не нужен, `metaterminal` шлет `unsubscribe` для конкретного `streamKey`;
- если нужно закрыть все подписки клиента, `metaterminal` вызывает `stream/clear`.

**Ограничения**:

- Не добавлять `replace` или другую автоматическую политику “закрыть старые инструменты при новом subscribe”.
- Не добавлять ref-count внутри `ts_connect`: количество потребителей одного инструмента принадлежит `metaterminal`.
- Для multi-symbol подписки key по-прежнему строится из отсортированных TS symbols через `Array.from(new Set(symbols)).sort().join(',')`.
- Не переносить stream state в API-слой; использовать `domain.ts.streams`.
- Сохранить защиту через `defaultIdleMs: 2 * 60 * 1000`.

**Критерии завершения**:

- Повторный `subscribe`/`touch` по тому же `streamKey` продлевает TTL и не создает лишний upstream stream.
- Новый `subscribe` по другому `streamKey` не закрывает старые quote streams.
- `unsubscribe` по конкретному `streamKey` закрывает только эту подписку клиента.
- `stream/clear` закрывает все managed subscriptions текущего клиента.
- Без `touch` подписка закрывается idle cleanup после `defaultIdleMs`.
- `npm run types` проходит; eslint/prettier для изменённых файлов проходят.

---

### T-005: Добавить stop reason diagnostics для managed streams

**Статус**: `[x]`

**Файлы**: `application/domain/ts/streams.js`, `application/lib/ts/stream.js`

**Поведение до**: в логе видно `Stopping stream...` и `Stream stopped gracefully...`, но не видно причину: idle timeout, explicit unsubscribe, `stream/clear`, `client.close` или permanent upstream error.

**Поведение после**: при остановке managed stream логировать причину на domain-уровне и, если нужно, прокидывать ее до upstream stop.

Минимальные причины:

- `idle`;
- `unsubscribe`;
- `client.close`;
- `permanent-error`;
- `clear`;
- `unknown`.

**Ограничения**:

- Не засорять high-frequency data path: не логировать каждый quote packet.
- Не менять публичный event payload `stream/quote`, `stream/barchart`, `stream/error`.
- `GoAway` остается транзиентным событием и не должен логироваться как permanent stop.

**Критерии завершения**:

- По логу можно отличить idle cleanup от ручного unsubscribe, `stream/clear` и `client.close`.
- При permanent `INVALID SYMBOL` видно, что stream остановлен по permanent error, а не ушел в reconnect.
- `npm run types` проходит; eslint/prettier для изменённых файлов проходят.

---

### T-006: Поддержать OPT snapshot quotes через `marketdata/quotes`

**Статус**: `[x]`

**Файл**: `application/api/marketdata/quotes.js`

**Поведение до**: `marketdata/quotes` принимает `symbols` и отправляет их в `GET /v3/marketdata/quotes/{symbols}` через `.toUpperCase()`. Для опционов это работает только если вызывающий код уже передал TradeStation symbol format, например `CRWV 280121C80`. Новый контракт с `metaterminal` должен передавать только internal `instruments`, например `{ symbol: 'CRWV280121C80000', asset_category: 'OPT' }`, чтобы `ts_connect` сам нормализовал символ.

**Поведение после**: перевести `marketdata/quotes` на instruments-only контракт:

- принимать только `instruments: [{ symbol, asset_category }]`, используя `lib.utils.makeTSSymbol(symbol, asset_category)`;
- не поддерживать legacy `symbols`; `metaterminal` всегда присылает `instruments`;
- нормализовать и дедуплицировать итоговый список TS symbols;
- использовать upstream snapshot endpoint `GET /v3/marketdata/quotes/{symbols}`.

**Ограничения**:

- Не создавать stream.
- Не менять response shape TradeStation snapshot: `{ Quotes, Errors }`.
- Не проглатывать `Errors` из snapshot response; клиент должен видеть частичный успех и `FAILED, INVALID SYMBOL`.
- Максимум upstream API: до 100 symbols в одном request по OpenAPI.

**Критерии завершения**:

- `api.marketdata.quotes({ instruments: [{ symbol: 'CRWV280121C80000', asset_category: 'OPT' }] })` вызывает upstream с `CRWV 280121C80`.
- Повторяющиеся instruments не дублируются в upstream path.
- `npm run types` проходит; eslint/prettier для изменённых файлов проходят.

---

### T-007: Дедуплицировать повторные `marketdata/barcharts` snapshot-запросы

**Статус**: `[x]`

**Файл**: `application/api/marketdata/barcharts.js` и общий helper в `application/domain/ts/*` или `application/lib/ts/*`

**Поведение до**: каждый `api/marketdata/barcharts` вызов сразу делает upstream `GET /v3/marketdata/barcharts/{symbol}`. В логе есть повторные идентичные запросы с теми же `symbol`, `interval`, `unit`, `barsback`, `sessiontemplate`, например `CRWV 280121C175` несколько раз меньше чем за минуту.

**Поведение после**: добавить in-flight single-flight и короткий TTL cache для barcharts snapshot-ов по ключу:
`symbol + interval + unit + barsback + sessiontemplate`.

Также `marketdata/barcharts` должен принимать только `instrument`:

- один request = один график = один инструмент;
- `instrument` — объект с `symbol` и `asset_category`;
- `ts_connect` сам конвертирует internal OPT/STK symbol в TradeStation format через `lib.utils.makeTSSymbol`;
- массив `instruments` не используется в этом endpoint-е; если `metaterminal` строит несколько графиков, он отправляет несколько отдельных request-ов.

Рекомендуемое поведение:

- если идентичный upstream request уже выполняется, следующий клиентский вызов ждет тот же Promise;
- если идентичный ответ есть в коротком TTL cache, вернуть его без нового upstream request;
- TTL сделать консервативным, например 5-15 секунд, чтобы не подменить live-данные надолго;
- завершённые snapshot-ответы хранить в Redis через `application/db/redis/get.js` и `application/db/redis/set.js`; local `Map` допустим только для in-flight Promise single-flight внутри текущего процесса;
- ошибки upstream не кешировать.

**Ограничения**:

- Не кешировать stream endpoints.
- Не принимать несколько инструментов в одном barcharts request: один request = один график = один TradeStation barcharts symbol.
- Не менять response shape `marketdata/barcharts`.
- Не скрывать upstream ошибки под пустой массив.
- Добавить duration logging для barcharts upstream request, чтобы следующий лог показывал фактическую задержку без ручного сопоставления строк.

**Критерии завершения**:

- Два одновременных одинаковых barcharts запроса создают один upstream request.
- Повторный одинаковый запрос внутри TTL возвращается без нового upstream request.
- Запрос после истечения TTL снова идет в TradeStation.
- При upstream error cache entry очищается.
- `api.marketdata.barcharts({ instrument: { symbol: 'CRWV280121C80000', asset_category: 'OPT' }, period: 900, limit: 100 })` запрашивает upstream `CRWV 280121C80`.
- Вызов без `instrument` возвращает domain error.
- `npm run types` проходит; eslint/prettier для изменённых файлов проходят.

---

## Блок 3: review fixes — quotes contract + misleading log

**Цель блока**: устранить два дефекта, найденных при review Блоков 1–2.

**Контекст**: review по checklist выявил: (1) `marketdata/quotes.js` бросает `throw Error` на пустой instruments-only вход вместо `DomainError` с кодом; (2) `streams.js` логирует `Managed stream stop:` при удалении одного подписчика, хотя stream продолжает работать.

**Файлы блока**: `application/api/marketdata/quotes.js`, `application/domain/ts/streams.js`

**Порядок выполнения**: T-008, затем T-009.

**После блока**: review архитектором.

---

### T-008: Добавить `errors` block и `DomainError` в `marketdata/quotes`

**Статус**: `[x]`

**Файл**: `application/api/marketdata/quotes.js`

**Поведение до**: строка 23 — `throw new Error('Symbols are required')`. Это предсказуемая клиентская ошибка валидации, но она возвращается как internal error (500) вместо стабильного domain-кода. В instruments-only контракте `marketdata/quotes` должен возвращать код, связанный с отсутствием instruments.

**Поведение после**: добавить блок `errors` и заменить `throw Error` на `return new DomainError`:

```js
errors: {
  EINSTRUMENTS: 'At least one instrument is required',
},
```

В `method`: заменить строку 23:

```js
// было:
if (tsSymbols.length === 0) throw new Error('Symbols are required');
// стало:
if (tsSymbols.length === 0) return new DomainError('EINSTRUMENTS');
```

**Ограничения**:

- Не менять остальную логику метода (batching, merge, instruments support)
- Не менять `parameters` и `returns` (оставить `'json'`)
- Не добавлять `.d.ts` в этом блоке

**Критерии завершения**:

- `api.marketdata.quotes({})` возвращает `DomainError` с code `EINSTRUMENTS`, а не 500
- `api.marketdata.quotes({ instruments: [{ symbol: 'MSFT', asset_category: 'STK' }] })` работает
- `npm run lint` и `npm run types` проходят

---

### T-009: Исправить ложный `logStop` при unsubscribe с оставшимися подписчиками

**Статус**: `[x]`

**Файл**: `application/domain/ts/streams.js`

**Поведение до**: метод `unsubscribe` (строка 136) вызывает `this.logStop(...)` даже когда `subscribers > 0`, т.е. stream **не останавливается**. Лог `Managed stream stop: quotes:KEY reason=unsubscribe subscribers=2` вводит в заблуждение, создавая впечатление, что stream остановлен.

**Поведение после**: заменить `logStop` на отдельный `logUnsubscribe` для случая, когда stream продолжает работать:

Добавить метод:

```js
logUnsubscribe({ kind, key, reason, remaining }) {
  console.info(`Subscriber removed: ${kind}:${key} reason=${reason} remaining=${remaining}`);
},
```

В `unsubscribe`, строка 136 (ветка `subscribers > 0`):

```js
// было:
this.logStop({ kind, key, reason, clientCount: subscribers });
// стало:
this.logUnsubscribe({ kind, key, reason, remaining: subscribers });
```

`logStop` остаётся только в `stopEntry` — вызывается когда stream **реально** останавливается.

**Ограничения**:

- Не менять `stopEntry`, `subscribe`, `touch`, `unsubscribeAll`
- Не менять формат `logStop` (он по-прежнему используется в `stopEntry`)
- Не менять поведение unsubscribe — только лог

**Критерии завершения**:

- При unsubscribe одного из двух подписчиков: лог `Subscriber removed: quotes:KEY reason=unsubscribe remaining=1`
- При unsubscribe последнего подписчика: лог `Managed stream stop: quotes:KEY reason=unsubscribe subscribers=0`
- `npm run lint` и `npm run types` проходят

---

## Блок 4: Диагностическое логирование для контрольного запуска

**Цель блока**: добавить точечные диагностические логи, чтобы контрольный запуск показал корректность всех исправлений Блоков 1–3.

**Контекст**: все задачи T-001 → T-009 выполнены. Перед production-деплоем нужен один контрольный прогон, в котором по логу однозначно видно:

- OPT символы конвертируются с полным YYMMDD (T-001 fix)
- permanent ошибки не порождают reconnect (T-002 fix)
- TS error packets сериализуются читаемо (T-003 fix)
- stream subscribe/unsubscribe/idle lifecycle работает корректно (T-004, T-005, T-009)
- barcharts single-flight и cache работают (T-007)

**Файлы блока**: `application/lib/utils.js`, `application/lib/ts/stream.js`, `application/domain/ts/streams.js`, `application/domain/ts/barcharts.js`

**Порядок выполнения**: T-010.

**После блока**: контрольный запуск → review архитектором.

---

### T-010: Добавить диагностические логи для контрольного запуска

**Статус**: `[x]`

**Файлы и точки логирования**:

**1. `application/lib/utils.js` — `makeTSSymbol`**

После строки 142 (return), перед return добавить debug-лог:

```js
makeTSSymbol(symbol, type = 'STK') {
  if (type === 'STK') return symbol.toUpperCase();
  if (type === 'OPT') {
    const match = symbol.match(/^([A-Z]+)(\d{6})([CP])(\d+(?:\.\d+)?)$/i);
    if (!match) throw new Error('Invalid option symbol format');
    const [, sym, date, cp, strike] = match;
    const year = date.slice(0, 2);
    const month = date.slice(2, 4);
    const day = date.slice(4, 6);
    const tsSymbol = sym.toUpperCase() + ' ' + year + month + day + cp.toUpperCase() + parseFloat(strike) / 1000;
    console.debug('makeTSSymbol:', symbol, '->', tsSymbol, 'date:', year + month + day, 'len:', (year + month + day).length);
    return tsSymbol;
  }
  throw new Error('Unsupported instrument type');
},
```

Что увидим в логе:

- `makeTSSymbol: CRWV281201C80000 -> CRWV 281201C80 date: 281201 len: 6` — корректно
- Если `len` не 6 — **несоответствие**, символ будет отвергнут TS

**2. `application/lib/ts/stream.js` — `handlePacket` error classification**

После строки 93 (`const permanent = ...`), добавить лог решения:

```js
if (packet.Error) {
  const errorText = `${packet.Error} ${packet.Message ?? ''}`.trim();
  console.error('Stream error:', this.endpointName(), errorText);
  if (onError) onError(packet);
  const permanent = /INVALID/i.test(packet.Error) && !/GoAway/i.test(errorText);
  console.warn('Stream error classification:', this.endpointName(), permanent ? 'PERMANENT -> stop' : 'TRANSIENT -> reconnect');
  if (permanent) {
    this.stopStream('permanent-error');
    return false;
  }
  void this.scheduleReconnect();
  return false;
}
```

Что увидим в логе:

- `Stream error classification: marketdata/stream/quotes/X PERMANENT -> stop` — ок, не будет reconnect
- `Stream error classification: marketdata/stream/quotes/X TRANSIENT -> reconnect` — reconnect ожидаем

**3. `application/domain/ts/streams.js` — subscribe lifecycle**

В методе `subscribe`, после создания entry (строка 174, после `bucket.set(key, entry)`), добавить:

```js
console.info(`Stream subscribe: ${kind}:${key} created=${created} subscribers=${entry.subscribers.size + (subscribed ? 1 : 0)}`);
```

Вставить перед `return` на строке 223:

```js
const state = this.touch({ kind, key, client, idleMs });
console.info(
  `Stream subscribe: ${kind}:${key} created=${created} subscribed=${subscribed} total=${state.subscribers} idleMs=${state.idleMs}`,
);
return { ...state, created, subscribed, metadata: entry.metadata };
```

Что увидим в логе:

- `Stream subscribe: quotes:CRWV 281201C80 created=true subscribed=true total=1 idleMs=120000` — новая подписка
- `Stream subscribe: quotes:CRWV 281201C80 created=false subscribed=false total=1 idleMs=120000` — touch/reuse

**4. `application/domain/ts/barcharts.js` — cache hit/miss/single-flight**

В методе `fetch`, добавить логи для каждой ветки:

```js
async fetch({ live = true, token, endpoint, symbol, data = {}, ttlMs = this.defaultTtlMs }) {
  const key = this.buildKey({ symbol, data });
  const cached = await this.getCached({ key });
  if (cached !== null) {
    console.debug('barcharts cache HIT:', symbol);
    return cached;
  }

  const pending = this.pending.get(key);
  if (pending) {
    console.debug('barcharts single-flight REUSE:', symbol);
    return pending;
  }

  console.debug('barcharts cache MISS, fetching:', symbol);
  const request = (async () => {
    // ... existing code ...
  })();

  this.pending.set(key, request);
  return request;
},
```

Что увидим в логе:

- `barcharts cache HIT: CRWV 281201C80` — повторный запрос отдан из кеша
- `barcharts single-flight REUSE: CRWV 281201C80` — параллельный запрос ждёт тот же Promise
- `barcharts cache MISS, fetching: CRWV 281201C80` — новый upstream запрос

**5. `application/domain/ts/streams.js` — `serializeError` fallback warning**

Если `serializeError` попадает в финальный fallback `String(...)`, это значит ошибка не распознана — нужен `console.warn`:

```js
serializeError(error) {
  if (error instanceof Error) {
    return { message: error.message, name: error.name, stack: error.stack };
  }
  if (typeof error === 'string') return { message: error };
  if (error?.Error) return { message: error.Error, symbol: error.Symbol ?? null };
  const fallback = String(error?.message ?? error);
  console.warn('serializeError fallback:', fallback, 'original type:', typeof error);
  return { message: fallback };
},
```

Что увидим в логе:

- Если появится `serializeError fallback:` — значит есть необработанный формат ошибки, нужно добавить ветку

**Ограничения**:

- Все логи через `console.debug` или `console.warn` (не `console.log` и не `console.error` для штатных сценариев)
- Не менять бизнес-логику — только добавить логи
- Не менять формат response, payload, event
- Логи должны быть информативны без stack trace: символ, ключ, решение, длина даты
- После контрольного запуска debug-логи в `makeTSSymbol` и `barcharts` можно оставить (полезны для операций) или убрать отдельным блоком

**Критерии завершения**:

- При OPT символе в логе видно `makeTSSymbol: X -> Y date: YYMMDD len: 6`
- При INVALID SYMBOL в логе видно `PERMANENT -> stop` и нет `Reconnecting in...`
- При subscribe в логе видно `created=true/false` и `subscribed=true/false`
- При повторном barcharts запросе видно `cache HIT` или `single-flight REUSE`
- При unsubscribe видно `Subscriber removed` или `Managed stream stop`
- Нет `serializeError fallback:` для TS-пакетов с `.Error`
- `npm run lint` и `npm run types` проходят

---

## Блок 5: Barcharts period contract before control run

**Цель блока**: устранить найденный при review риск в `marketdata/barcharts`: unsupported `period` не должен молча превращаться в некорректные `interval/unit` для TradeStation.

**Контекст**: `application/api/marketdata/barcharts.js` сейчас принимает singular `instrument`, использует `domain.ts.barcharts.fetch` и Redis TTL cache, но локальная нормализация `period` осталась слабее, чем у `application/api/stream/addBarchart.js`. Примеры риска:

- `period = 30` даёт `interval = "0.5"`, хотя для `Minute` нужен целый interval;
- `period = 172800` не попадает ни в одну ветку и остаётся `unit = "Minute", interval = "1"`, хотя клиент запросил 2 дня;
- `period = 1209600` сейчас станет `Monthly`, хотя это 2 недели;
- для non-minute units TradeStation OpenAPI требует `interval = "1"`.

Этот блок нужно выполнить до контрольного запуска с T-010, чтобы диагностика проверяла уже корректный контракт.

**Файлы блока**: `application/api/marketdata/barcharts.js`, `application/api/stream/addBarchart.js`, при необходимости общий helper в `application/lib/utils.js`, `doc/review.md`

**Порядок выполнения**: T-011.

**После блока**: review архитектором, затем контрольный запуск с диагностическими логами T-010.

---

### T-011: Синхронизировать нормализацию `period` для snapshot и stream barcharts

**Статус**: `[x]`

**Файлы**: `application/api/marketdata/barcharts.js`, `application/api/stream/addBarchart.js`, при необходимости `application/lib/utils.js`

**Поведение до**: `marketdata/barcharts.js` строит `interval/unit` так:

```js
let interval = '1';
let unit = 'Minute';
if (periodValue < 86400) interval = (periodValue / 60).toString();
else if (periodValue === 86400) unit = 'Daily';
else if (periodValue === 604800) unit = 'Weekly';
else if (periodValue > 604800) unit = 'Monthly';
```

Это создаёт некорректные silent fallback-ы:

- нецелые minute intervals (`30 / 60 = 0.5`);
- периоды между day и week остаются `1 Minute`;
- периоды больше week всегда становятся `1 Monthly`, даже если это 2 недели;
- правила snapshot и stream barcharts расходятся.

**Поведение после**:

- Вынести нормализацию `period -> { interval, unit }` в общий helper, например `lib.utils.makeBarData` или `lib.utils.normalizeBarPeriod`.
- Использовать helper в `application/api/marketdata/barcharts.js`.
- По возможности использовать тот же helper в `application/api/stream/addBarchart.js`, чтобы snapshot и stream не расходились.
- Для `unit = 'Minute'`: принимать только `period >= 60`, кратный 60, interval `1..1440`.
- Для non-minute units: поддержать только ровно `86400 -> Daily`, `604800 -> Weekly`, `2592000 -> Monthly` с `interval = '1'`, если worker не найдёт в OpenAPI/существующем клиентском контракте явного основания для multi-interval non-minute bars.
- Для unsupported period возвращать `DomainError('EPERIOD')`, а не отправлять молчаливый default в TradeStation.

**Ограничения**:

- Не менять входной контракт `marketdata/barcharts`: один request = один график = singular `instrument`.
- Не менять response shape TradeStation barcharts.
- Не переносить TTL cache и `pending` single-flight из `domain.ts.barcharts` в `api`.
- Не менять Redis helpers.
- Если изменение затрагивает `application/api/stream/addBarchart.js`, синхронизировать `.d.ts` только если меняются коды ошибок; при сохранении `EPERIOD` `.d.ts` не менять.

**Критерии завершения**:

- `period = 900` даёт `{ interval: '15', unit: 'Minute' }`.
- `period = 86400` даёт `{ interval: '1', unit: 'Daily' }`.
- `period = 604800` даёт `{ interval: '1', unit: 'Weekly' }`.
- `period = 2592000` даёт `{ interval: '1', unit: 'Monthly' }`.
- `period = 30`, `period = 172800`, `period = 1209600` возвращают `DomainError('EPERIOD')`, если worker не обоснует поддержку этих периодов через OpenAPI/контракт.
- `marketdata/barcharts` по-прежнему вызывает `domain.ts.barcharts.fetch`.
- `npm run types` проходит; eslint/prettier для изменённых файлов проходят.

---

## Блок 6: Repository lint debt

**Цель блока**: закрыть unrelated lint debt, из-за которого полный `npm run lint` не проходит даже когда targeted checks по текущим изменениям успешны.

**Контекст**: при текущей проверке architect от 2026-04-12 `npm run types`, targeted eslint и targeted prettier проходят, но полный `npm run lint` падает на старых файлах вне основного изменения `barcharts/streams`. Этот долг уже мешает использовать `npm run lint` как итоговый merge gate.

**Файлы блока**:

- `application/api/account/activity.js`
- `application/api/account/balances.js`
- `application/api/account/historicalorders.js`
- `application/api/account/orders.js`
- `application/api/account/positions.js`
- `application/api/options/strikes.js`
- `application/api/orderexecution/cancelOrder.js`
- `application/api/orderexecution/order.js`
- `application/api/orderexecution/orderconfirm.js`
- `application/db/redis/get.js`
- `application/lib/ptfin/getContract.js`
- `application/lib/stream/optionsQuotes.js`
- `application/lib/stream/orders.js`
- `application/lib/stream/positions.js`
- `application/lib/ts/refresh.js`
- `application/lib/ts/start.js`

**Порядок выполнения**: T-012.

**После блока**: review architect, затем повторный полный `npm run lint`.

---

### T-012: Закрыть текущие full-lint errors без изменения бизнес-логики

**Статус**: `[x]`

**Файлы**: см. список файлов Блока 6.

**Поведение до**: `npm run lint` падает на 46 eslint errors:

- unused variables в `account/activity.js`, `options/strikes.js`, `orderexecution/orderconfirm.js`, `lib/stream/*`, `lib/ts/start.js`;
- `prefer-const` в `account/historicalorders.js`, `account/orders.js`, `orderexecution/cancelOrder.js`;
- `camelcase` в `orderexecution/order.js`, `orderexecution/orderconfirm.js`, `lib/ts/refresh.js`;
- trailing spaces в `account/balances.js`;
- missing final newline в `application/db/redis/get.js`;
- `curly` в `lib/ptfin/getContract.js`;
- `max-len` в `lib/stream/optionsQuotes.js`.

**Поведение после**:

- Полный `npm run lint` проходит.
- Изменения должны быть mechanical lint fixes без изменения бизнес-логики.
- Если lint-fix требует осознанного изменения публичного контракта или поведения endpoint-а, worker должен остановиться и отметить задачу `[!]` с описанием риска.

**Ограничения**:

- Не менять контракты API, response shape и TradeStation endpoint logic.
- Не переименовывать external payload fields, если это поля TradeStation или существующего клиента; для camelcase использовать локальную нормализацию или eslint-compatible destructuring, не ломая вход/выход.
- Не удалять переменные, если они нужны как часть planned signature; в таких случаях заменить на `_`-паттерн только если repo lint это допускает, иначе оставить задачу заблокированной с объяснением.
- Не трогать файлы Блоков 1–5 без необходимости.

**Критерии завершения**:

- `npm run lint` проходит целиком.
- `npm run types` проходит.
- `git diff` показывает только lint/mechanical changes.
