# Защищённый execution/rules v1

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
- `orders`: атомарные строки с полями `type`, `tif`, `sessions`, `relation`,
  `orderClass`, `quantityMode`, `side`, `positionEffect`, `quantity`.
- `sessions`: полный список сессий сочетания: `['regular']` для market/day и
  `['regular', 'pre_market', 'post_market']` для limit/gtc (native GTC+).
  Поля `session` и `extended` в Rule rows отсутствуют. Overnight, limit/day и
  дополнительные сочетания не публикуются; выбора сессии или определения её
  по часам нет.
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

В provisioned режиме каждый вызов выполняет OAuth refresh существующим execution transport, затем
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

Доказанные комбинации для common v1 formatter (публикация требует полного
minimum/step/fractional/price proof; неизвестный maximum допускается):

| type   | tif | sessions                         | relation | orderClass | quantityMode | side | positionEffect |
| ------ | --- | -------------------------------- | -------- | ---------- | ------------ | ---- | -------------- |
| market | day | regular                          | NORMAL   | simple     | whole        | buy  | open           |
| limit  | gtc | regular, pre_market, post_market | NORMAL   | simple     | whole        | buy  | open           |
| limit  | gtc | regular                          | BRK      | bracket    | whole        | buy  | open           |
| limit  | gtc | regular                          | OCO      | simple     | whole        | sell | close          |
| stop   | gtc | regular                          | OCO      | simple     | whole        | sell | close          |

Это консервативный subset T-075/T-076 в существующем rules v1. Ready не обещает buying power, исполнение или
fill; T-068 продолжает самостоятельно проверять позиции и intent. Options,
другие listing environments, стороны, position effects и TIF пока не имеют
полного combination proof в этом adapter и не рекламируются. Подтверждённый OPT
с неполной evidence возвращает unavailable. Fractional quantity не объявляется.
Enum OrderType/Duration либо дополнительные клиентские поля не расширяют строки.
BRK/OCO ограничены native сочетаниями ниже. Версии submit/lookup, recovery,
`restart_safe=false` и durable barriers Metaterminal сохраняются; точный companion
contract capabilities — `meta-ts-v2-2` (version 2, submit=true,
recovery=`known_order_id_only`).

Protected submit v2 сохраняет существующий boolean `intent.extended`.
Для первого submit `extended: true` разрешён только при `type: 'limit'` и
`tif: 'gtc'`: broker POST содержит `OrderType: 'Limit'`, действующий `LimitPrice`
и `TimeInForce: {Duration: 'GCP'}`. Другой type/tif или неboolean extended
возвращает `rejected` до OAuth/client setup и любых broker requests.
`extended: false` сохраняет DAY/GTC/IOC/FOK mappings, quantity/price validation
и прежние проверки позиций. Rules рекламируют только строки таблицы выше;
остальные прежние regular submit mappings не расширяют опубликованный domain.
Зарегистрированный attempt сохраняет приоритет над новой validation:
точный extended replay возвращает receipt, конфликтующий — `ambiguous`,
повторный POST не разрешается. Acknowledged submit не подтверждает fill.

Evidence для сочетаний (duration и Intelligent сверены 2026-10-05):

