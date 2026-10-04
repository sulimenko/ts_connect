# T-072: защищённый execution/rules v1

`POST /api/execution/rules` использует существующий service boundary T-068:
`Authorization: Bearer <service-token>` и `X-Service-Identity`. Проверка проходит
до чтения credentials и любых сетевых запросов. Ошибка авторизации сохраняет
`{state: 'unauthorized'}`. Обычный Impress hook пишет только method/ip/verb.

## Запрос и ответы

```json
{
  "version": 1,
  "account": "EXT-1",
  "live": false,
  "credentials": {
    "pkey": "<client-id>",
    "secret": "<client-secret>",
    "refresh_token": "<refresh-token>"
  },
  "instrument": {
    "symbol": "MSFT",
    "assetCategory": "STK",
    "exchange": "NASDAQ",
    "currency": null
  }
}
```

`orderId` не требуется и не используется. Symbol задаётся в canonical формате
проекта; OPT преобразуется только через `lib.utils`. Exchange сравнивается точно
с SymbolDetails. `currency: null` допускается в запросе; для подтверждённой US
акции ответ содержит Currency из SymbolDetails. Клиентские source/exchange без
broker metadata ничего не доказывают.

Полный common v1 ответ содержит только `version`, `state: 'ready'`, `identity`,
`instrument`, `orders`, `quantity`, `price` и, при OAuth rotation, `accessUpdate`.
При подтверждённых обязательных rules adapter выдаёт ready даже без доказанного
finite maximum: согласно решению пользователя неизвестный upper bound становится
литеральной строкой `"infinity"`. Это wire policy, а не утверждение, что broker
принимает любой размер ордера.

- `identity`: `{terminal: 'TS', externalAccount: account, live: boolean}`.
- `instrument`: `{symbol, assetCategory, exchange, currency: string|null}`.
- `orders`: атомарные строки с полями `type`, `tif`, `session`, `extended`, `relation`,
  `orderClass`, `quantityMode`, `side`, `positionEffect`, `quantity`.
- `session`: `regular|pre_market|post_market|overnight`;
  `extended = (session !== 'regular')`. Только regular имеет доказательство
  для рассматриваемых Market/Day и Limit/Day; остальные session не рекламируются.
- Quantity каждой строки: `{fractional: boolean, minimum: string, step: string, maximum: string, minimumNotional}`.
  `fractional: false` согласован с `quantityMode: whole` в каждой строке.
  Для подтверждённых обычных ордеров в акциях используются explicit
  MinimumTradeQuantity/Increment, единица — shares; отдельный notional минимум
  не задаётся (`minimumNotional: null`). Finite maximum — только доказанная точная
  включительная broker граница в shares, без пересечения с представимостью T-068.
  Отсутствующий, undocumented или неподтверждённый upper bound — `"infinity"`.
- Общий `quantity`: `{fractional: false, minimum, step, maximum, minimumNotional: null}`.
  Formatter использует одни ограничения для обеих строк. В common v1
  null summary означает отсутствие единого значения между подтверждёнными
  строками. Отсутствующие minimum/step/fractional запрещают ready; исключение
  `unknown -> infinity` относится исключительно к maximum.
- `price`: `{rules: [{minInclusive, maxExclusive, tick, precision, rounding}]}`.

Authenticated malformed request, exception и неполные доказательства возвращают
`{version: 1, state: 'unavailable', reason: '<safe-code>'}` без частичных rules.
Возможные коды: `invalid_request`, `source_unavailable`, `account_unconfirmed`,
`instrument_unconfirmed`, `combination_unconfirmed`, `quantity_unconfirmed`,
`price_unconfirmed`. Категория вне STK/OPT возвращает
`{version: 1, state: 'unsupported', reason: 'execution_domain'}`.

## Доказательства и ограниченный submit domain

Каждый вызов выполняет OAuth refresh существующим execution transport, затем
только GET accounts, SymbolDetails и routes. Общий deadline — 18 секунд;
нет кэша, реестра rules, Back calls или PlaceOrder. AccountID должен точно
встречаться один раз в выбранной live/SIM среде. Для account proof нужны
Status=Active, AccountType=Cash/Margin и Currency=USD. Закрытый, ограниченный,
неподтверждённый account, pagination, partial errors и дубли запрещают ready.

SymbolDetails должен содержать ровно один symbol, точные AssetType/Exchange,
подтверждённую Currency, PriceFormat и QuantityFormat. Текущие сочетания доказаны
для US STOCK (STK), Country=United States, Currency=USD и Exchange
NASDAQ/NYSE/AMEX. Endpoint routes должен независимо подтвердить единственный
`Id: 'Intelligent'` с `AssetTypes: ['STOCK', ...]`. Совпадение Name при другом Id
не подтверждает default route.

