# Кто шпион — Telegram bot

Полная версия игры «Кто шпион» для Telegram: лобби по коду/ссылке, выбор паков, роли, раунды ассоциаций, голосование и попытка шпиона угадать карту.

## Что внутри

- 25 паков и 764 карточки.
- Полные игровые паки:
  - Brawl Stars — 105 бравлеров с изображениями Brawlify CDN.
  - Clash Royale — 120 карт с изображениями RoyaleAPI CDN.
  - Dota 2 — 127 героев с изображениями Steam CDN.
- Для остальных паков добавлено по 15 карточек и локальные SVG-изображения.
- Web lobby открывается по ссылке `?join=CODE` и работает как Telegram WebApp/обычная страница.

## Запуск на Windows

1. Установи Node.js LTS: https://nodejs.org/
2. Открой `start.bat` двойным кликом.
3. Введи токен Telegram-бота при первом запуске. Токен сохранится в `.env` рядом со `start.bat`.
4. Если есть ngrok authtoken, вставь его при первом запуске; иначе просто нажми Enter и попробуй бесплатный tunnel.

`start.bat` сам установит зависимости в папку проекта, скачает `ngrok.exe` в `tools/`, запустит публичный tunnel, подставит `PUBLIC_URL` и запустит сервер.

## Запуск вручную

```bash
npm install
BOT_TOKEN=123:abc PUBLIC_URL=https://your-domain.example npm start
```

Для локальной проверки без Telegram токена:

```bash
npm install
npm start
```

Открой http://localhost:3000.

## Переменные окружения

- `BOT_TOKEN` или `TELEGRAM_BOT_TOKEN` — токен Telegram-бота.
- `PUBLIC_URL` — публичный URL сервера, нужен для ссылок лобби и Telegram WebApp.
- `USE_NGROK=1` — включает автостарт ngrok в `start.bat`.
- `NGROK_AUTHTOKEN` — необязательный токен ngrok для стабильного tunnel.
- `WEBHOOK_URL` — если задан, бот использует webhook `/telegram`; без него запускается polling.
- `PORT` — порт сервера, по умолчанию `3000`.
- `ADMIN_USER_IDS` — список Telegram ID через запятую, у кого есть доступ к `/admin`, admin mini app и `/api/admin/*`.
- `ADMIN_AUTH_MAX_AGE_SECONDS` — срок действия Telegram WebApp подписи для админки, по умолчанию `86400` секунд.

## Новые фичи (v2)

- **Бэкенд JSON-хранилище** — `data/storage/users.json`, `payments.json`, `events.jsonl`. Юзеры/друзья/инвентарь/платежи/аналитика держатся на диске.
- **WebSocket** (`/ws`) — мгновенный апдейт комнат, чата, реакций, presence; polling остался как фоллбек.
- **Голосовой чат в реальном времени** — WebRTC mesh (до 8 человек), сигналинг через WS. Кнопка `🎙` в комнате.
- **Друзья** — добавить/удалить, поиск по @username / ID / имени, онлайн-статус, кнопка «📩 Позвать в комнату».
- **Профиль другого игрока** — тап по нику в лобби или чате → модалка с XP/уровнем/винрейтом.
- **Реакции** — long-press на сообщение → выбор эмодзи, счётчики; реакция тогглится повторным кликом.
- **Чат-команды** — `/rules`, `/skip` (хост), `/hint` (шпион), `/kick @id` (голосование). Также есть кнопка «🗳» рядом с игроком для прямого голосования.
- **XP / уровни** — XP за каждую игру, уровни (квадратичная кривая), оверлей level-up.
- **Косметика** — рамки/темы/имя-эффекты/статус-эмодзи/анимы. Магазин в нижней навигации.
- **«На покушать» (Telegram Stars)** — кнопка с инвойсом на любую сумму звёзд (100/200/500/1000 или своё). Команда `/donate 200` у бота тоже работает. После оплаты выдаётся премиум (1 день за каждые ~14 ⭐) + случайная косметика за каждые 100 ⭐.
- **Бэкап статистики** — при логине localStorage статы сливаются с серверными (берётся max по каждому полю) и записываются обратно.
- **Аналитика и админка** — все важные события пишутся в `data/storage/events.jsonl`. Команда `/admin` открывает защищённую Telegram mini app админ-панель для `ADMIN_USER_IDS`: поиск пользователей, выдача/забор XP, уровней, премиума, косметики, сброс статистики, сообщения игроку и управление активными комнатами.

### Особенности оплаты Stars

Инвойс создаётся через `bot.telegram.createInvoiceLink({ currency: 'XTR', ... })`. После успешной оплаты Telegram присылает `successful_payment` — там сервер расшифровывает payload и выдаёт премиум/предмет. В dev (без BOT_TOKEN) есть эндпоинт `/api/donate/test-grant`, который симулирует оплату только локально.

### Полезные эндпоинты

- `GET /api/me?playerId=...` — мой профиль + полный объект
- `POST /api/me/sync-stats { playerId, stats }` — бэкап localStorage статистики
- `POST /api/me/game-result { playerId, wasSpy, won }` — игра завершена → XP/уровень
- `GET /api/friends?playerId=...` — список друзей + входящие/исходящие заявки
- `POST /api/friends/{request|accept|decline|remove|invite}`
- `GET /api/users/:id` / `POST /api/users/search { query }`
- `GET /api/shop/catalog` / `POST /api/shop/equip` / `POST /api/shop/purchase-link`
- `POST /api/donate/create-link { playerId, stars }` — генерит инвойс
- `POST /api/analytics/track { event, props, playerId }`
- `GET /api/admin/me|summary|catalog|users|rooms` и `POST /api/admin/users/:id/...` — защищённые эндпоинты админки; клиент должен передавать Telegram WebApp `initData`.