1. OpenAPI snapshot 2026-04-11, индекс [openapi_20260411.md](openapi_20260411.md):
   GetAccounts/Account (AccountID, Status, AccountType, Currency),
   GetSymbolDetails/SymbolDetail (Symbol, AssetType, Country, Exchange, Currency,
   PriceFormat, QuantityFormat), GetRoutes (Id/AssetTypes). `OrderRequest.Route`
   прямо задаёт Intelligent как default для stocks/options. Пример MSFT в
   SymbolDetails использован в broker fixture; он возвращает ready с
   `maximum: "infinity"`. Числовые значения minimum/step/price читаются из
   ответа, а не из примера. Schema `Duration` определяет GCP как Good till
   canceled plus. Официальная [API specification](https://api.tradestation.com/docs/specification/).
2. [Intelligent](https://help.tradestation.com/10_00/eng/tradestationhelp/routes/intelligent.htm)
   подтверждает coverage US NYSE/AMEX/Nasdaq stocks и conditional диапазон
   quantity 1–1 000 000; применимость диапазона рассмотрена отдельно ниже.
3. [Placing Orders from the Basket Order Window](https://help.tradestation.com/10_00/eng/tradestationhelp/basket/place_order_basket_order.htm)
   прямо связывает market и limit с Day и Intelligent; это совместное
   type/duration/route evidence, а не произведение enum-списков.
4. [Trade Bar Durations for Equities](https://help.tradestation.com/10_00/eng/tradestationhelp/tb_definitions/trade_bar_durations_equities.htm)
   определяет Day как regular session.
5. [GTC and GTD Orders](https://help.tradestation.com/10_00/eng/tradestationhelp/tb_definitions/gtc_gtd_orders.htm)
   описывает GTC+ с extended pre-market и DAY+; совместно с Intelligent и
   API Duration это evidence для одобренного limit/gtc regular+pre/post сочетания.
   Эти источники не подтверждают применимость finite maximum ко всем сессиям.

## Native BRK/OCO: protected submit и known-ID lookup

T-076 использует signed `quantity` и те же camelCase поля intent, что NORMAL.
`related` содержит полные sibling/child intents с `relation: 'NORMAL'`,
`related: []`, `symbol`, `assetCategory`, `quantity`, `type`, `tif`,
`extended`, `limitPrice`, `stopPrice`. Account/live принадлежат envelope;
если они продублированы в leg, требуется точное совпадение. Route только
Intelligent; `extended: false` для всех relation legs. Short, OPT, другие routes,
сессии, TIF, типы и вложенные relations не поддерживаются.

- BRK: открытие long из flat, parent Limit/GTC BUY; ровно два children,
  Limit/GTC SELL и StopMarket/GTC SELL, тот же account/symbol и равный абсолютный
  quantity. Child signed quantity противоположен parent. Один
  `POST /v3/orderexecution/orders`, parent содержит
  `OSOs: [{Type: 'BRK', Orders: [limitChild, stopChild]}]`.
- OCO: закрытие подтверждённого long, base плюс ровно один sibling,
  Limit/GTC SELL и StopMarket/GTC SELL с одинаковым account/symbol/quantity.
  Quantity каждого выхода не превышает текущую long-позицию. Один
  `POST /v3/orderexecution/ordergroups` с `Type: 'OCO'` и двумя Orders.
  Это OCO cancellation semantics, без обещания BRK auto-decrement.

Перед POST дополнительно подтверждаются Active Cash/Margin USD account,
US NASDAQ/NYSE/AMEX STOCK, Intelligent route, whole minimum/step и price rules
через существующий rules proof. Каждый native order имеет отдельный
`OrderConfirmID` длиной не более 22; это не обещание broker idempotency.
Отдельных submit/cancel/update legs нет. NORMAL protected и legacy public
`placeorder` сохраняют прежнее поведение.

Evidence: [официальная v3 specification](https://api.tradestation.com/docs/specification/),
проверена 2026-10-06: PlaceOrder example `Buy Limit Entry with Multiple Brackets`
прямо содержит Limit/GTC BUY и OSOs Type BRK с Limit/GTC и StopMarket/GTC SELL.
Этот adapter ограничивается одним bracket с равным parent quantity, как legacy
projection. PlaceGroupOrder описывает native OCO/BRK и содержит GTC SELL
Limit/StopMarket sibling orders; OrderRequestOSO/GroupOrderRequest требуют Type
и Orders. GetOrders examples показывают `Duration`, `Legs[].Symbol`,
`QuantityOrdered`, `BuyOrSell`, `OpenOrClose`, а не request echo.
[Trade Bar advanced orders](https://help.tradestation.com/10_00/eng/tswebtrading/topics/advanced_orders.htm)
подтверждает long entry с attached bracket, пару Limit/StopMarket exit orders,
OCO cancellation и default Intelligent. GTC без plus ограничен regular;
GCP/extended relation rows не выводятся из enum. Эти concrete native examples,
существующие listing/route/session proofs и runtime guards задают narrow rows.

Placement принимает несколько Orders/Errors и сохраняет все валидные OrderID
как non-secret group evidence, включая ID из partial errors. Free-form Message,
Error/RejectReason/StatusDescription, raw payload и credentials не входят
в receipts/envelopes. Дубликаты, malformed evidence, partial errors,
неизвестные статусы и неполное соответствие не подтверждают успешную группу.
Отсутствующий Status в placement сам по себе не считается pending/fill:
при наличии known IDs разрешены только bounded read-only current/history GET.

Group broker envelope: `{relation: 'BRK'|'OCO', mapping: 'verified'|'ambiguous',
orders: [{terminal_id, state, leg?}]}`. State фактический per order, без общего
синтетического fill; неизвестное evidence даёт `state: 'unknown'`. `leg` — индекс
в `[intent, ...intent.related]`, появляется только при доказанной bijection по
account, symbol, STOCK, ordered quantity, action/open-close, duration, order type
и ценам. Ни порядок Orders, ни Message не задают mapping. Статус OSO означает
pending child, не fill. Успех submit acknowledged требует полной verified mapping
и accepted/pending/part_filled/filled evidence всех legs; иначе ambiguous с
сохранёнными ID. Acknowledged по-прежнему не обещает fill всей группы.

Lookup с worker receipt использует все сохранённые IDs. После restart клиент
передаёт `relation` и `brokerIds: ['known-id-1', 'known-id-2', ...]` вместо brokerId;
допускается 1–50 уникальных sanitized IDs. Lookup не пытается восстановить IDs
по symbol/time/Message. Current GET передаёт comma-separated IDs; historical GET
только отсутствующие current IDs и since в пределах 90 дней. Максимум два broker
GET, без pagination/retry. Factual found возможен без mapping legs после restart;
`mapping: 'ambiguous'` сохраняется. Unknown status, ошибки источника или неполный
набор возвращают source_unavailable с sanitized known evidence. Пустая bounded
history не доказывает not_found. Точный или изменённый submit replay после claim
не делает новый POST, включая timeout, malformed reply и mapping uncertainty.
Worker-local barrier не переживает restart: restart_safe=false, durable placement
barrier остаётся обязанностью Meta; recovery после restart ограничен known-ID lookup.

### Результат исследования quantity maximum

Сырой OpenAPI snapshot 2026-04-11 подтверждает: `QuantityFormat` содержит
Format, Decimals, IncrementStyle, Increment, IncrementSchedule и
MinimumTradeQuantity. Upper bound отсутствует; `OrderRequest.Quantity` — string
quantity без maximum. Routes содержит только Id, Name и AssetTypes;
`OrderRequest.Route` задаёт Intelligent как API default. Числовой maximum из
клиентского запроса либо undocumented MaximumTradeQuantity/Maximum/Unbounded
в broker payload не является подтверждённой границей.

Официальная [Intelligent route help](https://help.tradestation.com/10_00/eng/tradestationhelp/routes/intelligent.htm),
проверенная 2026-10-05, указывает 1–1 000 000 shares, но обусловливает диапазон
выбранным маршрутом. Intelligent выбирает downstream route при placement.
API default Intelligent и наличие Id в GetRoutes не подтверждают выбранный
маршрут и применимость этого диапазона к каждому Market/Day regular и Limit/GTC+
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
иной контекст и доказательство только одного из двух сочетаний дают infinity
в summary и каждой строке. Проверяются остальные параметры сочетания и полный
`sessions` array, включая длину и каждый элемент. Частичный или несовпадающий
список сессий не разрешает finite maximum. Прежний regular/day proof с
`session`/`extended` не применяется автоматически к limit/gtc regular+pre/post.
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

## T-073: источник connector_env для rules/submit/lookup

В существующих rules v1 и submit/lookup v2 requests можно указать
`credential_source: "connector_env"` и **убрать** `credentials`. Отсутствующий
`credential_source` и явный `"provisioned"` сохраняют прежнюю credentials
validation, OAuth transport, rotation и envelopes. Неизвестный source запрещён.
Capabilities и wire responses не расширяются.

Local gate использует comma-separated `TRADING_TS_CONNECTOR_ENV_ACCOUNTS` через
`config.execution.connectorEnvAccounts`: пробелы вокруг элементов удаляются,
пустые элементы пропускаются, account сравнивается точно с полной строкой.
Утверждённая конфигурация:
`SIM2811593M,11957784,12062622,12062620,11827414,12062623`.
Отсутствующая/пустая конфигурация запрещает режим; встроенного разрешающего
fallback нет. Изменённый регистр, prefix и wildcard не дают совпадение.

`credentials` с любым значением, отдельные credential/token поля (включая
вложенные pkey/secret/rtoken, refresh/access token и их aliases) запрещены.
Local отказ происходит без чтения их значений, client setup или сети.
Service token и identity проверяются раньше local gate, request secrets,
client registry и attempts.

После local gate execution вызывает только
`domain.ts.clients.getClient({name: 'ptfin', sync: false})`. Второй независимый
gate требует точный ключ account в `client.brokerage.accounts` и строгое
`contract.live === request.live`, где live — boolean. Имя account не определяет
live. Execution не загружает contracts, не запускает streams и не вызывает
sync, update или deleteClient ради подтверждения. Поэтому cold client с пустым
registry account безопасно отказывает даже после успешного token setup.
Broker accounts остаётся отдельным proof для rules/submit; SymbolDetails,
routes, intent и authoritative positions проверяются по прежним правилам.

Env credentials остаются в существующем `config.ts.ptfin` / ptfin client,
загружаемом из локального .env. Они не переносятся в execution request data.
При пригодном access token новый refresh не выполняется. Необходимый refresh
и уже выполняющийся refresh разделяют `client.refreshAccessToken` single-flight
с normal lifecycle; cold setup разделяет registry single-flight. Execution
ограничивает ожидание своим deadline, не отменяя общую операцию. Перед каждым
broker request повторно проверяются deadline, closed, registry/live и token,
а Authorization берётся из актуального client token после refresh.

Rules отказы используют существующие `invalid_request` (source/request secrets),
`account_unconfirmed` (local allowlist/registry/live) и `source_unavailable`
(client/setup/refresh/deadline). Submit до отправки возвращает `rejected`,
lookup — `source_unavailable`. Начатый POST сохраняет прежнюю ambiguity.
Connector_env никогда не возвращает `accessUpdate`, в том числе после refresh,
при unavailable/rejection/ambiguous и replay. Secrets и raw exceptions не
попадают в envelopes, логи или attempts. OAuth rotation persistence normal
client lifecycle не изменяется.

OrderId остаётся единственной identity attempts. Синхронный claim выполняется
до первого await. Зарегистрированный submit receipt имеет прежний приоритет
над повторной validation: смена source/account/live/intent или malformed replay
не разрешают ещё один POST и не возвращают rotation. Worker-local receipts,
lost-response recovery, current/history lookup, known broker ID после restart
и `restart_safe: false` сохраняются. Пустой current/history не доказывает not_found.

## OAuth и проверки

В provisioned режиме, если refresh_token ротирован, он возвращается **только** в существующем
protected service-envelope `accessUpdate: {refresh_token: '...'}` вне rules data,
в том числе при последующей ошибке source/proof. Access token никогда не
возвращается. Secrets, args и headers не логируются; rotation не сохраняется
в ts_connect или placement receipts. Повторный вызов снова получает свежую
evidence через read-only broker endpoints.

`test/execution.js` проверяет ready fixture с одобренными NORMAL/BRK/OCO rows и infinity,
finite maximum выше safe integer без clipping, per-combination fractional и sessions,
применимость официального Intelligent range, реальный Impress dispatch, раннюю auth,
malformed/exception envelope, live/SIM identity, ambiguous instruments, отсутствие
combination proof, decimal grids/ranges/precision, mandatory minimum/step/fractional,
rotation на ready и unavailable, safe hook и неизменный T-068 transport guard.
Extended limit/gtc проверяется с обоими credential sources: один GCP POST,
ранний отказ неподдерживаемых intents, price/quantity validation, concurrency,
точный/конфликтующий replay и lost-response/restart lookup. Regular intents
сохраняют DAY/GTC/IOC/FOK и прежние price mappings.
Все broker ответы подменены: реальные orders не вызываются.
Проверки: `npm test`, `npm run lint`, `npm run types`,
`BASE_BRANCH=develop CHECK_MODE=default bash doc/ai/project-checks.sh`.

T-073 scenarios проверяют все шесть accounts для rules/submit/lookup, exact
allowlist, запрет request secrets и раннюю auth, независимый registry/live gate,
token reuse, реальные registry/client single-flight с mock upstream, bounded
setup/refresh и отсутствие позднего POST, closed/missing-token/refresh failures,
смену token перед placement, replay/source collision, current/history и restart
recovery. Реальный Impress dispatch проверяет оба источника. Broker transport
и OAuth upstream подменены; реальные orders и .env не используются.

Port выполнен из локальной `ai/T-071-v84` (a5d9db8), diff относительно утверждённой
базы `55fe95574f58b61c5610ab9b3c221b61910f0bcb`. Старый локальный develop не
используется как source diff base. Изменения T-068 submit/lookup/recovery и
capabilities не перенесены и не изменены. Git delivery принадлежит pipeline.

T-076 mock scenarios проверяют единственный native POST BRK/OCO с обоими
credential sources, полное relation fingerprint, distinct confirm IDs, multiple
placement IDs/partial Errors, ambiguous mapping, per-order current/history states,
known-ID lookup после restart, malformed/unknown evidence, timeout и concurrent/changed
replay. Проверки не используют live broker orders.