Две доказанные комбинации для common v1 formatter (публикация требует полного
minimum/step/fractional/price proof; неизвестный maximum допускается):

| type   | tif | session | extended | relation | orderClass | quantityMode | side | positionEffect |
| ------ | --- | ------- | -------- | -------- | ---------- | ------------ | ---- | -------------- |
| market | day | regular | false    | NORMAL   | simple     | whole        | buy  | open           |
| limit  | day | regular | false    | NORMAL   | simple     | whole        | buy  | open           |

Это консервативный subset T-068. Ready не обещает buying power, исполнение или
fill; T-068 продолжает самостоятельно проверять позиции и intent. Options,
другие listing environments, стороны, position effects и TIF пока не имеют
полного combination proof в этом adapter и не рекламируются. Подтверждённый OPT
с неполной evidence возвращает unavailable. BRK/OCO и extended hours выключены;
fractional quantity не объявляется. Enum OrderType/Duration либо дополнительные
клиентские поля не расширяют строки. Capabilities, submit/lookup/recovery,
`restart_safe=false` и durable barriers Metaterminal не изменены.

Evidence для сочетаний (документация сверена 2026-10-04):

1. OpenAPI snapshot 2026-04-11, индекс [openapi_20260411.md](openapi_20260411.md):
   GetAccounts/Account (AccountID, Status, AccountType, Currency),
   GetSymbolDetails/SymbolDetail (Symbol, AssetType, Country, Exchange, Currency,
   PriceFormat, QuantityFormat), GetRoutes (Id/AssetTypes). `OrderRequest.Route`
   прямо задаёт Intelligent как default для stocks/options. Пример MSFT в
   SymbolDetails использован в broker fixture; он возвращает ready с
   `maximum: "infinity"`. Числовые значения minimum/step/price читаются из
   ответа, а не из примера. Официальная [API specification](https://api.tradestation.com/docs/specification/).
2. [Intelligent](https://help.tradestation.com/10_00/eng/tradestationhelp/routes/intelligent.htm)
   подтверждает coverage US NYSE/AMEX/Nasdaq stocks и conditional диапазон
   quantity 1–1 000 000; применимость диапазона рассмотрена отдельно ниже.
3. [Placing Orders from the Basket Order Window](https://help.tradestation.com/10_00/eng/tradestationhelp/basket/place_order_basket_order.htm)
   прямо связывает market и limit с Day и Intelligent; это совместное
   type/duration/route evidence, а не произведение enum-списков.
4. [Trade Bar Durations for Equities](https://help.tradestation.com/10_00/eng/tradestationhelp/tb_definitions/trade_bar_durations_equities.htm)
   определяет Day как regular session.
5. [.PlaceOrder Command](https://help.tradestation.com/10_00/eng/tradestationhelp/tb/placeorder_command.htm)
   содержит explicit Buy/Equity/Limit/Day example. Используется только как
   документальная evidence; ни этот command, ни любой order endpoint не вызывается.

### Результат исследования quantity maximum

Сырой OpenAPI snapshot 2026-04-11 подтверждает: `QuantityFormat` содержит
Format, Decimals, IncrementStyle, Increment, IncrementSchedule и
MinimumTradeQuantity. Upper bound отсутствует; `OrderRequest.Quantity` — string
quantity без maximum. Routes содержит только Id, Name и AssetTypes;
`OrderRequest.Route` задаёт Intelligent как API default. Числовой maximum из
клиентского запроса либо undocumented MaximumTradeQuantity/Maximum/Unbounded
в broker payload не является подтверждённой границей.

Официальная [Intelligent route help](https://help.tradestation.com/10_00/eng/tradestationhelp/routes/intelligent.htm),
проверенная 2026-10-04, указывает 1–1 000 000 shares, но обусловливает диапазон
выбранным маршрутом. Intelligent выбирает downstream route при placement.
API default Intelligent и наличие Id в GetRoutes не подтверждают выбранный
маршрут и применимость этого диапазона к каждому Market/Day и Limit/Day
сочетанию. Связь между conditional range в Desktop help и этими API orders
не доказана. Поэтому production использует `"infinity"` по финальному правилу
пользователя. Источник учтён; значение 1 000 000 не игнорируется и не переносится
на API как безусловное ограничение.

`intelligentMaximum` явно проверяет source/context/route/combination applicability
перед выбором infinity. Внутренний proof включает официальный source, точные
symbol/exchange, API default route, подтверждённый выбранный route, диапазон и
все атомарные сочетания. Это trusted proof input, **не новые поля TradeStation
API** и не вход endpoint. Сегодня production не имеет такой evidence и не
передаёт applicability. Клиентские и undocumented broker поля не могут её
подставить. Helper fixture с синтетически подтверждённой применимостью ко всем
строкам использует конечный maximum `"1000000"`; отсутствующая применимость,
иной контекст и доказательство только одного из двух сочетаний дают infinity.
Никаких guessed route mappings, новых endpoints или пробных orders нет.

`rulesReady` отделяет wire от broker proof: explicit `fractional: false`,
положительные whole minimum/step, literal infinity либо положительный точный
finite maximum; при finite maximum требуется minimum <= maximum. Отсутствующий
внутренний maximum также сериализуется как infinity; malformed finite value
не превращается в infinity. Доказанный finite maximum не преобразуется через
Number и не обрезается: fixture `"9007199254740992"` сохраняет ровно эту строку
в summary и каждом atomic quantity. `Number.MAX_SAFE_INTEGER` и другие transport
sentinels не являются broker rules. Неизменный T-068 validator остаётся final
guard для конкретного numeric intent и может отклонить непредставимый размер.

## Точные decimal и grid semantics

Принимаются explicit строки base-10 без sign/exponent/пробелов. Canonical wire
удаляет начальные нули и незначащие конечные fractional нули. Например,
`0002.5000` → `2.5`. Broker числа через Number не преобразуются. Входные decimals
ограничены 256 символами; слишком большой или неоднозначный payload unavailable.

PriceFormat должен быть Decimal с explicit строковым Decimals и положительным
Increment. Simple задаёт интервал `[0, infinity)`. Schedule использует
documented `IncrementSchedule[{StartsAt, Increment}]`: первый StartsAt равен
нулю, thresholds строго возрастают; следующая строка задаёт exclusive upper
bound текущей, последняя имеет `maxExclusive: null`. Противоречивый Simple +
Schedule, пустой schedule, неподтверждённые tick/precision, Fraction/SubFraction
и интервалы без grid point возвращают unavailable. Не существует default
tick=0.01, precision=2 либо пятизначной broker precision.

Цена должна находиться в `[minInclusive, maxExclusive)` и быть точным целым
кратным tick от нуля, а canonical fractional digits не должны превышать
precision. Threshold может не совпадать с grid. Например, `[0.015, 1)` с tick
`0.02` принимает `0.02`, а не `0.035`. Boundary принадлежит следующей строке.
Сравнение ranges и grid выполняется через BigInt с exact decimal scale, включая
значения за пределами IEEE-754 safe integer.

`rounding: 'nearest_half_up'` — политика PBull клиента. Connector не округляет,
не меняет numeric intent и не вмешивается в T-068 validation. QuantityFormat
должен подтвердить Decimal/Decimals=0/Simple и положительные whole minimum/step.
Finite maximum требует authoritative evidence; unknown maximum — infinity.
Fractional и schedule quantity без полной доказанной
интерпретации unavailable; step=1 не подставляется.

## OAuth и проверки

Если refresh_token ротирован, он возвращается **только** в существующем
protected service-envelope `accessUpdate: {refresh_token: '...'}` вне rules data,
в том числе при последующей ошибке source/proof. Access token никогда не
возвращается. Secrets, args и headers не логируются; rotation не сохраняется
в ts_connect или placement receipts. Повторный вызов снова получает свежую
evidence через read-only broker endpoints.

`test/execution.js` проверяет documented regular ready fixture с infinity,
finite maximum выше safe integer без clipping, per-combination fractional и session,
применимость официального Intelligent range, реальный Impress dispatch, раннюю auth,
malformed/exception envelope, live/SIM identity, ambiguous instruments, отсутствие
combination proof, decimal grids/ranges/precision, mandatory minimum/step/fractional,
rotation на ready и unavailable, safe hook и неизменный T-068 transport guard. Все broker ответы подменены: реальные orders не вызываются.
Проверки: `npm test`, `npm run lint`, `npm run types`,
`BASE_BRANCH=develop CHECK_MODE=default bash doc/ai/project-checks.sh`.

Port выполнен из локальной `ai/T-071-v84` (a5d9db8), diff относительно утверждённой
базы `55fe95574f58b61c5610ab9b3c221b61910f0bcb`. Старый локальный develop не
используется как source diff base. Изменения T-068 submit/lookup/recovery и
capabilities не перенесены и не изменены. Git delivery принадлежит pipeline.
