# mcp-remnawave

[English](README.md) · **Русский**

<p align="center">
  <img src="assets/certified-ai-bullshit.jpeg" alt="Certified AI Bullshit" width="180">
</p>
<p align="center"><sub>изображение certified-ai-bullshit принадлежит <a href="https://github.com/vas3k">vas3k</a></sub></p>

MCP-сервер для панели [Remnawave](https://github.com/remnawave/). Даёт LLM-клиенту (Claude Code, Claude Desktop,
Cursor…) весь API панели и то, что через голый API делать мучительно: сводки по всему флоту, компактный вывод
и безопасную, проверяемую правку больших конфигов.

> Написан с помощью Claude (Anthropic), проверен на живой панели 3.4.4, пути записи — на локальном макете.
> Прежде чем давать ему права на запись, прочитайте diff.

| | |
|---|---|
| Версия | 3.0.0 |
| Панель | Remnawave 3.4.x |
| Контракт | `@remnawave/backend-contract` 3.4.x |
| Среда | Node.js 22+ |
| Инструменты | 201 (95 в режиме только чтения) — [полный список](docs/TOOLS.md) |

## Зачем 3.0

Версия 2 повторяла API один в один. На практике это значило:

- `nodes_list` отдавал 2.3 МБ, `hosts_list` — 1.3 МБ, клиент такой ответ не принимал;
- приватные ключи REALITY всех инбаундов попадали в вывод `nodes_*` и `squads_*`;
- чтобы поменять один адрес в профиле на 300 инбаундов или в шаблоне на 160 КБ, надо было прислать его целиком;
- ошибка 400 сообщала только «Validation failed», без поля;
- «в каких пулах этот хост?», «почему инбаунд никому не доходит?» — только SQL-запросом в базу.

3.0 сохраняет всё покрытие API и добавляет:

| Что | Как |
|---|---|
| Вывод | Компактные строки по умолчанию; секреты маскируются; всё, что больше лимита, пишется в файл, в ответе путь |
| Ошибки | Какое поле не прошло и почему; тело проверяется по контракту до отправки; повторы и притормаживание, когда панель отваливается под нагрузкой |
| Сводки | `fleet_overview`, `inbound_trace`, `host_usage`, `pools_audit`, `config_search` — связки нод, профилей, сквадов, хостов и пулов шаблонов |
| Правка | `config_profile_patch`, `sub_template_patch`, `pools_edit`, `hosts_bulk_edit`, `hosts_clone`, `hosts_move`, `node_inbounds_edit`, `squad_inbounds_edit` |
| Страховка | Холостой прогон → `planHash` → запись; бэкап перед каждой записью; журнал; `backup_restore` |
| Проверки | Пул, опустевший из-за выключенного хоста; удаление инбаунда, которое обнулит привязки хостов; повтор тега в другом профиле; правила маршрутизации на несуществующие outbound/балансировщик; лимиты контракта |
| Ссылки | Ноды, профили, сквады и шаблоны — по **имени**; инбаунды — по **тегу**; хосты — по uuid или его уникальному началу |

## Быстрый старт

```bash
git clone https://github.com/akadorkin/mcp-remnawave.git
cd mcp-remnawave
npm ci && npm run build
```

Claude Code:

```bash
claude mcp add remnawave -s user \
  -e REMNAWAVE_BASE_URL=https://panel.example.com \
  -e REMNAWAVE_API_TOKEN=<token> \
  -- node /path/to/mcp-remnawave/dist/index.js
```

Другие клиенты: `node dist/index.js` по stdio с тем же окружением.

## Настройка

| Переменная | Обязательна | По умолчанию | Смысл |
|---|---|---|---|
| `REMNAWAVE_BASE_URL` | да | | Адрес панели, без `/api` |
| `REMNAWAVE_API_TOKEN` | да | | API-токен (Settings → API tokens) |
| `REMNAWAVE_READONLY` | | `false` | `true` — только читающие инструменты |
| `REMNAWAVE_STATE_DIR` | | `~/.local/state/remnawave-mcp` | Бэкапы, журнал, большие ответы, снимки подписок |
| `REMNAWAVE_MAX_OUTPUT_CHARS` | | `40000` | Больше — в файл |
| `REMNAWAVE_REDACT_KEYS` | | `privateKey,mldsa65Seed` | Какие ключи маскировать в выводе |
| `REMNAWAVE_TIMEOUT_MS` | | `60000` | Таймаут запроса |
| `REMNAWAVE_SUB_BASE_URL` | | `<base>/api/sub` | Префикс публичных ссылок подписки |
| `REMNAWAVE_PROBE_SHORT_UUID` | | | Учётка по умолчанию для `subscription_fetch` — берите мониторинговую |
| `REMNAWAVE_API_KEY` | | | Заголовок `X-Api-Key` (авторизация в Caddy) |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | | | Сервисный токен Cloudflare Access |

## Как устроена правка

Инструменты, которые меняют профили, шаблоны, пулы, несколько хостов или привязки нод, работают в два шага:

1. Вызов без `apply` → точный дифф, блокеры, предупреждения и `planHash`.
2. Повтор с `apply: true, planHash: "…"` → план пересобирается по свежим данным; если с шага 1 что-то
   изменилось, запись не выполняется. Иначе каждый объект бэкапится, пишется, перечитывается и сверяется.

Инструменты для одного объекта (`hosts_update`, `nodes_update`, …) пишут сразу, но тоже с бэкапом и журналом.
Разрушительные (`nodes_delete`, `config_profiles_delete`, `squads_*_all_users`) сначала показывают последствия
и требуют `confirmName`.

`journal_list` — что менялось, `backups_list` / `backup_restore` — откат.

### Пути

Правки адресуют JSON путями с селекторами:

```text
/outbounds[tag=relay-out]/settings/vnext/0/address
/inbounds[tag=vless-reality-443]/streamSettings/realitySettings/serverNames
/routing/rules[outboundTag=block][network=tcp,udp]
/routing/rules[inboundTag~=vless-5443]       # ~= : массив содержит значение
/remnawave/injectHosts/0/selector/values
```

Селектор обязан совпасть ровно с одним элементом — никаких догадок.
Операции: `replace`, `set`, `add`, `remove`, `test`, `move`, `copy`, `merge`, `insert`, `array_add`,
`array_remove`, `replace_string` (с `expect` — точное число замен).

```json
{
  "profile": "eu-ingress",
  "ops": [{ "op": "replace", "path": "/outbounds[tag=relay-out]/settings/vnext/0/address", "value": "10.0.0.2" }]
}
```

## Разработка

```bash
npm run build        # tsc --noEmit, затем tsup
npm run docs:tools   # пересобрать docs/TOOLS.md
```

```text
src/
  client/      HTTP-клиент: повторы, притормаживание, ошибки по полям
  core/        индекс флота (связки), движок правок JSON + дифф, план/запись, бэкапы, политика вывода, представления
  tools/       группы инструментов; сквозные — fleet.ts, maintenance.ts, subscription-render.ts
  resources/   remnawave://stats, nodes, health, users/{id}
  prompts/     сценарии-подсказки
```

Исходный проект: [TrackLine/mcp-remnawave](https://github.com/TrackLine/mcp-remnawave) (1.x, панель 2.x).

## Лицензия

MIT
