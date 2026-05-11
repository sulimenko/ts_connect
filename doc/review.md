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

Новые заключения добавляются сюда только для текущего активного цикла.
